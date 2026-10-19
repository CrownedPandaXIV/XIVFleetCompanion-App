// Making, checking and restoring backups with PostgreSQL's own tools (pg_dump's compressed "custom"
// format, restored with pg_restore). The password goes to the tools through their environment, from the
// app's saved (encrypted) connection, so nothing else has to store it. No Electron here: the callers
// pass the connection, the settings and the tools (tests/db/verify-backups.js runs this on its own).
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { run } = require('./tools');
const { backupName, listBackups, backupsToRemove } = require('./files');

// Tables whose row counts are compared when a backup is tested.
const TEST_TABLES = ['companion_character_current', 'companion_metric_history', 'companion_metric_latest',
  'companion_submarine_snapshot', 'companion_retainer_lookup', 'companion_inventory_snapshot'];
const TEST_DATABASE = 'fleet_restore_test';

const connectionArgs = (config) => ['-h', String(config.host), '-p', String(config.port || 5432), '-U', String(config.user)];
const toolEnv = (config) => ({ ...process.env, PGPASSWORD: config.password || '', PGCONNECT_TIMEOUT: '15' });

// The tool's own message, or a plain one.
const toolError = (what, r) => `${what} failed: ${(r.stderr || r.stdout).trim().split(/\r?\n/).slice(-3).join(' ') || `exit code ${r.code}`}`;

function stamp(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;
}

// Adds lines to backup.log in the backup folder (kept to its last 1000 lines).
function writeLog(folder, lines) {
  try {
    const file = path.join(folder, 'backup.log');
    let old = [];
    try { old = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean); } catch { /* a new log */ }
    const all = [...old, ...lines.map((l) => `${stamp()}  ${l}`)].slice(-1000);
    fs.writeFileSync(file, all.join('\r\n') + '\r\n');
  } catch { /* the log is a help, never a reason to fail */ }
}

function removeOld(folder, keep, log, label) {
  for (const old of backupsToRemove(listBackups(folder), keep)) {
    try {
      fs.unlinkSync(old.file);
      log.push(`Removed old ${label} ${old.name}`);
    } catch (err) {
      log.push(`Could not remove old ${label} ${old.name}: ${err.message}`);
    }
  }
}

// Copies a file under a temporary name and renames it when complete, so a half-copied file never looks
// like a backup.
function copyComplete(file, folder) {
  fs.mkdirSync(folder, { recursive: true });
  const final = path.join(folder, path.basename(file));
  const partial = `${final}.partial`;
  try {
    fs.copyFileSync(file, partial);
    if (fs.statSync(partial).size !== fs.statSync(file).size) throw new Error('the copy is not the same size as the backup');
    fs.renameSync(partial, final);
  } catch (err) {
    try { fs.unlinkSync(partial); } catch { /* nothing left behind */ }
    throw err;
  }
  return final;
}

// One backup: pg_dump to a temporary name, read it back with pg_restore --list (proves it is a complete
// archive), give it its final name, remove backups beyond `keep`, then the second copy if one is set.
// Returns { ok, file, size, copied, message } (ok is true when the backup is made, even if the copy
// failed: copyError says why).
async function backupNow({ tools, config, settings, now = new Date() }) {
  const log = [];
  const result = { ok: false, at: now.getTime(), file: null, size: null, copied: null, copyError: null, message: '' };
  const folder = settings.folder;
  let partial = null;
  try {
    if (!folder) throw new Error('No backup folder is chosen.');
    const root = path.parse(path.resolve(folder)).root;
    if (root && !fs.existsSync(root)) throw new Error(`Drive ${root} is not available (is it plugged in?).`);
    fs.mkdirSync(folder, { recursive: true });
    // Two backups in the same second (a restore's backup made first, then the restore of it) must not
    // share a name, so a taken name moves on a second.
    let taken = now.getTime();
    while (fs.existsSync(path.join(folder, backupName(new Date(taken))))) taken += 1000;
    const final = path.join(folder, backupName(new Date(taken)));
    partial = `${final}.partial`;
    log.push(`Starting backup of '${config.database}' on ${config.host}:${config.port || 5432}`);
    const dump = await run(tools.dump, [...connectionArgs(config), '-d', String(config.database), '-Fc', '-f', partial], { env: toolEnv(config) });
    if (!dump.ok) throw new Error(toolError('pg_dump', dump));
    const list = await run(tools.restore, ['--list', partial]);
    if (!list.ok) throw new Error(toolError('Reading the new backup back', list));
    fs.renameSync(partial, final);
    partial = null;
    result.file = final;
    result.size = fs.statSync(final).size;
    log.push(`Backup written: ${final} (${(result.size / 1048576).toFixed(1)} MB)`);
    removeOld(folder, settings.keep, log, 'backup');
    result.ok = true;
    result.message = `Backed up (${(result.size / 1048576).toFixed(1)} MB).`;
  } catch (err) {
    if (partial) { try { fs.unlinkSync(partial); } catch { /* nothing left behind */ } }
    log.push(`FAILED: ${err.message}`);
    result.message = err.message;
    if (folder && fs.existsSync(folder)) writeLog(folder, log);
    return result;
  }

  if (settings.copyFolder) {
    try {
      result.copied = copyComplete(result.file, settings.copyFolder);
      log.push(`Copied to ${result.copied}`);
      removeOld(settings.copyFolder, settings.keep, log, 'copy');
      result.message += ' Second copy made.';
    } catch (err) {
      result.copyError = err.message;
      log.push(`COPY FAILED (the backup in ${folder} is fine): ${err.message}`);
      result.message += ` The second copy failed: ${err.message}`;
    }
  }
  writeLog(folder, log);
  return result;
}

async function countRows(client, table) {
  const exists = (await client.query('SELECT to_regclass($1) IS NOT NULL AS e', [table])).rows[0].e;
  if (!exists) return null;
  return Number((await client.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);
}

// Loads a backup into a temporary database (fleet_restore_test), compares row counts with the live
// database and removes the temporary one. The live database is only read. Needs a login that may create
// databases. Returns { ok, rows: [{ table, live, restored }], message }.
async function testBackup({ tools, config, file }) {
  const admin = new Client({ ...config, port: Number(config.port || 5432) });
  await admin.connect();
  try {
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${TEST_DATABASE}`);
      await admin.query(`CREATE DATABASE ${TEST_DATABASE}`);
    } catch (err) {
      if (err.code === '42501') {
        return { ok: false, rows: [], message: `The database login "${config.user}" may not create the temporary database a test needs. The backup was already checked as complete when it was made.` };
      }
      throw err;
    }
    try {
      const r = await run(tools.restore, [...connectionArgs(config), '-d', TEST_DATABASE, '--no-owner', '--no-privileges', file], { env: toolEnv(config) });
      if (!r.ok) return { ok: false, rows: [], message: toolError('Loading the backup', r) };
      const restored = new Client({ ...config, port: Number(config.port || 5432), database: TEST_DATABASE });
      await restored.connect();
      const rows = [];
      try {
        for (const table of TEST_TABLES) rows.push({ table, live: await countRows(admin, table), restored: await countRows(restored, table) });
      } finally {
        await restored.end().catch(() => {});
      }
      // The live database keeps growing after the backup, so more rows live than restored is expected.
      const bad = rows.filter((r) => r.live !== null && (r.restored === null || r.restored > r.live));
      return bad.length === 0
        ? { ok: true, rows, message: 'The backup restores and its tables are all there.' }
        : { ok: false, rows, message: `The backup is missing or has odd counts for ${bad.map((b) => b.table).join(', ')}.` };
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS ${TEST_DATABASE}`).catch(() => {});
    }
  } finally {
    await admin.end().catch(() => {});
  }
}

// Puts the database back as it was in `file`: first a backup of how it is now (so this can be undone),
// then pg_restore --clean in one transaction, so a failure part way changes nothing. Tables made after
// that backup are kept. Returns { ok, safety: <the backup made first>, message }.
async function restoreBackup({ tools, config, settings, file }) {
  if (!fs.existsSync(file)) return { ok: false, message: `${file} is not there any more.` };
  // Removes no old backups: the one being restored may be the oldest. The next daily backup tidies up.
  const safety = await backupNow({ tools, config, settings: { ...settings, copyFolder: '', keep: Number.MAX_SAFE_INTEGER } });
  if (!safety.ok) return { ok: false, safety, message: `Nothing was restored: first backing up the database as it is now failed. ${safety.message}` };
  const r = await run(tools.restore, [...connectionArgs(config), '-d', String(config.database), '--clean', '--if-exists',
    '--single-transaction', '--no-owner', '--no-privileges', file], { env: toolEnv(config) });
  writeLog(settings.folder, [r.ok ? `Restored ${path.basename(file)} (the database before it is ${path.basename(safety.file)})` : `RESTORE FAILED, nothing changed: ${toolError('pg_restore', r)}`]);
  if (!r.ok) return { ok: false, safety, message: `${toolError('Restoring', r)} Nothing was changed.` };
  return { ok: true, safety, message: `Restored. The database as it was just before is saved as ${path.basename(safety.file)}.` };
}

module.exports = { backupNow, testBackup, restoreBackup, writeLog, TEST_DATABASE };
