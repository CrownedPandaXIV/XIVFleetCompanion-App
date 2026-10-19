// Checks the game data update against a real Postgres, using small made-up tables and files.
// Set PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE for a scratch database (it creates and drops
// tables named gdt_*, companion_game_data_log, and gdbackup_* schemas).
const { Client } = require('pg');
const assert = require('node:assert');
const g = require('../../db/game-data');

const FILES = {};
const TABLES = [{ file: 'One', table: 'gdt_one' }];
const opts = () => ({ tables: TABLES, fetchText: async (url) => FILES[url.split('/').pop().replace('.csv', '')], baseUrl: 'x/', fetchSourceVersion: false });

let n = 0;
async function scenario(name, fn) {
  try { await fn(); console.log(`PASS ${++n}. ${name}`); } catch (e) { console.log(`FAIL ${++n}. ${name}\n   ${e.message}`); process.exitCode = 1; }
}

(async () => {
  const c = new Client();
  await c.connect();
  const rows = async () => (await c.query('SELECT * FROM gdt_one ORDER BY id::int')).rows;
  const reset = async (createSql, insertSql) => {
    await c.query('DROP TABLE IF EXISTS gdt_one');
    await c.query(createSql);
    if (insertSql) await c.query(insertSql);
  };
  const CSV = '#,Name,Ingredient[0],Flag\n1,Alpha,10,True\n2,Beta,,False\n3,"Gamma, the third",30,True\n';
  const SAME = `CREATE TABLE gdt_one (id text, name text, ingredient0 text, flag text)`;
  const SAME_ROWS = `INSERT INTO gdt_one VALUES ('1','Alpha','10','True'),('2','Beta',NULL,'False'),('3','Gamma, the third','30','True')`;

  await scenario('an identical table is reported unchanged (bracket names and empty cells match)', async () => {
    FILES.One = CSV;
    await reset(SAME, SAME_ROWS);
    const r = await g.checkAll(c, opts());
    assert.strictEqual(r.tables[0].status, 'unchanged');
  });

  await scenario('changed values and rows are detected, applied, and the row count follows the file', async () => {
    await reset(SAME, SAME_ROWS);
    FILES.One = '#,Name,Ingredient[0],Flag\n1,Alpha,11,True\n2,Beta,,False\n3,"Gamma, the third",30,True\n4,Delta,40,False\n';
    const r = await g.checkAll(c, opts());
    assert.strictEqual(r.tables[0].status, 'ok');
    const out = await g.applyAll(c, r);
    assert.strictEqual(out[0].status, 'updated');
    const now = await rows();
    assert.strictEqual(now.length, 4);
    assert.strictEqual(now[0].ingredient0, '11');
    assert.strictEqual(now[1].ingredient0, null);
    assert.strictEqual(now[3].name, 'Delta');
    assert.strictEqual((await g.checkAll(c, opts())).tables[0].status, 'unchanged');
  });

  await scenario('a new column in the file is added to the table and filled', async () => {
    await reset(SAME, SAME_ROWS);
    FILES.One = '#,Name,Ingredient[0],Flag,Brand New\n1,Alpha,10,True,x\n2,Beta,,False,y\n3,"Gamma, the third",30,True,z\n';
    const r = await g.checkAll(c, opts());
    assert.deepStrictEqual(r.tables[0].added.map((a) => a.column), ['brand_new']);
    await g.applyAll(c, r);
    assert.deepStrictEqual((await rows()).map((x) => x.brand_new), ['x', 'y', 'z']);
  });

  await scenario('a column that left the file is kept, with blank values', async () => {
    await reset(SAME, SAME_ROWS);
    FILES.One = '#,Name,Ingredient[0]\n1,Alpha,10\n2,Beta,20\n3,Gamma,30\n';
    const r = await g.checkAll(c, opts());
    assert.deepStrictEqual(r.tables[0].kept, ['flag']);
    await g.applyAll(c, r);
    assert.deepStrictEqual((await rows()).map((x) => x.flag), [null, null, null]);
  });

  await scenario('a probable rename is blocked and the table is untouched', async () => {
    await reset(SAME, SAME_ROWS);
    FILES.One = '#,Name,Ingredient[0],FlagRenamed\n1,Alpha,10,True\n2,Beta,,False\n3,Gamma,30,True\n';
    const r = await g.checkAll(c, opts());
    assert.strictEqual(r.tables[0].status, 'blocked');
    const out = await g.applyAll(c, r);
    assert.strictEqual(out[0].status, 'blocked');
    assert.strictEqual((await rows()).length, 3);
    assert.strictEqual((await rows())[2].name, 'Gamma, the third');
  });

  await scenario('a bad download (far fewer rows) is blocked', async () => {
    await reset(SAME, SAME_ROWS);
    FILES.One = '#,Name,Ingredient[0],Flag\n1,Alpha,10,True\n';
    assert.strictEqual((await g.checkAll(c, opts())).tables[0].status, 'blocked');
  });

  await scenario('a missing table is made and loaded (the app started using it after setup)', async () => {
    await c.query('DROP TABLE IF EXISTS gdt_one');
    FILES.One = CSV;
    const r = await g.checkAll(c, opts());
    assert.strictEqual(r.tables[0].status, 'ok');
    assert.strictEqual((await c.query("SELECT to_regclass('gdt_one') AS t")).rows[0].t, null, 'checking changes nothing');
    const out = await g.applyAll(c, r);
    assert.strictEqual(out[0].status, 'updated');
    const cols = (await c.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'gdt_one' ORDER BY ordinal_position`)).rows.map((x) => x.column_name);
    assert.deepStrictEqual(cols, ['id', 'name', 'ingredient0', 'flag']);
    assert.deepStrictEqual((await rows()).map((x) => x.name), ['Alpha', 'Beta', 'Gamma, the third']);
  });

  await scenario('a missing table that fails to load is not left behind', async () => {
    await c.query('DROP TABLE IF EXISTS gdt_one');
    FILES.One = CSV;
    const r = await g.checkAll(c, opts());
    r.tables[0].added.push({ header: 'Broken', index: 0, column: 'id' }); // a duplicate column: the load fails
    const out = await g.applyAll(c, r);
    assert.strictEqual(out[0].status, 'failed');
    assert.strictEqual((await c.query("SELECT to_regclass('gdt_one') AS t")).rows[0].t, null);
  });

  await scenario('a failure part-way rolls the table back to how it was', async () => {
    await reset('CREATE TABLE gdt_one (id text, name text, ingredient0 int, flag text)',
      `INSERT INTO gdt_one VALUES ('1','Alpha',10,'True'),('2','Beta',NULL,'False'),('3','Gamma, the third',30,'True')`);
    FILES.One = '#,Name,Ingredient[0],Flag\n1,Alpha,10,True\n2,Beta,not-a-number,False\n3,Gamma,30,True\n';
    const r = await g.checkAll(c, opts());
    const out = await g.applyAll(c, r);
    assert.strictEqual(out[0].status, 'failed');
    const now = await rows();
    assert.strictEqual(now.length, 3);
    assert.strictEqual(now[2].name, 'Gamma, the third');
  });

  await scenario('a table that stores empty cells as empty text keeps doing so', async () => {
    await reset(SAME, `INSERT INTO gdt_one VALUES ('1','Alpha','10','True'),('2','Beta','','False'),('3','Old','30','True')`);
    FILES.One = CSV;
    const r = await g.checkAll(c, opts());
    assert.strictEqual(r.tables[0].emptyStyle, 'blank');
    await g.applyAll(c, r);
    assert.strictEqual((await rows())[1].ingredient0, '');
  });

  await scenario('the update is logged and can be read back', async () => {
    await c.query('DROP TABLE IF EXISTS companion_game_data_log');
    await g.recordUpdate(c, { sha: 'abc' }, [{ table: 'gdt_one', status: 'updated' }]);
    const last = await g.lastUpdate(c);
    assert.strictEqual(last.source.sha, 'abc');
    assert.strictEqual(last.summary[0].table, 'gdt_one');
    await c.query('DROP TABLE companion_game_data_log');
  });



  await scenario('a placeholder column the file has now named is renamed in place, and the update applies', async () => {
    await reset('CREATE TABLE gdt_one (id text, unknown0 text, name text, order_field text)',
      `INSERT INTO gdt_one VALUES ('1','a','Alpha','1'),('2','b','Beta','2')`);
    FILES.One = '#,BST,Name,Order\n1,a,Alpha,1\n2,b,Beta,2\n3,c,Gamma,3\n';
    const r = await g.checkAll(c, opts());
    assert.strictEqual(r.tables[0].status, 'ok');
    assert.deepStrictEqual(r.tables[0].renames.map((x) => [x.from, x.to]), [['unknown0', 'bst']]);
    const out = await g.applyAll(c, r);
    assert.strictEqual(out[0].status, 'updated');
    const cols = (await c.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'gdt_one' ORDER BY ordinal_position`)).rows.map((x) => x.column_name);
    assert.deepStrictEqual(cols, ['id', 'bst', 'name', 'order_field']);
    assert.strictEqual((await rows()).length, 3);
    assert.strictEqual((await g.checkAll(c, opts())).tables[0].status, 'unchanged');
  });

  const cleanBackups = async () => {
    for (const b of await g.listBackups(c)) await g.deleteBackup(c, b.name);
  };
  const bopts = { tables: TABLES };

  await scenario('a backup copies the tables, is listed, and can be restored (with an undo copy made first)', async () => {
    await cleanBackups();
    await reset(SAME, SAME_ROWS);
    const made = await g.createBackup(c, { ...bopts, label: 'test' });
    assert.deepStrictEqual(made.tables, [{ table: 'gdt_one', rows: 3 }]);
    await c.query(`UPDATE gdt_one SET name = 'changed'; DELETE FROM gdt_one WHERE id = '3'`);
    const listed = await g.listBackups(c);
    assert.strictEqual(listed.length, 1);
    assert.strictEqual(listed[0].label, 'test');
    assert.strictEqual(listed[0].tables[0].rows, 3);
    const restored = await g.restoreBackup(c, made.name, bopts);
    assert.strictEqual(restored.results[0].status, 'restored');
    const now = await rows();
    assert.strictEqual(now.length, 3);
    assert.strictEqual(now[0].name, 'Alpha');
    const after = await g.listBackups(c);
    assert.strictEqual(after.length, 2);
    assert.ok(after.some((b) => b.name === restored.safetyBackup && /before restoring/.test(b.label)));
  });

  await scenario('restoring undoes an update, including a column that update added', async () => {
    await cleanBackups();
    await reset(SAME, SAME_ROWS);
    FILES.One = '#,Name,Ingredient[0],Flag,Brand New\n1,Alpha,10,True,x\n2,Beta,,False,y\n3,Gamma,30,True,z\n4,Delta,40,False,w\n';
    const checked = await g.checkAll(c, opts());
    const before = await g.createBackup(c, { ...bopts, label: 'before update' });
    await g.applyAll(c, checked);
    assert.strictEqual((await rows()).length, 4);
    await g.restoreBackup(c, before.name, bopts);
    const now = await rows();
    assert.strictEqual(now.length, 3);
    assert.strictEqual(now[2].name, 'Gamma, the third');
    assert.strictEqual(now[0].brand_new, null); // the column added by the update stays, empty
  });

  await scenario('a dropped table is recreated by a restore', async () => {
    await cleanBackups();
    await reset(SAME, SAME_ROWS);
    const made = await g.createBackup(c, bopts);
    await c.query('DROP TABLE gdt_one');
    const r = await g.restoreBackup(c, made.name, bopts);
    assert.strictEqual(r.results[0].status, 'restored');
    assert.strictEqual((await rows()).length, 3);
  });

  await scenario('only the newest backups are kept, and delete works', async () => {
    await cleanBackups();
    await reset(SAME, SAME_ROWS);
    const names = [];
    for (let i = 0; i < 4; i++) {
      names.push((await g.createBackup(c, { ...bopts, keep: 2 })).name);
      await new Promise((r) => setTimeout(r, 5));
    }
    const listed = (await g.listBackups(c)).map((b) => b.name);
    assert.deepStrictEqual(listed, [names[3], names[2]]);
    await g.deleteBackup(c, names[3]);
    assert.deepStrictEqual((await g.listBackups(c)).map((b) => b.name), [names[2]]);
  });

  // Indexes and statistics. `idIndex` reads which index (if any) starts with gdt_one's id column.
  const idIndex = async (table = 'gdt_one') => (await c.query(
    `SELECT ix.indisunique AS unique FROM pg_index ix JOIN pg_attribute a ON a.attrelid = ix.indrelid AND a.attnum = ix.indkey[0]
     WHERE ix.indrelid = to_regclass($1) AND a.attname = 'id'`, [table])).rows;
  const plannerRows = async (table = 'gdt_one') => Number((await c.query('SELECT reltuples FROM pg_class WHERE oid = to_regclass($1)', [table])).rows[0].reltuples);

  await scenario('an update gives the table a unique index on id and fresh planner statistics', async () => {
    await reset(SAME, SAME_ROWS);
    FILES.One = CSV.replace('3,"Gamma, the third",30,True\n', '3,"Gamma, the third",30,True\n4,Delta,40,False\n5,Eps,50,True\n');
    await g.applyAll(c, await g.checkAll(c, opts()));
    assert.deepStrictEqual(await idIndex(), [{ unique: true }]);
    assert.strictEqual(await plannerRows(), 5);
    // A second update keeps the one index rather than adding another.
    FILES.One = CSV;
    await g.applyAll(c, await g.checkAll(c, opts()));
    assert.deepStrictEqual(await idIndex(), [{ unique: true }]);
    assert.strictEqual(await plannerRows(), 3);
  });

  await scenario('ids that repeat get a plain index instead of failing', async () => {
    await reset(SAME, `INSERT INTO gdt_one VALUES ('1','A','1','True'),('1','B','2','True')`);
    const made = await g.ensureIndexes(c, { tables: TABLES });
    assert.deepStrictEqual(made, ['gdt_one.id']);
    assert.deepStrictEqual(await idIndex(), [{ unique: false }]);
    assert.deepStrictEqual(await g.ensureIndexes(c, { tables: TABLES }), [], 'nothing is made twice');
  });

  await scenario('a restore that recreates a dropped table also recreates its index', async () => {
    await cleanBackups();
    await reset(SAME, SAME_ROWS);
    await g.ensureIndexes(c, { tables: TABLES });
    const made = await g.createBackup(c, bopts);
    await c.query('DROP TABLE gdt_one');
    await g.restoreBackup(c, made.name, bopts);
    assert.deepStrictEqual(await idIndex(), [{ unique: true }]);
    assert.strictEqual(await plannerRows(), 3);
  });

  await scenario('at app start, missing indexes are made and never-analysed tables get statistics', async () => {
    await c.query('DROP TABLE IF EXISTS gdt_two');
    await c.query(`CREATE TABLE gdt_two (id text, name text)`);
    await c.query(`INSERT INTO gdt_two SELECT g::text, 'n' || g FROM generate_series(1, 250) g`);
    const done = await g.prepareTables(c, { tables: [{ file: 'Two', table: 'gdt_two' }] });
    assert.deepStrictEqual(done.indexesMade, ['gdt_two.id']);
    assert.deepStrictEqual(await idIndex('gdt_two'), [{ unique: true }]);
    assert.strictEqual(await plannerRows('gdt_two'), 250);
    const again = await g.prepareTables(c, { tables: [{ file: 'Two', table: 'gdt_two' }] });
    assert.deepStrictEqual(again.indexesMade, []);
    await c.query('DROP TABLE gdt_two');
  });

  await scenario('a made-up or unsafe backup name is refused', async () => {
    await assert.rejects(g.restoreBackup(c, 'public', bopts), /valid backup name/);
    await assert.rejects(g.deleteBackup(c, 'gdbackup_1; DROP TABLE gdt_one'), /valid backup name/);
    await assert.rejects(g.restoreBackup(c, 'gdbackup_20200101_000000_000', bopts), /no longer exists/);
  });

  await scenario('a new database (no update recorded, empty tables) is filled in by itself; one with game data is left alone', async () => {
    await c.query('DROP TABLE IF EXISTS companion_game_data_log');
    await reset('CREATE TABLE gdt_one (id text)');
    FILES.One = CSV;
    const probe = { probeTable: 'gdt_one' };
    assert.strictEqual(await g.needsFilling(c, probe), true);
    const filled = await g.fillGameData(c, opts());
    assert.deepStrictEqual(filled, { updated: 1, failed: [] });
    assert.deepStrictEqual((await rows()).map((r) => r.name), ['Alpha', 'Beta', 'Gamma, the third']);
    assert.strictEqual(await g.needsFilling(c, probe), false, 'the update is recorded, so it is not filled again');
    await c.query('DROP TABLE companion_game_data_log');
    assert.strictEqual(await g.needsFilling(c, probe), false, 'a table with rows is never filled again');
    assert.strictEqual(await g.needsFilling(c, { probeTable: 'gdt_missing' }), false, 'nor a database without the table');
  });

  await scenario('a download that fails is reported, not thrown', async () => {
    await reset('CREATE TABLE gdt_one (id text)');
    const failing = { ...opts(), fetchText: async () => { throw new Error('no internet'); } };
    const filled = await g.fillGameData(c, failing);
    assert.strictEqual(filled.updated, 0);
    assert.deepStrictEqual(filled.failed, [{ table: 'gdt_one', reason: 'no internet' }]);
  });

  await cleanBackups();
  await c.query('DROP TABLE IF EXISTS gdt_one');
  await c.end();
  console.log(process.exitCode ? '\nSOME CHECKS FAILED' : '\nALL CHECKS PASSED');
})().catch((e) => { console.log('ERROR', e); process.exit(2); });
