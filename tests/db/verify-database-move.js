// Checks "Move the database to this PC" (setup/move-database.js) between two real PostgreSQL servers, with the
// real pg_dump and pg_restore: what it refuses, that a failure part way puts everything back, that a move copies
// every row and leaves the notes every app and plugin follows, and that moving back again keeps the copy left
// behind. The old server is PGHOST/PGPORT/PGUSER/PGPASSWORD; the new one is MOVE_NEW_PORT (default 5433) on
// localhost, with MOVE_NEW_PASSWORD (default PGPASSWORD) for its "postgres" login. Both must be scratch servers:
// this makes and drops databases named move_db* and a login named move_app.
const { Client } = require('pg');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const { moveDatabase, checkOld } = require('../../setup/move-database');
const { readMoveNote, followMove, PLUGIN_APPLICATION_NAME } = require('../../db/database-move');
const { findTools, run } = require('../../backups/tools');

const OLD = { host: process.env.PGHOST || '127.0.0.1', port: Number(process.env.PGPORT) || 5432, user: process.env.PGUSER || 'postgres', password: process.env.PGPASSWORD || '' };
const NEW_PORT = Number(process.env.MOVE_NEW_PORT) || 5433;
const NEW_ADMIN = { host: 'localhost', port: NEW_PORT, user: 'postgres', password: process.env.MOVE_NEW_PASSWORD || OLD.password };
const APP = { user: 'move_app', password: 'move app pass;=1' };
const CONFIG = { host: OLD.host, port: OLD.port, database: 'move_db', user: APP.user, password: APP.password };
const ADDRESS = '100.64.0.9';

let n = 0;
async function scenario(name, fn) {
  try { await fn(); console.log(`PASS ${++n}. ${name}`); } catch (e) { console.log(`FAIL ${++n}. ${name}\n   ${e.stack}`); process.exitCode = 1; }
}

async function connect(config) {
  const c = new Client(config);
  await c.connect();
  return c;
}
const oldAdmin = (database = 'postgres') => connect({ ...OLD, database });
const newAdmin = (database = 'postgres') => connect({ ...NEW_ADMIN, database });
const one = async (config, sql, params) => {
  const c = await connect(config);
  try { return (await c.query(sql, params)).rows; } finally { await c.end(); }
};
const databases = async (admin) => (await admin.query(`SELECT datname FROM pg_database WHERE datname LIKE 'move_db%' ORDER BY 1`)).rows.map((r) => r.datname);
const hasRole = async (admin) => (await admin.query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [APP.user])).rows.length > 0;

// A fleet database on the old server, owned by the app's login, with a little of everything.
async function makeOldDatabase() {
  const admin = await oldAdmin();
  await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname LIKE 'move_db%' AND pid <> pg_backend_pid()`);
  for (const d of await databases(admin)) await admin.query(`DROP DATABASE "${d}"`);
  await admin.query(`DROP ROLE IF EXISTS ${APP.user}`);
  await admin.query(`CREATE ROLE ${APP.user} LOGIN PASSWORD 'move app pass;=1'`);
  await admin.query(`CREATE DATABASE move_db OWNER ${APP.user}`);
  await admin.end();
  const app = await connect(CONFIG);
  await app.query(require('fs').readFileSync(path.join(__dirname, '../../db/schema.sql'), 'utf8'));
  await app.query(require('fs').readFileSync(path.join(__dirname, '../../db/updates/010_database_move.sql'), 'utf8'));
  await app.query(`INSERT INTO companion_character_current (cid, name, world, account_label, last_synced_at)
                   SELECT 1000 + g, 'Char ' || g, 'Maduin', 'Account 1', now() FROM generate_series(1, 40) g`);
  await app.query(`INSERT INTO companion_metric_history (recorded_at, subject_type, subject_id, metric, value)
                   SELECT now() - g * interval '1 hour', 'character', 1001, 'gil', g FROM generate_series(1, 5000) g`);
  await app.query(`INSERT INTO companion_pc_status (pc_name, account_label, plugin_version, last_sync_at, db_user)
                   VALUES ('DESKTOP-1', 'Account 1', '0.14.0', now(), $1), ('LAPTOP', 'Account 2', '0.14.0', now() - interval '1 hour', $1),
                          ('OLD-PC', 'Account 3', '0.9.0', now() - interval '60 days', NULL)`, [APP.user]);
  await app.end();
}

async function clearNew() {
  const admin = await newAdmin();
  await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname LIKE 'move_db%' AND pid <> pg_backend_pid()`);
  for (const d of await databases(admin)) await admin.query(`DROP DATABASE "${d}"`);
  await admin.query(`DROP ROLE IF EXISTS ${APP.user}`);
  await admin.end();
}

const saved = [];
function deps(overrides = {}) {
  return {
    createClient: (config) => new Client(config),
    isThisPc: () => false,
    findTools: () => findTools(process.env.PG_BIN_DIR || undefined),
    runTool: run,
    runElevated: async (steps) => ({ results: steps.map((s) => ({ kind: s.kind, ok: true, message: `${s.kind} done.` })) }),
    recordInstalled: () => {},
    ranges: () => ['100.64.0.0/10'],
    saveConfig: (c) => saved.push(c),
    wait: () => new Promise((r) => setTimeout(r, 5)),
    tmpDir: path.join(os.tmpdir(), 'move-db-test'),
    ...overrides,
  };
}
const input = (extra = {}) => ({ config: CONFIG, address: ADDRESS, port: NEW_PORT, adminPassword: NEW_ADMIN.password, installPostgres: false, ...extra });

async function nothingChanged(label) {
  const admin = await newAdmin();
  assert.deepStrictEqual(await databases(admin), [], `${label}: no database left on the new server`);
  assert.strictEqual(await hasRole(admin), false, `${label}: no login left on the new server`);
  await admin.end();
  const app = await connect(CONFIG);
  assert.strictEqual(await readMoveNote(app), null, `${label}: no note left in the old database`);
  assert.strictEqual(Number((await app.query('SELECT count(*) AS n FROM companion_character_current')).rows[0].n), 40);
  await app.end();
}

(async () => {
  await makeOldDatabase();
  await clearNew();

  await scenario('a PC whose plugin can\'t follow a move stops it before anything is changed', async () => {
    const app = await connect(CONFIG);
    await app.query(`UPDATE companion_pc_status SET plugin_version = '0.13.6', db_user = NULL WHERE pc_name = 'LAPTOP'`);
    const check = await checkOld({ config: CONFIG }, deps());
    assert.strictEqual(check.ok, false);
    assert.match(check.blocking.join(' '), /LAPTOP \(Account 2\) runs plugin 0\.13\.6, which can't follow a move/);
    assert.match(check.notes.join(' '), /OLD-PC \(Account 3\) hasn't synced since/);
    const r = await moveDatabase(input(), deps());
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /LAPTOP/);
    assert.match(r.error, /The database is still where it was/);
    await app.query(`UPDATE companion_pc_status SET plugin_version = '0.14.0', db_user = $1 WHERE pc_name = 'LAPTOP'`, [APP.user]);
    await app.end();
    await nothingChanged('refused');
  });

  await scenario('a database with characters already on the new PC is left alone', async () => {
    const admin = await newAdmin();
    await admin.query('CREATE DATABASE move_db');
    await admin.end();
    const other = await newAdmin('move_db');
    await other.query('CREATE TABLE companion_character_current (cid numeric); INSERT INTO companion_character_current VALUES (1)');
    await other.end();
    const r = await moveDatabase(input(), deps());
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /already has a database called "move_db" with characters in it/);
    assert.deepStrictEqual(await one({ ...NEW_ADMIN, database: 'move_db' }, 'SELECT count(*)::int AS n FROM companion_character_current'), [{ n: 1 }]);
    await clearNew();
    await nothingChanged('left alone');
  });

  await scenario('a plugin still syncing after the wait: nothing is copied, and everything is put back', async () => {
    const plugin = await connect({ ...CONFIG, application_name: PLUGIN_APPLICATION_NAME });
    // A sync that keeps running the whole time.
    const syncing = plugin.query('SELECT pg_sleep(600)').catch(() => {});
    const steps = [];
    const r = await moveDatabase(input(), deps(), (s) => steps.push(s));
    await one({ ...OLD, database: 'postgres' }, `SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE application_name = $1`, [PLUGIN_APPLICATION_NAME]);
    await syncing;
    await plugin.end();
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /A plugin was still syncing after 3 minutes, so nothing was copied/);
    assert.ok(steps.some((s) => s.find((x) => x.id === 'pause').detail === 'waiting for a plugin to finish syncing...'));
    assert.deepStrictEqual(r.steps.find((x) => x.id === 'pause').state, 'failed');
    await nothingChanged('plugin busy');
  });

  await scenario('a copy that fails to load: everything is put back (and PostgreSQL\'s installer is tidied away)', async () => {
    // As on a PC without PostgreSQL: it's "downloaded" and "installed" (the second server stands in for it).
    const installerFile = path.join(os.tmpdir(), `move-test-installer-${process.pid}.exe`);
    require('fs').writeFileSync(installerFile, 'installer');
    const installed = [];
    const removed = [];
    const r = await moveDatabase(input({ installPostgres: true }), deps({
      download: async () => installerFile,
      postgresOptionsFile: () => ({ file: 'options.txt', remove: () => {} }),
      recordInstalled: (what) => installed.push(what),
      removeFile: (file) => { removed.push(file); require('fs').rmSync(file, { force: true }); },
      runTool: (file, args, options) => (/pg_restore/.test(file) ? Promise.resolve({ ok: false, code: 1, stdout: '', stderr: 'pg_restore: error: could not execute query: simulated' }) : run(file, args, options)),
    }));
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /Loading the copy failed: pg_restore: error: could not execute query: simulated/);
    assert.deepStrictEqual(removed, [installerFile], 'the installer is deleted once PostgreSQL is installed');
    assert.strictEqual(require('fs').existsSync(installerFile), false);
    assert.deepStrictEqual(installed, [{ postgres: { port: NEW_PORT } }], 'noted as installed by the app');
    await nothingChanged('load failed');
  });

  await scenario('the move copies every row, leaves the notes, and switches this app', async () => {
    saved.length = 0;
    const steps = [];
    // A plugin connection left open after its sync (its library keeps it for reuse), quiet for over 15 seconds:
    // not a sync, so the move doesn't wait for it.
    const pooled = await connect({ ...CONFIG, application_name: PLUGIN_APPLICATION_NAME });
    await pooled.query('SELECT 1');
    await new Promise((res) => setTimeout(res, 16000));
    const plugin = await connect({ ...CONFIG, application_name: PLUGIN_APPLICATION_NAME });
    // The plugin finishes its sync shortly after being paused.
    setTimeout(() => plugin.end(), 30);
    const r = await moveDatabase(input(), deps({ wait: () => new Promise((res) => setTimeout(res, 20)) }), (s) => steps.push(s));
    await pooled.end();
    assert.strictEqual(r.ok, true, r.error);
    assert.strictEqual(r.to, `${ADDRESS}:${NEW_PORT}`);
    assert.ok(r.steps.every((s) => s.state === 'done'), JSON.stringify(r.steps));
    assert.match(r.steps.find((s) => s.id === 'compare').detail, /tables, [\d,]+ rows, all the same/);
    assert.match(r.steps.find((s) => s.id === 'check').detail, /OLD-PC/);

    const moved = { ...CONFIG, host: 'localhost', port: NEW_PORT };
    assert.deepStrictEqual(saved, [moved]);
    assert.deepStrictEqual(await one(moved, 'SELECT count(*)::int AS n FROM companion_metric_history'), [{ n: 5000 }]);
    assert.deepStrictEqual(await one(moved, 'SELECT count(*)::int AS n FROM companion_character_current'), [{ n: 40 }]);
    const owners = await one(moved, `SELECT DISTINCT tableowner FROM pg_tables WHERE schemaname = 'public'`);
    assert.deepStrictEqual(owners, [{ tableowner: APP.user }], 'the app\'s login owns every table, so it can keep updating them');

    const oldClient = await connect(CONFIG);
    const oldNote = await readMoveNote(oldClient);
    assert.strictEqual(oldNote.state, 'moved');
    assert.strictEqual(oldNote.host, ADDRESS);
    assert.strictEqual(oldNote.port, NEW_PORT);
    const tried = [];
    const follow = await followMove(oldClient, CONFIG, { tryConnect: async (c) => { tried.push(c); } });
    assert.deepStrictEqual(follow, { to: `${ADDRESS}:${NEW_PORT}`, config: { ...CONFIG, host: ADDRESS, port: NEW_PORT } });
    const cannot = await followMove(oldClient, CONFIG, { tryConnect: async () => { throw new Error('no route'); } });
    assert.deepStrictEqual(cannot, { to: `${ADDRESS}:${NEW_PORT}`, error: 'no route' });
    await oldClient.end();

    const newClient = await connect(moved);
    const newNote = await readMoveNote(newClient);
    assert.strictEqual(newNote.state, 'arrived');
    assert.strictEqual(newNote.from_host, CONFIG.host);
    assert.ok(newNote.moved_at);
    assert.strictEqual(await followMove(newClient, moved, { tryConnect: async () => { throw new Error('not called'); } }), null);
    await newClient.end();

    const again = await checkOld({ config: CONFIG }, deps());
    assert.match(again.error, /already moved to 100\.64\.0\.9/);
  });

  await scenario('moving back keeps the copy that was left behind, under another name', async () => {
    saved.length = 0;
    const moved = { ...CONFIG, host: 'localhost', port: NEW_PORT };
    const r = await moveDatabase({ config: moved, address: '100.64.0.1', port: OLD.port, adminPassword: OLD.password, installPostgres: false }, deps());
    assert.strictEqual(r.ok, true, r.error);
    assert.match(r.steps.find((s) => s.id === 'prepare').detail, /The "move_db" that was here \(it's the copy left here when the database moved away before\) is kept as "move_db_before_move_\d{8}_\d{4}"/);
    const admin = await oldAdmin();
    const names = await databases(admin);
    await admin.end();
    assert.strictEqual(names.length, 2);
    assert.deepStrictEqual(await one(CONFIG, 'SELECT count(*)::int AS n FROM companion_metric_history'), [{ n: 5000 }]);
    assert.deepStrictEqual((await one(CONFIG, 'SELECT state, from_host FROM companion_database_move')), [{ state: 'arrived', from_host: 'localhost' }]);
    assert.deepStrictEqual(saved, [{ ...moved, host: 'localhost', port: OLD.port }]);
  });

  await clearNew();
  const admin = await oldAdmin();
  await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname LIKE 'move_db%' AND pid <> pg_backend_pid()`);
  for (const d of await databases(admin)) await admin.query(`DROP DATABASE "${d}"`);
  await admin.query(`DROP ROLE IF EXISTS ${APP.user}`);
  await admin.end();
})().catch((e) => { console.error(e); process.exitCode = 1; });
