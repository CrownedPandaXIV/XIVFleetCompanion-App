// Checks the app's database updates (db/apply-updates.js) against a real Postgres. Set PGHOST, PGPORT, PGUSER,
// PGPASSWORD, PGDATABASE for a scratch server, as a login that can create databases and roles: it makes
// and drops databases named dbupd_* and a role named dbupd_reader.
const { Client } = require('pg');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ensureDatabase, schemaTables } = require('../../db/apply-updates');

const SCHEMA = fs.readFileSync(path.join(__dirname, '../../db/schema.sql'), 'utf8');
const NO_UPDATES = fs.mkdtempSync(path.join(os.tmpdir(), 'dbupd-none-'));

let n = 0;
async function scenario(name, fn) {
  try { await fn(); console.log(`PASS ${++n}. ${name}`); } catch (e) { console.log(`FAIL ${++n}. ${name}\n   ${e.stack}`); process.exitCode = 1; }
}

const admin = new Client();
async function freshDatabase(name) {
  await admin.query(`DROP DATABASE IF EXISTS ${name}`);
  await admin.query(`CREATE DATABASE ${name}`);
  const c = new Client({ database: name });
  await c.connect();
  // As on Postgres 15 and later: only the owner may create tables in public.
  await c.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
  return c;
}
const updatesDir = (files) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbupd-'));
  for (const [file, sql] of Object.entries(files)) fs.writeFileSync(path.join(dir, file), sql);
  return dir;
};
const versions = async (c) => (await c.query('SELECT version, name FROM companion_schema_version ORDER BY version')).rows;
const columns = async (c) => (await c.query(
  `SELECT table_name || '.' || column_name || ' ' || data_type AS col FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name <> 'companion_schema_version' ORDER BY 1`)).rows.map((r) => r.col);
const indexes = async (c) => (await c.query(
  `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1`)).rows.map((r) => r.indexname);

(async () => {
  await admin.connect();
  await admin.query('DROP ROLE IF EXISTS dbupd_reader');
  await admin.query(`CREATE ROLE dbupd_reader LOGIN PASSWORD 'reader'`);

  const reference = await freshDatabase('dbupd_reference');
  await reference.query(SCHEMA);
  const refColumns = await columns(reference);
  const refIndexes = await indexes(reference);

  await scenario('an empty database gets every table, recorded as the newest version', async () => {
    const c = await freshDatabase('dbupd_empty');
    const r = await ensureDatabase(c, { updatesDir: NO_UPDATES, appVersion: '9.9.9' });
    assert.strictEqual(r.created, true);
    assert.strictEqual(r.version, 9);
    assert.deepStrictEqual(await columns(c), refColumns);
    assert.deepStrictEqual(await versions(c), [{ version: 9, name: 'new database' }]);
    const again = await ensureDatabase(c, { updatesDir: NO_UPDATES });
    assert.deepStrictEqual([again.created, again.applied, again.version], [false, [], 9]);
    await c.end();
  });

  await scenario('a database made by schema.sql (no version yet) needs nothing and is recorded as version 9', async () => {
    const c = await freshDatabase('dbupd_current');
    await c.query(SCHEMA);
    const r = await ensureDatabase(c, { updatesDir: NO_UPDATES });
    assert.deepStrictEqual(r.applied, []);
    assert.deepStrictEqual(await versions(c), [{ version: 9, name: 'catch-up' }]);
    assert.deepStrictEqual(await columns(c), refColumns);
    await c.end();
  });

  await scenario('an older database (without the labels, or versions 6 to 9) is brought up to schema.sql by the catch-up and db/updates', async () => {
    const c = await freshDatabase('dbupd_older');
    await c.query(SCHEMA);
    await c.query(`INSERT INTO companion_submarine_snapshot (cid, sub_name) VALUES (1, 'Submersible-2'), (1, 'Renamed')`);
    await c.query(`DROP TABLE companion_schema_version, companion_pc_status, companion_venture_result, companion_market_listing;
                   DROP INDEX companion_metric_history_metric_idx;
                   ALTER TABLE companion_voyage_loot DROP COLUMN leg;
                   ALTER TABLE companion_retainer_lookup DROP COLUMN items_seen_at;
                   ALTER TABLE companion_submarine_snapshot DROP COLUMN slot;
                   ALTER TABLE companion_metric_latest DROP COLUMN label;
                   DROP TABLE companion_database_move, companion_rankup_forecast;`);
    const r = await ensureDatabase(c);
    assert.deepStrictEqual(r.applied.slice().sort(), [
      'added companion_market_listing', 'added companion_metric_history_metric_idx', 'added companion_metric_latest.label',
      'added companion_pc_status', 'added companion_retainer_lookup.items_seen_at', 'added companion_submarine_snapshot.slot',
      'added companion_venture_result', 'added companion_venture_result_received_idx', 'added companion_voyage_loot.leg',
      'update 10: database_move', 'update 11: rankup_forecasts']);
    assert.deepStrictEqual((await columns(c)).slice().sort(), refColumns.slice().sort());
    assert.deepStrictEqual(await indexes(c), refIndexes);
    const slots = (await c.query('SELECT sub_name, slot FROM companion_submarine_snapshot ORDER BY sub_name')).rows;
    assert.deepStrictEqual(slots, [{ sub_name: 'Renamed', slot: null }, { sub_name: 'Submersible-2', slot: 2 }]);
    assert.deepStrictEqual(await versions(c), [{ version: 9, name: 'catch-up' }, { version: 10, name: 'database_move' }, { version: 11, name: 'rankup_forecasts' }]);
    await c.end();
  });

  await scenario('updates are applied once, in order; a failing one changes nothing and stops there', async () => {
    const c = await freshDatabase('dbupd_updates');
    await c.query(SCHEMA);
    const dir = updatesDir({
      '011_add_note.sql': 'ALTER TABLE upd_test ADD COLUMN note text;',
      '010_add_table.sql': 'CREATE TABLE upd_test (id int);',
    });
    const r = await ensureDatabase(c, { updatesDir: dir });
    assert.deepStrictEqual([r.version, r.latest, r.applied], [11, 11, ['update 10: add_table', 'update 11: add_note']]);
    assert.deepStrictEqual((await versions(c)).map((v) => v.version), [9, 10, 11]);
    const again = await ensureDatabase(c, { updatesDir: dir });
    assert.deepStrictEqual(again.applied, []);

    fs.writeFileSync(path.join(dir, '012_broken.sql'), 'CREATE TABLE upd_half (id int); SELECT 1/0;');
    fs.writeFileSync(path.join(dir, '013_later.sql'), 'CREATE TABLE upd_later (id int);');
    await assert.rejects(ensureDatabase(c, { updatesDir: dir }), /Database update 12 \(broken\) failed, so nothing of it was applied: division by zero/);
    assert.deepStrictEqual((await versions(c)).map((v) => v.version), [9, 10, 11]);
    const left = (await c.query(`SELECT to_regclass('upd_half') AS half, to_regclass('upd_later') AS later`)).rows[0];
    assert.deepStrictEqual(left, { half: null, later: null });
    assert.strictEqual((await c.query('SELECT 1 AS ok')).rows[0].ok, 1, 'the connection is still usable');
    await c.end();
  });

  await scenario('a new database also skips the update files (schema.sql already has them)', async () => {
    const c = await freshDatabase('dbupd_empty2');
    const dir = updatesDir({ '010_add_table.sql': 'CREATE TABLE upd_test (id int);' });
    const r = await ensureDatabase(c, { updatesDir: dir });
    assert.deepStrictEqual([r.created, r.version], [true, 10]);
    assert.strictEqual((await c.query(`SELECT to_regclass('upd_test') AS t`)).rows[0].t, null);
    await c.end();
  });

  await scenario('a database a newer app updated further is left alone and reported', async () => {
    const c = await freshDatabase('dbupd_newer');
    await c.query(SCHEMA);
    await c.query(`INSERT INTO companion_schema_version (version, name) VALUES (9, 'catch-up'), (14, 'from the future')`);
    const r = await ensureDatabase(c, { updatesDir: NO_UPDATES });
    assert.deepStrictEqual([r.version, r.newer, r.applied], [14, true, []]);
    await c.end();
  });

  await scenario('a login that may only read: fine while nothing needs changing, a plain message when something does', async () => {
    const c = await freshDatabase('dbupd_reader');
    await c.query(SCHEMA);
    await c.query('DROP TABLE companion_schema_version');
    await c.query('GRANT SELECT ON ALL TABLES IN SCHEMA public TO dbupd_reader');
    const reader = new Client({ database: 'dbupd_reader', user: 'dbupd_reader', password: 'reader' });
    await reader.connect();
    const r = await ensureDatabase(reader, { updatesDir: NO_UPDATES, user: 'dbupd_reader' });
    assert.deepStrictEqual([r.version, r.tracked, r.applied], [9, false, []]);

    const dir = updatesDir({ '010_add_table.sql': 'CREATE TABLE upd_test (id int);' });
    await assert.rejects(ensureDatabase(reader, { updatesDir: dir, user: 'dbupd_reader' }),
      /The database login "dbupd_reader" is not allowed to change the tables/);

    await c.query('ALTER TABLE companion_voyage_loot DROP COLUMN leg');
    await assert.rejects(ensureDatabase(reader, { updatesDir: NO_UPDATES, user: 'dbupd_reader' }),
      /The database login "dbupd_reader" is not allowed to change the tables/);
    assert.strictEqual((await reader.query('SELECT 1 AS ok')).rows[0].ok, 1, 'the connection is still usable');
    await reader.end();
    await c.query('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM dbupd_reader');
    await c.end();
  });

  await scenario('a database with the old snapshot table, or only some tables, is refused without changes', async () => {
    const c = await freshDatabase('dbupd_old');
    await c.query('CREATE TABLE companion_character_snapshot (cid numeric)');
    await assert.rejects(ensureDatabase(c, { updatesDir: NO_UPDATES }), /from before plugin 0\.4\.0/);
    await c.query('DROP TABLE companion_character_snapshot; CREATE TABLE tier3_settings (setting_key text)');
    await assert.rejects(ensureDatabase(c, { updatesDir: NO_UPDATES }), /some of the app's tables/);
    assert.deepStrictEqual((await c.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`)).rows, [{ tablename: 'tier3_settings' }]);
    await c.end();
  });

  await scenario('two copies connecting to an empty database at once: one sets it up, the other waits', async () => {
    const a = await freshDatabase('dbupd_race');
    const b = new Client({ database: 'dbupd_race' });
    await b.connect();
    const [ra, rb] = await Promise.all([ensureDatabase(a, { updatesDir: NO_UPDATES }), ensureDatabase(b, { updatesDir: NO_UPDATES })]);
    assert.deepStrictEqual([ra.created, rb.created].sort(), [false, true]);
    assert.deepStrictEqual([ra.version, rb.version], [9, 9]);
    await a.end();
    await b.end();
  });

  await scenario('schema.sql lists the version table among the tables an empty database is told apart by', async () => {
    assert.ok(schemaTables(SCHEMA).includes('companion_schema_version'));
    assert.ok(schemaTables(SCHEMA).includes('companion_character_current'));
  });

  await reference.end();
  for (const db of ['reference', 'empty', 'current', 'older', 'updates', 'empty2', 'newer', 'reader', 'old', 'race']) {
    await admin.query(`DROP DATABASE IF EXISTS dbupd_${db}`);
  }
  await admin.query('DROP ROLE IF EXISTS dbupd_reader');
  await admin.end();
})().catch((e) => { console.error(e); process.exitCode = 1; });
