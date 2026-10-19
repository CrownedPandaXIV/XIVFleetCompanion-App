// Checks the extra-columns query (column-catalog.js) against a real Postgres, using a tiny made-up dataset whose
// answers are worked out by hand. Uses its own schema (cc_test), created and dropped here.
// Set PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE for a scratch database.
const { Client } = require('pg');
const assert = require('node:assert');
const catalog = require('../../shared/column-catalog');
const { buildSnapshotFragments, chooseSnapshotSource } = require('../../db/snapshot-fragments');

let n = 0;
async function scenario(name, fn) {
  try { await fn(); console.log(`PASS ${++n}. ${name}`); } catch (e) { console.log(`FAIL ${++n}. ${name}\n   ${e.message}`); process.exitCode = 1; }
}

const BIG = '18014498578000001'; // larger than JavaScript can hold exactly as a number

(async () => {
  const c = new Client();
  await c.connect();
  await c.query('DROP SCHEMA IF EXISTS cc_test CASCADE');
  await c.query('CREATE SCHEMA cc_test');
  await c.query('SET search_path TO cc_test');
  await c.query(`
    CREATE TABLE companion_character_snapshot(cid numeric, name text, world text, retainer_count int, submarine_count int, gil bigint,
      ceruleum int, repair_kits int, account_label text, fc_id numeric, num_sub_slots int, snapshot_at timestamptz);
    CREATE TABLE companion_character_housing(cid numeric, fc_id numeric, fc_name text, fc_master text, fc_points int, fc_rank int,
      total_members int, has_house bool, house_city int, house_ward int, house_plot int, fc_founding_date timestamptz, updated_at timestamptz);
    CREATE TABLE housing_key_city_lookup(city_id int, city_name text);
    CREATE TABLE companion_retainer_lookup(retainer_id numeric, owner_cid numeric, gil bigint);
    CREATE TABLE companion_submarine_snapshot(cid numeric, sub_name text, level int);
    CREATE TABLE companion_fc_inventory_snapshot(fc_id numeric, sorted_container int, item_id int, quantity int);

    -- an older row for each character (must be ignored) and the latest row
    INSERT INTO companion_character_snapshot VALUES
      (111,'Aki','Maduin',2,3,1000,50,10,'acct0',900,4, now() - interval '2 days'),
      (111,'Aki','Maduin',2,3,5000,100,20,'acct0',900,4, now() - interval '1 hour'),
      (112,'Bex','Maduin',1,0,7000,200,30,'acct0',900,4, now() - interval '1 hour'),
      (113,'Cal','Behemoth',0,0,900,5,1,'acct1',901,4, now() - interval '1 hour'),
      (114,'Dara','Behemoth',0,0,100,0,0,'acct1',NULL,4, now() - interval '1 hour'),
      (${BIG},'Big','Maduin',0,0,42,1,1,'acct1',NULL,4, now() - interval '1 hour');
    INSERT INTO housing_key_city_lookup VALUES (1,'Mist');
    INSERT INTO companion_character_housing VALUES
      (111,900,'Cute Kittehs','Aki',700000,7,30,true,1,5,12,'2026-01-01', now()),
      (112,900,'Cute Kittehs','Aki',700000,7,30,false,NULL,NULL,NULL,'2026-01-01', now()),
      (113,901,'Best Cats','Cal',100,3,2,false,NULL,NULL,NULL,'2026-03-01', now());
    INSERT INTO companion_retainer_lookup VALUES (1,111,100),(2,111,200),(3,112,50);
    INSERT INTO companion_submarine_snapshot VALUES (111,'S1',1),(111,'S2',50),(111,'S3',0);
    INSERT INTO companion_fc_inventory_snapshot VALUES
      (900,20000,10155,30),(900,20001,10155,12),(900,20005,10155,99),(900,20000,999,7),(901,20000,999,1);
  `);

  // The current-state table (plugin 0.3.0, database version 4), holding each character's latest row.
  await c.query(`
    CREATE TABLE companion_character_current (cid numeric PRIMARY KEY, name text, world text, account_label text, gil bigint,
      ceruleum int, repair_kits int, retainer_count int, submarine_count int, num_sub_slots int, fc_id numeric,
      first_seen_at timestamptz NOT NULL DEFAULT now(), last_synced_at timestamptz NOT NULL DEFAULT now());
    INSERT INTO companion_character_current (cid, name, world, account_label, gil, ceruleum, repair_kits, retainer_count,
      submarine_count, num_sub_slots, fc_id, last_synced_at)
    SELECT DISTINCT ON (cid) cid, name, world, account_label, gil, ceruleum, repair_kits, retainer_count, submarine_count,
      num_sub_slots, fc_id, snapshot_at FROM companion_character_snapshot ORDER BY cid, snapshot_at DESC;
  `);

  const forms = [
    ['skip-scan form', buildSnapshotFragments({ hasCidIndex: true, hasFcIndex: true })],
    ['DISTINCT ON form', buildSnapshotFragments({ hasCidIndex: false, hasFcIndex: false })],
    ['current-table form', buildSnapshotFragments({ useCurrent: true })],
  ];

  async function run(request, form) {
    const checked = catalog.validateExtrasRequest(request);
    assert.ok(checked.ok, checked.error);
    const { sql, params } = catalog.buildExtrasQuery(checked, form.latestCharacter);
    return { sql, values: catalog.shapeExtrasResult((await c.query(sql, params)).rows, checked).values };
  }

  const allCharacterKeys = catalog.catalogForInterface().character.map((x) => x.key);
  const allFcKeys = catalog.catalogForInterface().fc.map((x) => x.key);

  for (const [label, form] of forms) {
    await scenario(`character columns, ${label}: values come from the latest snapshot and related tables`, async () => {
      const { values } = await run({ subject: 'character', ids: ['111', '112', '114'], columns: allCharacterKeys }, form);
      const a = values['111'];
      assert.strictEqual(a.x_world, 'Maduin');
      assert.strictEqual(a.x_account, 'acct0');
      assert.strictEqual(a.x_gil, 5000); // latest row, not the older 1000
      assert.strictEqual(a.x_ceruleum, 100);
      assert.strictEqual(a.x_repair_kits, 20);
      assert.strictEqual(a.x_retainers, 2);
      assert.strictEqual(a.x_retainer_gil, 300);
      assert.strictEqual(a.x_submarines, 3);
      assert.strictEqual(a.x_subs_built, 2);
      assert.strictEqual(a.x_house, 'Mist W5 P12');
      assert.strictEqual(a.x_fc_name, 'Cute Kittehs');
      assert.strictEqual(a.x_fc_leader, 'Aki');
      assert.strictEqual(a.x_fc_points, 700000);
      assert.strictEqual(a.x_fc_rank, 7);
      assert.strictEqual(a.x_fc_members, 30);
      assert.strictEqual(a.x_fc_chest_ceruleum, 42); // 30 + 12, not the 99 outside the chest tabs
      assert.ok(typeof a.x_last_synced === 'string' && !Number.isNaN(Date.parse(a.x_last_synced)));
      const b = values['112'];
      assert.strictEqual(b.x_house, null); // no house
      assert.strictEqual(b.x_retainer_gil, 50);
      assert.strictEqual(b.x_subs_built, 0);
      const d = values['114'];
      assert.strictEqual(d.x_fc_name, null); // no housing row, no FC
      assert.strictEqual(d.x_retainer_gil, null);
      assert.strictEqual(d.x_fc_chest_ceruleum, null);
    });

    await scenario(`Free Company columns, ${label}: totals over the members currently in the FC, and the FC chest`, async () => {
      const { values } = await run({ subject: 'fc', ids: ['900', '901', '999'], columns: allFcKeys }, form);
      const f = values['900'];
      assert.strictEqual(f.x_members_tracked, 2);
      assert.strictEqual(f.x_members_gil, 12000); // 5000 + 7000
      assert.strictEqual(f.x_members_ceruleum, 300);
      assert.strictEqual(f.x_members_repair_kits, 50);
      assert.strictEqual(f.x_members_retainers, 3);
      assert.strictEqual(f.x_members_retainer_gil, 350);
      assert.strictEqual(f.x_members_submarines, 3);
      assert.strictEqual(f.x_chest_ceruleum, 42);
      assert.strictEqual(f.x_fc_rank, 7);
      assert.strictEqual(f.x_account, 'acct0');
      assert.ok(String(f.x_fc_founded).startsWith('2026-01-01'));
      const g = values['901'];
      assert.strictEqual(g.x_members_tracked, 1);
      assert.strictEqual(g.x_members_gil, 900);
      assert.strictEqual(g.x_chest_ceruleum, null); // no ceruleum in that chest
      const none = values['999'];
      assert.strictEqual(none.x_members_tracked, 0);
      assert.strictEqual(none.x_members_gil, null);
    });
  }

  await scenario('very large character ids survive the round trip as text', async () => {
    const { values } = await run({ subject: 'character', ids: [BIG], columns: ['x_gil', 'x_world'] }, forms[0][1]);
    assert.strictEqual(values[BIG].x_gil, 42);
    assert.strictEqual(values[BIG].x_world, 'Maduin');
  });

  await scenario('only the tables a requested column needs are read', async () => {
    const { sql } = await run({ subject: 'character', ids: ['111'], columns: ['x_gil'] }, forms[0][1]);
    assert.ok(!/companion_retainer_lookup|companion_character_housing|companion_fc_inventory_snapshot|companion_submarine_snapshot/.test(sql), sql);
    const fc = await run({ subject: 'fc', ids: ['900'], columns: ['x_chest_ceruleum'] }, forms[0][1]);
    assert.ok(!/WITH cur/.test(fc.sql), 'the members query is skipped when no member totals are asked for');
  });

  await scenario('a bad request is refused', async () => {
    const bad = (r) => assert.strictEqual(catalog.validateExtrasRequest(r).ok, false, JSON.stringify(r).slice(0, 80));
    bad(null);
    bad({ subject: 'nope', ids: ['1'], columns: ['x_gil'] });
    bad({ subject: 'character', ids: ['1'], columns: ['x_gil; DROP TABLE x'] });
    bad({ subject: 'character', ids: ['1'], columns: [] });
    bad({ subject: 'character', ids: ['1 OR 1=1'], columns: ['x_gil'] });
    bad({ subject: 'character', ids: Array.from({ length: catalog.MAX_IDS + 1 }, (_, i) => String(i)), columns: ['x_gil'] });
    bad({ subject: 'fc', ids: ['1'], columns: ['x_gil'] }); // a character column asked of a Free Company
  });

  await scenario('the interface catalog lists labels and groups but no SQL', async () => {
    const list = catalog.catalogForInterface();
    for (const subject of Object.keys(list)) {
      assert.ok(list[subject].length > 5);
      for (const entry of list[subject]) {
        assert.deepStrictEqual(Object.keys(entry).sort(), ['group', 'key', 'label', 'type']);
        assert.match(entry.key, /^x_[a-z_]+$/);
      }
      assert.strictEqual(new Set(list[subject].map((e) => e.key)).size, list[subject].length, 'keys are unique');
    }
  });

  await scenario('the current-state table is read while the plugin keeps it up to date', async () => {
    assert.strictEqual((await chooseSnapshotSource(c)).useCurrent, true);
  });

  await scenario('a current-state table the plugin no longer updates is ignored (older plugin)', async () => {
    await c.query(`UPDATE companion_character_current SET last_synced_at = now() - interval '1 hour'`);
    await c.query(`INSERT INTO companion_character_snapshot (cid, name, world, snapshot_at) VALUES (111, 'Aki', 'Maduin', now())`);
    assert.strictEqual((await chooseSnapshotSource(c)).useCurrent, false);
    await c.query(`UPDATE companion_character_current SET last_synced_at = now() - interval '5 minutes'`);
    assert.strictEqual((await chooseSnapshotSource(c)).useCurrent, true, 'within the 10-minute grace');
  });

  await scenario('without the current-state table the history is read; without the history the current table is', async () => {
    await c.query('ALTER TABLE companion_character_current RENAME TO zz_current');
    assert.strictEqual((await chooseSnapshotSource(c)).useCurrent, false);
    await c.query('ALTER TABLE zz_current RENAME TO companion_character_current');
    await c.query(`UPDATE companion_character_current SET last_synced_at = now() - interval '3 days'`);
    await c.query('ALTER TABLE companion_character_snapshot RENAME TO zz_snapshot');
    assert.strictEqual((await chooseSnapshotSource(c)).useCurrent, true);
    await c.query('ALTER TABLE zz_snapshot RENAME TO companion_character_snapshot');
  });

  await c.query('DROP SCHEMA cc_test CASCADE');
  await c.end();
  console.log(process.exitCode ? '\nSOME CHECKS FAILED' : '\nALL CHECKS PASSED');
})().catch((e) => { console.log('ERROR', e); process.exit(2); });
