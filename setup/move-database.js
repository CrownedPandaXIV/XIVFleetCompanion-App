// "Move the database to this PC" (Settings → Database), run on the PC the database moves to. It checks
// everything first, installs PostgreSQL if this PC doesn't have it and lets other PCs connect (one Windows
// permission prompt), makes the same database and login here, pauses the plugins, copies everything across
// (pg_dump of one consistent snapshot, loaded with pg_restore), compares every table's row count, and only then
// leaves the note in the old database that sends every app and plugin to this PC (db/database-move.js). Until
// that last step, a failure puts everything back as it was. The old database is never deleted.
// No Electron here: the window's side is ipc/move-database.js, and tests/db/verify-database-move.js runs this
// against two scratch databases.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PLUGIN_APPLICATION_NAME, readMoveNote } = require('../db/database-move');
const { compareVersions } = require('../shared/plugin-version');
const { isTailscaleAddress } = require('./help');

// Plugins older than this don't follow a move, so every PC that syncs needs it first.
const MOVE_PLUGIN_VERSION = '0.14.0';
// A PC that synced within this many days counts as one that syncs.
const RECENT_DAYS = 14;
// How long to wait for a plugin's sync to finish once they're paused, and how often to look.
const DRAIN_TRIES = 60;
const DRAIN_EVERY_MS = 3000;
// A plugin connection counts as busy while it's running something or has in the last this many seconds. The
// plugin's database library keeps a finished connection open, idle, for a few minutes so it can reuse it; one
// that's been quiet this long isn't syncing.
const BUSY_SECONDS = 15;
// How often the pause is refreshed while the copy runs (plugins ignore one older than 5 minutes).
const HEARTBEAT_MS = 30 * 1000;

// The addresses other PCs can use to reach this one, the kind the old database used first (a Tailscale
// address for a Tailscale one): [{ address, via }]. addresses: setup/help.js pcAddresses().
function addressChoices(oldHost, addresses) {
  const tailscale = addresses.tailscale.map((address) => ({ address, via: 'Tailscale' }));
  const home = addresses.home.map((address) => ({ address, via: 'home network' }));
  return isTailscaleAddress(oldHost) || !home.length ? [...tailscale, ...home] : [...home, ...tailscale];
}

// The PCs tab's rows (companion_pc_status) against what a move needs: every PC that synced in the last
// RECENT_DAYS runs plugin MOVE_PLUGIN_VERSION or newer (which also reports its login) and uses the app's own
// login. Returns { blocking: [sentences], notes: [sentences] }.
function checkPcs(pcs, user, now = new Date()) {
  const blocking = [];
  const notes = [];
  const since = now.getTime() - RECENT_DAYS * 24 * 60 * 60 * 1000;
  for (const pc of pcs || []) {
    const name = pc.account_label ? `${pc.pc_name} (${pc.account_label})` : pc.pc_name;
    const last = pc.last_sync_at ? new Date(pc.last_sync_at) : null;
    if (!last || last.getTime() < since) {
      notes.push(`${name} hasn't synced since ${last ? last.toLocaleDateString() : 'it was set up'}. It follows the move when it next syncs, as long as its plugin is updated by then and the old database PC is still on.`);
      continue;
    }
    if (compareVersions(pc.plugin_version, MOVE_PLUGIN_VERSION) < 0) {
      blocking.push(`${name} runs plugin ${pc.plugin_version || '(unknown)'}, which can't follow a move. Update it to ${MOVE_PLUGIN_VERSION} or newer (Dalamud does this when the game starts) and let it sync once.`);
    } else if (!pc.db_user) {
      blocking.push(`${name} hasn't synced since its plugin was updated. Let it sync once (a few minutes with the game running).`);
    } else if (pc.db_user !== user) {
      blocking.push(`${name}'s plugin logs in as "${pc.db_user}", but the move only brings the app's login "${user}". Change ${name}'s plugin settings to use "${user}" first.`);
    }
  }
  return { blocking, notes };
}

// "pg_dump (PostgreSQL) 18.6" -> 18; 170004 (server_version_num) -> 17.
function toolMajor(versionText) {
  const m = /(\d+)(?:\.\d+)?/.exec(String(versionText || '').replace(/^[^\d]*/, ''));
  return m ? Number(m[1]) : null;
}
const serverMajor = (versionNum) => Math.floor(Number(versionNum) / 10000);

// Where a database that was already on this PC under the same name is kept: fleet_before_move_20261019_1530.
function keptName(database, now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const suffix = `_before_move_${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}`;
  return `${database.slice(0, 63 - suffix.length)}${suffix}`;
}

// The tables whose row counts differ: [{ table, before, after }].
function countDifferences(before, after) {
  const out = [];
  for (const [table, n] of Object.entries(before)) {
    if (after[table] !== n) out.push({ table, before: n, after: after[table] === undefined ? null : after[table] });
  }
  return out;
}

// Every table's row count, in the client's current transaction.
async function countTables(client) {
  const { rows } = await client.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`);
  const counts = {};
  for (const { tablename } of rows) {
    counts[tablename] = Number((await client.query(`SELECT count(*) AS n FROM "${tablename.replace(/"/g, '""')}"`)).rows[0].n);
  }
  return counts;
}

const mb = (bytes) => `${(bytes / 1048576).toFixed(0)} MB`;

// The steps the window lists: [{ id, label }].
function stepsFor({ installPostgres }) {
  return [
    { id: 'check', label: 'Check everything first' },
    ...(installPostgres ? [{ id: 'download', label: 'Download PostgreSQL' }] : []),
    { id: 'admin', label: `${installPostgres ? 'Install PostgreSQL and let' : 'Let'} your other PCs connect to this one (Windows asks for permission)` },
    { id: 'prepare', label: 'Make the database and its login on this PC' },
    { id: 'pause', label: 'Pause the plugins while the copy is made' },
    { id: 'copy', label: 'Copy the database' },
    { id: 'load', label: 'Load it on this PC' },
    { id: 'compare', label: 'Compare every table' },
    { id: 'switch', label: 'Switch every PC over' },
  ];
}

// The checks that need no change made, also shown before starting. input: { config, address, addresses,
// hostname }; deps: { createClient, isThisPc }. Returns { ok, error?, blocking, notes, serverVersion, oldClient? }.
async function checkOld(input, deps) {
  const { config } = input;
  const fail = (error, extra = {}) => ({ ok: false, error, blocking: [], notes: [], ...extra });
  if (!config || !config.host) return fail('This app isn\'t connected to a database yet. Connect it to the database you want to move first (Database tab, above).');
  if (deps.isThisPc(config.host)) {
    return fail('The database this app uses is already on this PC. Run this on the PC you want to move it to, with its app connected to this database.');
  }
  const old = deps.createClient(config);
  try {
    await old.connect();
  } catch (err) {
    await old.end().catch(() => {});
    return fail(`Can't reach the database at ${config.host}: ${err.message}`);
  }
  try {
    const table = (await old.query(`SELECT to_regclass('companion_database_move') IS NOT NULL AS t`)).rows[0].t;
    if (!table) return fail('The database hasn\'t been updated for moving yet. Restart the app, open any tab, and try again.');
    const note = await readMoveNote(old);
    if (note && note.state === 'moved') return fail(`This database has already moved to ${note.host}:${note.port}. The app switches to it by itself within a minute.`);
    if (note && note.state === 'pausing' && note.fresh) return fail('Another move of this database is running right now. Wait for it to finish.');
    const pcs = (await old.query('SELECT pc_name, account_label, plugin_version, last_sync_at, db_user FROM companion_pc_status ORDER BY pc_name, account_label')).rows;
    const { blocking, notes } = checkPcs(pcs, config.user, deps.now ? deps.now() : new Date());
    const serverVersion = Number((await old.query('SHOW server_version_num')).rows[0].server_version_num);
    return { ok: blocking.length === 0, error: blocking.length ? 'Some PCs need something first (listed below).' : null, blocking, notes, serverVersion };
  } finally {
    await old.end().catch(() => {});
  }
}

// What's on this PC under the database's name: { exists, replaceable, why }. A database the move left behind
// earlier (its note says 'moved') or one with no characters (made by "Set up this PC") is kept under another
// name; anything else is left alone and the move refused.
async function localDatabase(admin, deps, { database, port, adminPassword, adminUser }) {
  const found = (await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [database])).rows.length > 0;
  if (!found) return { exists: false };
  const c = deps.createClient({ host: 'localhost', port, database, user: adminUser, password: adminPassword });
  try {
    await c.connect();
    const note = await readMoveNote(c);
    if (note && note.state === 'moved') return { exists: true, replaceable: true, why: 'it\'s the copy left here when the database moved away before' };
    const hasCharacters = (await c.query(`SELECT to_regclass('companion_character_current') IS NOT NULL AS t`)).rows[0].t
      && Number((await c.query('SELECT count(*) AS n FROM companion_character_current')).rows[0].n) > 0;
    if (!hasCharacters) return { exists: true, replaceable: true, why: 'it has no characters in it' };
    return { exists: true, replaceable: false };
  } finally {
    await c.end().catch(() => {});
  }
}

// Runs the move. input: { config (this app's saved connection, to the old database), port (PostgreSQL's port
// on this PC), address (what other PCs will use to reach this one), adminPassword (PostgreSQL's master
// password on this PC: chosen now when it's being installed; never saved), installPostgres }.
// deps: createClient(config), isThisPc(host), findTools(), runTool(file, args, options), download(onProgress) ->
// installer file, removeFile(file), runElevated(steps, onProgress) -> { results } | { error }, postgresOptionsFile(password, port) ->
// { file, remove() }, recordInstalled(what), ranges(), saveConfig(config), wait(ms), now(), tmpDir.
// report(steps) gets the steps with their state after every change. Returns { ok, error?, steps, to? }.
async function moveDatabase(input, deps, report = () => {}) {
  const { config } = input;
  const port = Number(input.port) || 5432;
  const wait = deps.wait || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = deps.now || (() => new Date());
  const steps = stepsFor(input).map((s) => ({ ...s, state: 'waiting', detail: '' }));
  const set = (id, state, detail = '') => {
    const s = steps.find((x) => x.id === id);
    if (s) { s.state = state; s.detail = detail; }
    report(steps.map((x) => ({ ...x })));
  };
  report(steps.map((x) => ({ ...x })));

  // What has been changed, so a failure can put it back.
  const undo = { pausing: false, createdRole: false, createdDatabase: false, kept: null, dump: null };
  let admin = null;
  let old = null;
  let heartbeat = null;
  let current = 'check';
  const adminConfig = (database = 'postgres') => ({ host: 'localhost', port, database, user: input.adminUser || 'postgres', password: input.adminPassword });
  const connectAdmin = async (tries = 1) => {
    let last = null;
    for (let i = 0; i < tries; i++) {
      const c = deps.createClient(adminConfig());
      try {
        await c.connect();
        return c;
      } catch (err) {
        await c.end().catch(() => {});
        last = err;
        if (err.code === '28P01') break;
        if (i < tries - 1) await wait(2000);
      }
    }
    throw new Error(last && last.code === '28P01'
      ? 'PostgreSQL on this PC refused the master password. It\'s the one chosen when PostgreSQL was installed here.'
      : `PostgreSQL on this PC didn't answer: ${last ? last.message : 'unknown error'}`);
  };
  const formatted = async (client, template, ...values) => (await client.query(
    `SELECT format('${template}', ${values.map((_, i) => `$${i + 1}::text`).join(', ')}) AS s`, values)).rows[0].s;

  try {
    // 1. Everything that can be checked without changing anything.
    set('check', 'working', 'the database and every PC...');
    if (!input.address) throw new Error('Choose the address your other PCs will use to reach this PC.');
    const checked = await checkOld(input, deps);
    if (!checked.ok) throw new Error([checked.error, ...checked.blocking].join(' '));
    if (!input.installPostgres) {
      set('check', 'working', 'PostgreSQL on this PC...');
      admin = await connectAdmin();
      const here = Number((await admin.query('SHOW server_version_num')).rows[0].server_version_num);
      if (serverMajor(here) < serverMajor(checked.serverVersion)) {
        throw new Error(`PostgreSQL on this PC is version ${serverMajor(here)}, older than the old database's ${serverMajor(checked.serverVersion)}. Install PostgreSQL ${serverMajor(checked.serverVersion)} or newer here first.`);
      }
      const existing = await localDatabase(admin, deps, { database: config.database, port, adminPassword: input.adminPassword, adminUser: input.adminUser || 'postgres' });
      if (existing.exists && !existing.replaceable) {
        throw new Error(`This PC already has a database called "${config.database}" with characters in it, so nothing was changed. If it's an old copy you don't need, remove it first.`);
      }
      await admin.end().catch(() => {});
      admin = null;
    }
    set('check', 'done', checked.notes.join(' '));

    // 2. PostgreSQL (if this PC doesn't have it) and letting other PCs in, with one Windows permission prompt.
    let installer = null;
    if (input.installPostgres) {
      current = 'download';
      set('download', 'working', 'starting...');
      installer = await deps.download((f) => set('download', 'working', f === null ? 'downloading...' : `${Math.round(f * 100)}%`));
      set('download', 'done');
    }
    current = 'admin';
    set('admin', 'working', 'waiting for Windows\' permission...');
    const adminSteps = [];
    let options = null;
    if (input.installPostgres) {
      options = deps.postgresOptionsFile(input.adminPassword, port);
      adminSteps.push({ kind: 'installPostgres', installer, optionFile: options.file });
    }
    adminSteps.push({ kind: 'openConnections', port, ranges: deps.ranges() });
    let elevated;
    try {
      elevated = await deps.runElevated(adminSteps, (results) => {
        const last = results[results.length - 1];
        if (last) set('admin', 'working', last.message);
      });
    } finally {
      // The option file holds the master password: gone as soon as PostgreSQL's installer has read it.
      if (options) options.remove();
    }
    if (!elevated.results) throw new Error(elevated.error);
    if (elevated.results.some((r) => r.ok && r.kind === 'installPostgres')) deps.recordInstalled({ postgres: { port } });
    const failedStep = elevated.results.find((r) => !r.ok);
    if (failedStep) throw new Error(failedStep.message);
    set('admin', 'done', elevated.results.map((r) => r.message).join(' '));
    // PostgreSQL's installer (about 350 MB) isn't needed once it's installed.
    if (installer && deps.removeFile) deps.removeFile(installer);

    // 3. The database and its login, with the same names and password the app already uses.
    current = 'prepare';
    set('prepare', 'working', 'waiting for PostgreSQL...');
    admin = await connectAdmin(input.installPostgres ? 30 : 1);
    if (input.installPostgres) {
      const here = Number((await admin.query('SHOW server_version_num')).rows[0].server_version_num);
      if (serverMajor(here) < serverMajor(checked.serverVersion)) throw new Error(`The PostgreSQL just installed is older than the old database's (${serverMajor(checked.serverVersion)}).`);
    }
    const tools = await deps.findTools();
    if (!tools.found) throw new Error(tools.error);
    if (toolMajor(tools.version) < serverMajor(checked.serverVersion)) {
      throw new Error(`This PC's copy tool (${tools.version}) is older than the old database (version ${serverMajor(checked.serverVersion)}). Install PostgreSQL ${serverMajor(checked.serverVersion)} or newer here first.`);
    }
    const existing = await localDatabase(admin, deps, { database: config.database, port, adminPassword: input.adminPassword, adminUser: input.adminUser || 'postgres' });
    if (existing.exists && !existing.replaceable) throw new Error(`This PC already has a database called "${config.database}" with characters in it, so nothing was changed.`);
    if (existing.exists) {
      const kept = keptName(config.database, now());
      await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [config.database]);
      await admin.query(await formatted(admin, 'ALTER DATABASE %I RENAME TO %I', config.database, kept));
      undo.kept = kept;
    }
    const roleExists = (await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [config.user])).rows.length > 0;
    await admin.query(await formatted(admin, roleExists ? 'ALTER ROLE %I WITH LOGIN PASSWORD %L' : 'CREATE ROLE %I LOGIN PASSWORD %L', config.user, config.password));
    undo.createdRole = !roleExists;
    await admin.query(await formatted(admin, 'CREATE DATABASE %I OWNER %I', config.database, config.user));
    undo.createdDatabase = true;
    set('prepare', 'done', existing.exists ? `The "${config.database}" that was here (${existing.why}) is kept as "${undo.kept}".` : `"${config.database}" is ready.`);

    // 4. Pause the plugins, and wait for any sync still running to finish.
    current = 'pause';
    set('pause', 'working', 'telling the plugins...');
    old = deps.createClient(config);
    await old.connect();
    await old.query(`INSERT INTO companion_database_move (id, state, host, port, from_host, started_at, updated_at, moved_at)
                     VALUES (1, 'pausing', $1, $2, $3, now(), now(), NULL)
                     ON CONFLICT (id) DO UPDATE SET state = 'pausing', host = $1, port = $2, from_host = $3,
                       started_at = now(), updated_at = now(), moved_at = NULL`, [input.address, port, config.host]);
    undo.pausing = true;
    heartbeat = setInterval(() => {
      old.query(`UPDATE companion_database_move SET updated_at = now() WHERE id = 1 AND state = 'pausing'`).catch(() => {});
    }, HEARTBEAT_MS);
    let quiet = 0;
    for (let i = 0; i < DRAIN_TRIES && quiet < 2; i++) {
      const busy = Number((await old.query(
        `SELECT count(*) AS n FROM pg_stat_activity
          WHERE datname = current_database() AND application_name = $1 AND pid <> pg_backend_pid()
            AND (state <> 'idle' OR state_change > now() - make_interval(secs => $2))`,
        [PLUGIN_APPLICATION_NAME, BUSY_SECONDS])).rows[0].n);
      quiet = busy === 0 ? quiet + 1 : 0;
      if (quiet < 2) {
        set('pause', 'working', busy ? `waiting for ${busy === 1 ? 'a plugin' : `${busy} plugins`} to finish syncing...` : 'checking...');
        await wait(DRAIN_EVERY_MS);
      }
    }
    if (quiet < 2) throw new Error('A plugin was still syncing after 3 minutes, so nothing was copied. Try again in a few minutes.');
    set('pause', 'done');

    // 5. One consistent copy: the row counts and pg_dump read the same snapshot of the database.
    current = 'copy';
    set('copy', 'working', 'counting rows...');
    const snap = deps.createClient(config);
    let before;
    try {
      await snap.connect();
      await snap.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      const snapshot = (await snap.query('SELECT pg_export_snapshot() AS s')).rows[0].s;
      before = await countTables(snap);
      fs.mkdirSync(deps.tmpDir || os.tmpdir(), { recursive: true });
      undo.dump = path.join(deps.tmpDir || os.tmpdir(), `xiv-fleet-move-${now().getTime()}.dump`);
      const growing = setInterval(() => {
        try { set('copy', 'working', `${mb(fs.statSync(undo.dump).size)} so far...`); } catch { /* not started */ }
      }, 2000);
      let dumped;
      try {
        dumped = await deps.runTool(tools.dump, ['-h', String(config.host), '-p', String(config.port || 5432), '-U', String(config.user),
          '-d', String(config.database), '-Fc', `--snapshot=${snapshot}`, '-f', undo.dump],
        { env: { ...process.env, PGPASSWORD: config.password || '', PGCONNECT_TIMEOUT: '15' } });
      } finally {
        clearInterval(growing);
      }
      if (!dumped.ok) throw new Error(`Copying failed: ${(dumped.stderr || dumped.stdout).trim().split(/\r?\n/).slice(-3).join(' ')}`);
      await snap.query('COMMIT');
    } finally {
      await snap.end().catch(() => {});
    }
    set('copy', 'done', mb(fs.statSync(undo.dump).size));

    // 6. Load it into the new database, as the app's own login, which then owns every table.
    current = 'load';
    set('load', 'working', 'this takes a few minutes for a big database...');
    const loaded = await deps.runTool(tools.restore, ['-h', 'localhost', '-p', String(port), '-U', String(config.user), '-d', String(config.database),
      '--no-owner', '--no-privileges', '--single-transaction', '--exit-on-error', undo.dump],
    { env: { ...process.env, PGPASSWORD: config.password || '', PGCONNECT_TIMEOUT: '15' } });
    if (!loaded.ok) throw new Error(`Loading the copy failed: ${(loaded.stderr || loaded.stdout).trim().split(/\r?\n/).slice(-3).join(' ')}`);
    set('load', 'done');

    // 7. Every table must have exactly the rows it had in the snapshot.
    current = 'compare';
    set('compare', 'working', `${Object.keys(before).length} tables...`);
    const fresh = deps.createClient({ ...config, host: 'localhost', port });
    let after;
    try {
      await fresh.connect();
      after = await countTables(fresh);
      const differ = countDifferences(before, after);
      if (differ.length) {
        throw new Error(`The copy doesn't match, so nothing was switched: ${differ.slice(0, 5).map((d) => `${d.table} has ${d.after === null ? 'no table' : d.after} instead of ${d.before}`).join('; ')}.`);
      }
      // The note in the new database: it arrived here, from where.
      await fresh.query(`UPDATE companion_database_move SET state = 'arrived', host = $1, port = $2, from_host = $3, updated_at = now(), moved_at = now() WHERE id = 1`,
        [input.address, port, config.host]);
    } finally {
      await fresh.end().catch(() => {});
    }
    const rows = Object.values(before).reduce((t, n) => t + n, 0);
    set('compare', 'done', `${Object.keys(before).length} tables, ${rows.toLocaleString()} rows, all the same.`);

    // 8. The point of no return: the old database sends everyone here, and this app switches first.
    current = 'switch';
    set('switch', 'working', 'leaving the new address in the old database...');
    clearInterval(heartbeat);
    heartbeat = null;
    await old.query(`UPDATE companion_database_move SET state = 'moved', updated_at = now(), moved_at = now() WHERE id = 1`);
    undo.pausing = false;
    deps.saveConfig({ ...config, host: 'localhost', port });
    set('switch', 'done', `Every app and plugin switches to ${input.address}:${port} at its next refresh or sync.`);
    return { ok: true, steps, to: `${input.address}:${port}` };
  } catch (err) {
    set(current, 'failed', err.message);
    const undone = await putBack(undo, { old, admin, heartbeat, config, connectAdmin, formatted });
    return { ok: false, error: err.message + (undone.length ? ` ${undone.join(' ')}` : ''), steps };
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    if (old) await old.end().catch(() => {});
    if (admin) await admin.end().catch(() => {});
    if (undo.dump) fs.rmSync(undo.dump, { force: true });
  }
}

// After a failure: plugins carry on, and the database made on this PC goes (the one that was here comes
// back under its name). Returns sentences about anything that couldn't be put back.
async function putBack(undo, { old, admin, heartbeat, config, connectAdmin, formatted }) {
  const problems = [];
  if (heartbeat) clearInterval(heartbeat);
  if (undo.pausing && old) {
    try {
      await old.query(`DELETE FROM companion_database_move WHERE id = 1 AND state = 'pausing'`);
    } catch {
      problems.push('The plugins carry on syncing by themselves within 5 minutes.');
    }
  }
  if (undo.createdDatabase || undo.kept || undo.createdRole) {
    let a = admin;
    try {
      if (!a) a = await connectAdmin();
      if (undo.createdDatabase) {
        await a.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [config.database]);
        await a.query(await formatted(a, 'DROP DATABASE IF EXISTS %I', config.database));
      }
      if (undo.kept) await a.query(await formatted(a, 'ALTER DATABASE %I RENAME TO %I', undo.kept, config.database));
      if (undo.createdRole) await a.query(await formatted(a, 'DROP ROLE IF EXISTS %I', config.user));
    } catch (err) {
      problems.push(`Tidying up on this PC didn't finish (${err.message}).`);
    } finally {
      if (a && a !== admin) await a.end().catch(() => {});
    }
  }
  if (!problems.length) problems.push('The database is still where it was, and every PC carries on using it.');
  return problems;
}

module.exports = {
  MOVE_PLUGIN_VERSION, RECENT_DAYS, addressChoices, checkPcs, toolMajor, serverMajor, keptName, countDifferences,
  stepsFor, checkOld, moveDatabase,
};
