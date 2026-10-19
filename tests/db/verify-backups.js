// Checks backups (backups/run.js) against a real Postgres with the real pg_dump and pg_restore (they must
// be on the PATH, as on the CI runners). Set PGHOST, PGPORT, PGUSER, PGPASSWORD for a scratch server, as a
// login that can create databases: it makes and drops databases named bkp_* and fleet_restore_test, and
// writes only to temporary folders.
const { Client } = require('pg');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { backupNow, testBackup, restoreBackup } = require('../../backups/run');
const { findTools } = require('../../backups/tools');
const { listBackups } = require('../../backups/files');

const SCHEMA = fs.readFileSync(path.join(__dirname, '../../db/schema.sql'), 'utf8');
const DB = 'bkp_live';
const config = {
  host: process.env.PGHOST || 'localhost', port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'postgres', password: process.env.PGPASSWORD || '', database: DB,
};
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bkp-'));
const at = (minute) => new Date(2026, 9, 17, 3, minute, 0);

let n = 0;
async function scenario(name, fn) {
  try { await fn(); console.log(`PASS ${++n}. ${name}`); } catch (e) { console.log(`FAIL ${++n}. ${name}\n   ${e.stack}`); process.exitCode = 1; }
}

(async () => {
  const admin = new Client({ ...config, database: process.env.PGDATABASE || 'postgres' });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
  await admin.query(`CREATE DATABASE ${DB}`);
  const live = new Client(config);
  await live.connect();
  await live.query(SCHEMA);
  await live.query(`INSERT INTO companion_character_current (cid, name, world, gil) VALUES (1, 'Aki', 'Maduin', 100), (2, 'Bex', 'Golem', 200)`);
  const gil = async () => (await live.query('SELECT cid::int, gil::int FROM companion_character_current ORDER BY cid')).rows;

  const tools = await findTools('');
  assert.ok(tools.found, `pg_dump must be on the PATH: ${tools.error}`);
  const folder = tempDir();
  const copyFolder = path.join(tempDir(), 'copies');
  const settings = { folder, copyFolder, keep: 2 };

  await scenario('a backup is written, read back, copied to the second folder, and logged', async () => {
    const r = await backupNow({ tools, config, settings, now: at(0) });
    assert.strictEqual(r.ok, true, r.message);
    assert.strictEqual(path.basename(r.file), 'fleet-20261017-030000.dump');
    assert.ok(r.size > 1000);
    assert.strictEqual(r.copied, path.join(copyFolder, 'fleet-20261017-030000.dump'));
    assert.deepStrictEqual(fs.readdirSync(folder).sort(), ['backup.log', 'fleet-20261017-030000.dump']);
    assert.match(fs.readFileSync(path.join(folder, 'backup.log'), 'utf8'), /Backup written: .*fleet-20261017-030000\.dump[\s\S]*Copied to/);
  });

  await scenario('only the newest `keep` are kept, in both folders; other files are left alone', async () => {
    fs.writeFileSync(path.join(folder, 'character-snapshot-20260101-000000.dump'), 'keep me');
    await backupNow({ tools, config, settings, now: at(1) });
    await backupNow({ tools, config, settings, now: at(2) });
    assert.deepStrictEqual(listBackups(folder).map((b) => b.name), ['fleet-20261017-030200.dump', 'fleet-20261017-030100.dump']);
    assert.deepStrictEqual(listBackups(copyFolder).map((b) => b.name), ['fleet-20261017-030200.dump', 'fleet-20261017-030100.dump']);
    assert.ok(fs.existsSync(path.join(folder, 'character-snapshot-20260101-000000.dump')));
  });

  await scenario('a second copy that cannot be made leaves the backup in place and says why', async () => {
    const blocked = path.join(tempDir(), 'a-file');
    fs.writeFileSync(blocked, 'not a folder');
    const r = await backupNow({ tools, config, settings: { ...settings, copyFolder: blocked }, now: at(3) });
    assert.strictEqual(r.ok, true);
    assert.ok(r.copyError);
    assert.match(r.message, /The second copy failed/);
    assert.ok(fs.existsSync(path.join(folder, 'fleet-20261017-030300.dump')));
    assert.match(fs.readFileSync(path.join(folder, 'backup.log'), 'utf8'), /COPY FAILED/);
  });

  await scenario('a wrong password fails with the tool\'s message and leaves no half-written file', async () => {
    const r = await backupNow({ tools, config: { ...config, database: 'bkp_missing' }, settings: { ...settings, copyFolder: '' }, now: at(4) });
    assert.strictEqual(r.ok, false);
    assert.match(r.message, /pg_dump failed: .*bkp_missing/);
    assert.deepStrictEqual(fs.readdirSync(folder).filter((f) => f.includes('030400')), []);
    assert.match(fs.readFileSync(path.join(folder, 'backup.log'), 'utf8'), /FAILED: pg_dump failed/);
  });

  await scenario('testing a backup loads it into a temporary database, compares, and removes it', async () => {
    await live.query(`INSERT INTO companion_character_current (cid, name) VALUES (3, 'Cal')`);
    const r = await testBackup({ tools, config, file: listBackups(folder)[0].file });
    assert.strictEqual(r.ok, true, r.message);
    const chars = r.rows.find((x) => x.table === 'companion_character_current');
    assert.deepStrictEqual([chars.live, chars.restored], [3, 2]);
    const left = await admin.query(`SELECT 1 FROM pg_database WHERE datname = 'fleet_restore_test'`);
    assert.strictEqual(left.rows.length, 0);
    await live.query('DELETE FROM companion_character_current WHERE cid = 3');
  });

  await scenario('restoring puts the data back, after first backing up how it was', async () => {
    const before = listBackups(folder)[0];
    await live.query('UPDATE companion_character_current SET gil = 999 WHERE cid = 1');
    await live.query(`INSERT INTO companion_character_current (cid, name) VALUES (4, 'Dara')`);
    const r = await restoreBackup({ tools, config, settings: { ...settings, copyFolder: '' }, file: before.file });
    assert.strictEqual(r.ok, true, r.message);
    assert.deepStrictEqual(await gil(), [{ cid: 1, gil: 100 }, { cid: 2, gil: 200 }]);
    // The backup made first has the changed data, so the restore can be undone.
    const undo = await restoreBackup({ tools, config, settings: { ...settings, copyFolder: '' }, file: r.safety.file });
    assert.strictEqual(undo.ok, true, undo.message);
    assert.deepStrictEqual(await gil(), [{ cid: 1, gil: 999 }, { cid: 2, gil: 200 }, { cid: 4, gil: null }]);
  });

  await scenario('a restore that fails part way changes nothing', async () => {
    const broken = path.join(folder, 'fleet-20261017-035900.dump');
    fs.writeFileSync(broken, 'PGDMP not really');
    const r = await restoreBackup({ tools, config, settings: { ...settings, copyFolder: '' }, file: broken });
    assert.strictEqual(r.ok, false);
    assert.match(r.message, /Nothing was changed/);
    assert.ok(fs.existsSync(broken), 'the backup being restored, though the oldest, was not tidied away first');
    assert.deepStrictEqual(await gil(), [{ cid: 1, gil: 999 }, { cid: 2, gil: 200 }, { cid: 4, gil: null }]);
    fs.unlinkSync(broken);
  });

  await scenario('a backup folder on a drive that is not there says so', async () => {
    if (process.platform !== 'win32') return; // drive letters are a Windows thing
    const r = await backupNow({ tools, config, settings: { folder: 'Q:\\FleetBackups', copyFolder: '', keep: 2 } });
    assert.match(r.message, /Drive Q:\\ is not available/);
  });

  await live.end();
  await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
  await admin.end();
})().catch((e) => { console.error(e); process.exitCode = 1; });
