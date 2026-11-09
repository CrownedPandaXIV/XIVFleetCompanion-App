// The fleet file's pieces that need no database: where the fleet is (db/fleet-store.js), the translation of the app's
// PostgreSQL queries (db/sqlite-client.js, checked against a real file too) and the game data's column names
// (db/game-data-file.js). Every page on the file is checked against PostgreSQL in tests/db/verify-file-pages.js.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { whereIsTheFleet, readStoreChoice } = require('../db/fleet-store');
const { SqliteClient, translate, param } = require('../db/sqlite-client');
const gameData = require('../db/game-data');
const { columnsFor, loadTable } = require('../db/game-data-file');
const backups = require('../db/fleet-file-backups');

function folder() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-file-test-'));
}

test('where the fleet is follows the plugin\'s choice for the PC', () => {
  const dir = folder();
  const file = path.join(dir, 'fleet.db');
  const choose = (store) => fs.writeFileSync(path.join(dir, 'store.json'), JSON.stringify({ store }));
  assert.strictEqual(whereIsTheFleet({ fleetFile: file, hasDatabase: false }), 'none', 'nothing yet');
  assert.strictEqual(whereIsTheFleet({ fleetFile: file, hasDatabase: true }), 'database', 'a connection, no file');
  fs.writeFileSync(file, '');
  assert.strictEqual(whereIsTheFleet({ fleetFile: file, hasDatabase: false }), 'file', 'a file, no choice written, no connection');
  assert.strictEqual(whereIsTheFleet({ fleetFile: file, hasDatabase: true }), 'database', 'a file and a connection, no choice: as before');
  choose('thisPc');
  assert.strictEqual(whereIsTheFleet({ fleetFile: file, hasDatabase: true }), 'file', 'the game chose this PC: the file, connection or not');
  choose('shared');
  assert.strictEqual(whereIsTheFleet({ fleetFile: file, hasDatabase: true }), 'database', 'the game chose the shared database');
  assert.strictEqual(whereIsTheFleet({ fleetFile: file, hasDatabase: false }), 'none', '...which isn\'t set up here yet');
  fs.writeFileSync(path.join(dir, 'store.json'), '{ not json');
  assert.strictEqual(readStoreChoice(file), null, 'a damaged choice is no choice');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('PostgreSQL\'s SQL as SQLite\'s', () => {
  assert.strictEqual(translate('SELECT a FROM t WHERE b = $1 AND c = $2'), 'SELECT a FROM t WHERE b = ?1 AND c = ?2');
  assert.strictEqual(translate('SELECT x::int, y::text, (a + b)::numeric FROM t'), 'SELECT CAST(x AS INTEGER), CAST(y AS TEXT), pg_numeric((a + b)) FROM t');
  assert.match(translate('SELECT 1 FROM t WHERE id = ANY($1::int[])'), /id IN \(SELECT value FROM json_each\(\?1\)\)/);
  assert.match(translate("SELECT (to_jsonb(s)->>'slot')::int FROM s"), /CAST\(\(s\.slot\) AS INTEGER\)/);
  assert.match(translate("SELECT 1 WHERE t > now() - interval '5 minutes'"), /now\(\) - 300/);
  assert.match(translate('SELECT 1 WHERE t > now() - make_interval(days => $1)'), /\(\(\?1\) \* 86400\)/);
  assert.match(translate("SELECT 1 WHERE name ILIKE ALL($2::text[])"), /NOT EXISTS \(SELECT 1 FROM json_each\(\?2\) WHERE NOT \(name LIKE value ESCAPE '\\'\)\)/);
  assert.match(translate("SELECT 1 WHERE a ~ '^[0-9]+$'"), /a REGEXP '\^\[0-9\]\+\$'/);
  assert.strictEqual(translate("SELECT 'it''s ::text $1' -- a comment's ; here\nFROM t"), "SELECT 'it''s ::text $1' \nFROM t", 'quoted text and comments left alone');
  assert.match(translate('SELECT a FROM t ORDER BY a, b DESC'), /ORDER BY {1,2}a NULLS LAST, b DESC NULLS FIRST/);
  assert.match(translate('SELECT DISTINCT ON (fc_id) fc_id, fc_name FROM h ORDER BY fc_id, updated_at DESC'), /ROW_NUMBER\(\) OVER \(PARTITION BY fc_id ORDER BY/);
  assert.match(translate('INSERT INTO t (a) SELECT a FROM u ON CONFLICT DO NOTHING'), /FROM u\s+WHERE true ON CONFLICT/);
  assert.match(translate('TRUNCATE TABLE fight_club_routes RESTART IDENTITY'), /^DELETE FROM fight_club_routes$/);
  assert.strictEqual(param([new Date(1500), 7n, 'x']), '[1.5,"7","x"]', 'lists as JSON, times as seconds, big numbers exact');
});

test('a query on a file answers as pg would', async () => {
  const dir = folder();
  const c = new SqliteClient(path.join(dir, 'fleet.db'), { gameData: path.join(dir, 'game-data.db') });
  try {
    c.db.exec(`CREATE TABLE companion_character_current (cid INTEGER PRIMARY KEY, name TEXT, last_synced_at REAL, fc_id TEXT);
      INSERT INTO companion_character_current VALUES (18014498578000001, 'Ann', 1794000000.25, '9232379236109516800'), (2, NULL, 1794000000, NULL);
      CREATE TABLE gd.ffxiv_item (id TEXT, name TEXT); INSERT INTO gd.ffxiv_item VALUES ('5', 'Thing');`);
    const { rows } = await c.query('SELECT cid, name, last_synced_at, fc_id FROM companion_character_current WHERE cid = ANY($1::numeric[]) ORDER BY name', [['18014498578000001', '2']]);
    assert.deepStrictEqual(rows.map((r) => r.cid), ['18014498578000001', '2'], 'ids exact, as text (and empty names last)');
    assert.ok(rows[0].last_synced_at instanceof Date && rows[0].last_synced_at.getTime() === 1794000000250, 'times as Dates');
    assert.strictEqual(rows[0].fc_id, '9232379236109516800', 'Free Company ids whole');
    assert.deepStrictEqual((await c.query('SELECT name FROM ffxiv_item WHERE id = $1', ['5'])).rows, [{ name: 'Thing' }], 'the game data found by name');
    assert.strictEqual((await c.query(`SELECT to_regclass('ffxiv_item') IS NOT NULL AS ok`)).rows[0].ok, true, 'to_regclass sees it');
    assert.deepStrictEqual((await c.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'ffxiv_item' ORDER BY ordinal_position`)).rows.map((r) => r.column_name), ['id', 'name']);
    assert.strictEqual((await c.query('UPDATE companion_character_current SET name = $1 WHERE cid = $2', ['Bo', '2'])).rowCount, 1, 'rowCount for a write');
    await c.query('ROLLBACK'); // as in PostgreSQL: nothing open, no error
  } finally {
    await c.end();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the game data file names columns as a new database does', () => {
  const headers = ['#', 'Name', 'Singular', 'LevelItem', 'Ingredient[0]', 'Ingredient[1]', 'ItemResult', 'LandSet[3].MapRange', 'Name'];
  const plan = gameData.planTable({ table: 'ffxiv_x', file: 'X', headers: headers.slice(0, 8), csvRowCount: 1, dbColumns: ['id'], rowsBefore: 0 });
  const byIndex = new Map([...plan.matches, ...plan.added].map((m) => [m.index, m.column]));
  assert.deepStrictEqual(columnsFor(headers.slice(0, 8)), headers.slice(0, 8).map((_, i) => byIndex.get(i)));
  assert.deepStrictEqual(columnsFor(headers).slice(-1), ['name_2'], 'a repeated header gets a number');

  const dir = folder();
  process.removeAllListeners('warning');
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(dir, 'g.db'));
  assert.strictEqual(loadTable(db, 'ffxiv_item', '#,Name,PriceLow\n1,Gil,\n2,"Fire, Shard",1\n'), 2);
  assert.deepStrictEqual(db.prepare('SELECT * FROM ffxiv_item ORDER BY id').all().map((r) => ({ ...r })), [{ id: '1', name: 'Gil', price_low: null }, { id: '2', name: 'Fire, Shard', price_low: '1' }]);
  assert.throws(() => loadTable(db, 'ffxiv_item', 'Name\nx\n'), /no "#"/);
  assert.strictEqual(db.prepare('SELECT count(*) AS n FROM ffxiv_item').get().n, 2, 'a failed load keeps what was there');
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the fleet file\'s backups, named and kept as the plugin keeps them', () => {
  const dir = folder();
  const file = path.join(dir, 'fleet.db');
  process.removeAllListeners('warning');
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE t (x); INSERT INTO t VALUES (1)');
  db.close();
  const first = backups.backUpNow(file, new Date(2026, 10, 8, 9, 30, 0));
  const second = backups.backUpNow(file, new Date(2026, 10, 8, 9, 31, 5));
  assert.strictEqual(path.basename(first), 'fleet-2026-11-08.db');
  assert.strictEqual(path.basename(second), 'fleet-2026-11-08-093105.db', 'a second the same day gets the time');
  assert.strictEqual(new DatabaseSync(second).prepare('SELECT x FROM t').get().x, 1, 'a whole copy');
  for (let d = 1; d <= 8; d++) {
    const old = path.join(backups.folderOf(file), `fleet-2026-10-0${d}.db`);
    fs.copyFileSync(first, old);
    fs.utimesSync(old, new Date(2026, 9, d), new Date(2026, 9, d));
  }
  backups.backUpNow(file, new Date(2026, 10, 9, 10, 0, 0));
  const kept = backups.listBackups(file).map((b) => b.name);
  assert.strictEqual(kept.length, 7, `the newest 7 kept: ${kept.join(', ')}`);
  assert.ok(kept.includes('fleet-2026-11-09.db') && !kept.includes('fleet-2026-10-01.db'));
  fs.rmSync(dir, { recursive: true, force: true });
});
