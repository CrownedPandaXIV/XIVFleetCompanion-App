// Checks "If the database PC dies" (README): a backup restored onto a brand-new database on another PC, the way
// someone would after losing the PC that had the database. The old server is PGHOST/PGPORT/PGUSER/PGPASSWORD;
// the new one is REBUILD_NEW_PORT (default 5433) on localhost, with REBUILD_NEW_PASSWORD (default PGPASSWORD) for
// its "postgres" login. Both must be scratch servers: it makes and drops databases named rebuild_* and a login
// named rebuild_app, and writes only to temporary folders. Needs pg_dump and pg_restore on the PATH.
const { Client } = require('pg');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ensureDatabase } = require('../../db/apply-updates');
const { createDatabase } = require('../../setup/create-database');
const { backupNow, checkBackupFile, restoreBackup } = require('../../backups/run');
const { findTools } = require('../../backups/tools');
const { listBackups } = require('../../backups/files');

const OLD = { host: process.env.PGHOST || 'localhost', port: Number(process.env.PGPORT) || 5432, user: process.env.PGUSER || 'postgres', password: process.env.PGPASSWORD || '' };
const NEW_PORT = Number(process.env.REBUILD_NEW_PORT) || 5433;
const NEW_ADMIN = { host: 'localhost', port: NEW_PORT, user: 'postgres', password: process.env.REBUILD_NEW_PASSWORD || OLD.password };
const DB = 'rebuild_fleet';
const APP = { user: 'rebuild_app', password: 'a long app password' };
const tempDir = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `rebuild-${name}-`));

let n = 0;
async function scenario(name, fn) {
  try { await fn(); console.log(`PASS ${++n}. ${name}`); } catch (e) { console.log(`FAIL ${++n}. ${name}\n   ${e.stack}`); process.exitCode = 1; }
}

async function connect(config) {
  const c = new Client(config);
  await c.connect();
  return c;
}

// Every table of the app's, with its row count.
async function counts(client) {
  const tables = (await client.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`)).rows.map((r) => r.tablename);
  const out = {};
  for (const t of tables) out[t] = Number((await client.query(`SELECT count(*) AS n FROM "${t}"`)).rows[0].n);
  return out;
}

(async () => {
  const tools = await findTools('');
  assert.ok(tools.found, `pg_dump must be on the PATH: ${tools.error}`);

  // The old PC: a database the app set up, with some history, backed up every night to a USB drive.
  const oldAdmin = await connect({ ...OLD, database: 'postgres' });
  await oldAdmin.query(`DROP DATABASE IF EXISTS ${DB}`);
  await oldAdmin.query(`CREATE DATABASE ${DB}`);
  const old = await connect({ ...OLD, database: DB });
  await ensureDatabase(old, { appVersion: 'test' });
  await old.query(`INSERT INTO companion_character_current (cid, name, world, gil) VALUES (1, 'Aki', 'Maduin', 100), (2, 'Bex', 'Golem', 200)`);
  await old.query(`INSERT INTO tier3_settings (setting_key, setting_value) VALUES ('rebuild_marker', 'from the old PC')
    ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value`);
  const usb = tempDir('usb');
  const made = await backupNow({ tools, config: { ...OLD, database: DB }, settings: { folder: usb, copyFolder: '', keep: 5 } });
  assert.strictEqual(made.ok, true, made.message);
  // Renamed, as a copy someone keeps by hand might be.
  const backupFile = path.join(usb, 'fleet backup from desktop 2.dump');
  fs.renameSync(made.file, backupFile);
  const before = await counts(old);
  await old.end();

  // The new PC: Set up this PC made a new database and the app's login, and the app set up its tables.
  const newAdmin = await connect({ ...NEW_ADMIN, database: 'postgres' });
  const dropNew = async () => {
    await newAdmin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await newAdmin.query(`DROP ROLE IF EXISTS ${APP.user}`);
  };
  await dropNew();
  const app = { host: 'localhost', port: NEW_PORT, database: DB, ...APP };
  const settings = { folder: tempDir('newbackups'), copyFolder: '', keep: 14 };

  await scenario('a new database on the new PC, set up by the app as on any new install', async () => {
    assert.deepStrictEqual(await createDatabase(newAdmin, { database: DB, ...APP }), { ok: true });
    const c = await connect(app);
    try {
      const r = await ensureDatabase(c, { appVersion: 'test', user: APP.user });
      assert.strictEqual(r.created, true);
      assert.strictEqual(Number((await c.query('SELECT count(*) AS n FROM companion_character_current')).rows[0].n), 0);
    } finally {
      await c.end();
    }
  });

  await scenario('a file that is not a backup of the app is turned down before anything happens', async () => {
    const junk = path.join(usb, 'notes.dump');
    fs.writeFileSync(junk, 'not a backup');
    const r = await checkBackupFile({ tools, file: junk });
    assert.deepStrictEqual(r, { ok: false, message: "notes.dump isn't a backup of the app's database, so it can't be restored." });
    assert.strictEqual((await checkBackupFile({ tools, file: path.join(usb, 'gone.dump') })).ok, false);
    assert.deepStrictEqual(await checkBackupFile({ tools, file: backupFile }), { ok: true });
  });

  await scenario('the old backup restores onto it, as the app\'s own login, with every table and row back', async () => {
    const r = await restoreBackup({ tools, config: app, settings, file: backupFile });
    assert.strictEqual(r.ok, true, r.message);
    assert.strictEqual(listBackups(settings.folder).length, 1, 'the empty new database was backed up first');
    const c = await connect(app);
    try {
      assert.deepStrictEqual(await counts(c), before);
      assert.strictEqual((await c.query(`SELECT setting_value FROM tier3_settings WHERE setting_key = 'rebuild_marker'`)).rows[0].setting_value, 'from the old PC');
    } finally {
      await c.end();
    }
  });

  await scenario('after it, the app finds the database up to date, and the plugin\'s login can write as before', async () => {
    const c = await connect(app);
    try {
      const r = await ensureDatabase(c, { appVersion: 'test', user: APP.user });
      assert.strictEqual(r.version, r.latest);
      assert.deepStrictEqual(r.applied, []);
      await c.query(`INSERT INTO companion_character_current (cid, name, world, gil) VALUES (3, 'Cel', 'Maduin', 300)`);
      await c.query(`UPDATE companion_character_current SET gil = 150 WHERE cid = 1`);
      const owner = (await c.query(`SELECT tableowner FROM pg_tables WHERE tablename = 'companion_character_current'`)).rows[0].tableowner;
      assert.strictEqual(owner, APP.user, 'the restored tables belong to the app\'s login on the new PC');
    } finally {
      await c.end();
    }
  });

  await dropNew();
  await newAdmin.end();
  await oldAdmin.query(`DROP DATABASE IF EXISTS ${DB}`);
  await oldAdmin.end();
  fs.rmSync(usb, { recursive: true, force: true });
  fs.rmSync(settings.folder, { recursive: true, force: true });
})().catch((e) => { console.error(e); process.exitCode = 1; });
