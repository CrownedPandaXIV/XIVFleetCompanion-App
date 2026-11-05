// Checks the views plugin 2.0 reads (db/views.sql) against the app's own code
// on a real Postgres: fleet_supplies_view against what the Supplies tab works out (ipc/supplies.js: metricWindow,
// usageRate, runway, restockAmount), fleet_subs_view against the Subs tab's part letters and status, and
// fleet_summary_view against counts made here. Hand-made cases first, then a few hundred random histories. Set
// PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE for a scratch server, as its administrator: it makes and drops a
// database named fleet_views_check.
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const assert = require('node:assert');
const { metricWindow } = require('../../db/metric-window');
const { DAY, usageRate, runway, restockAmount } = require('../../subs/supply-runway');
const { SUB_PART_CLASS, partLetter } = require('../../subs/submarine-builds');

let n = 0;
async function scenario(name, fn) {
  try { await fn(); console.log(`PASS ${++n}. ${name}`); } catch (e) { console.log(`FAIL ${++n}. ${name}\n   ${e.stack}`); process.exitCode = 1; }
}

const NAME = 'fleet_views_check';
const HOUR = 3600 * 1000;
const close = (a, b) => (a === null || b === null ? a === b : Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b)));

// What the Supplies tab shows for each character with subs (as ipc/supplies.js loadSupplies), by cid.
async function appSupplies(client, windowDays, targetDays) {
  const characters = (await client.query(`
    SELECT c.cid::text AS cid, c.last_synced_at, c.ceruleum, c.repair_kits FROM companion_character_current c
    WHERE EXISTS (SELECT 1 FROM companion_submarine_snapshot s WHERE s.cid = c.cid AND s.level > 0)`)).rows;
  const now = Date.now();
  const windowStart = new Date(now - windowDays * DAY);
  const metrics = { ceruleum: 'item_qty:10155', repair_kits: 'item_qty:10373' };
  const points = await metricWindow(client, 'character', [...Object.keys(metrics), ...Object.values(metrics)], windowStart, characters.map((c) => c.cid));
  const out = new Map();
  for (const c of characters) {
    const asOf = new Date(c.last_synced_at).getTime();
    const entry = {};
    for (const [metric, total] of Object.entries(metrics)) {
      const have = Number(c[metric]) || 0;
      const series = [...(points.get(`${c.cid}|${metric}`) || []), { at: asOf, value: have }];
      const totalRate = usageRate(points.get(`${c.cid}|${total}`) || [], windowStart.getTime(), asOf);
      const rate = totalRate.perDay !== null ? totalRate : usageRate(series, windowStart.getTime(), asOf);
      const left = runway(have, rate.perDay, asOf);
      entry[metric] = { have, perDay: rate.perDay, days: left.days === Infinity ? null : left.days, restock: restockAmount(have, rate.perDay, targetDays) };
    }
    out.set(c.cid, entry);
  }
  return out;
}

async function compareSupplies(client, windowDays, targetDays) {
  const expected = await appSupplies(client, windowDays, targetDays);
  const rows = (await client.query('SELECT * FROM fleet_supplies_view')).rows;
  assert.strictEqual(rows.length, expected.size, 'one row per character with subs');
  for (const r of rows) {
    const e = expected.get(String(r.cid));
    assert.ok(e, `character ${r.cid} has subs`);
    assert.strictEqual(r.window_days, windowDays);
    assert.strictEqual(r.target_days, targetDays);
    for (const metric of ['ceruleum', 'repair_kits']) {
      const got = { have: Number(r[metric]), perDay: r[`${metric}_per_day`], days: r[`${metric}_days_left`], restock: r[`${metric}_restock`] };
      const want = e[metric];
      const same = got.have === want.have && close(got.perDay, want.perDay) && close(got.days, want.days) && got.restock === want.restock;
      assert.ok(same, `${r.name} ${metric}: view ${JSON.stringify(got)}, app ${JSON.stringify(want)}`);
    }
  }
  return rows.length;
}

// Inserts history rows [{ cid, metric, at (ms), value }].
async function history(client, rows) {
  if (!rows.length) return;
  await client.query(`INSERT INTO companion_metric_history (subject_type, subject_id, metric, recorded_at, value)
    SELECT 'character', cid, metric, to_timestamp(at / 1000.0), value FROM unnest($1::numeric[], $2::text[], $3::float8[], $4::numeric[]) AS t(cid, metric, at, value)`,
  [rows.map((r) => r.cid), rows.map((r) => r.metric), rows.map((r) => r.at), rows.map((r) => r.value)]);
}

async function character(client, cid, { name = `C${cid}`, ceruleum = 0, repairKits = 0, syncedHoursAgo = 0, subs = true, label = 'acct1' } = {}) {
  await client.query(`INSERT INTO companion_character_current (cid, name, world, account_label, ceruleum, repair_kits, last_synced_at)
    VALUES ($1, $2, 'Maduin', $3, $4, $5, now() - make_interval(secs => $6))`, [cid, name, label, ceruleum, repairKits, syncedHoursAgo * 3600]);
  if (subs) await client.query(`INSERT INTO companion_submarine_snapshot (cid, sub_name, level, part1, part2, part3, part4, return_time, slot)
    VALUES ($1, 'Sub1', 80, 21792, 22527, 23904, 24347, 0, 1)`, [cid]);
}

const setting = (client, key, value) => client.query(`INSERT INTO fleet_economics_settings (setting_key, setting_value) VALUES ($1, $2)
  ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value`, [key, value]);

(async () => {
  const admin = new Client();
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${NAME}`);
  await admin.query(`CREATE DATABASE ${NAME}`);
  const client = new Client({ host: process.env.PGHOST, port: process.env.PGPORT, user: process.env.PGUSER, password: process.env.PGPASSWORD, database: NAME });
  await client.connect();
  const clear = () => client.query('TRUNCATE companion_character_current, companion_submarine_snapshot, companion_metric_history, companion_retainer_lookup, fleet_economics_settings');
  try {
    await client.query(fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'schema.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'views.sql'), 'utf8'));
    const now = Date.now();
    const ago = (h) => now - h * HOUR;

    await scenario('part letters match the Subs tab for every part, and anything else shows as its number', async () => {
      const ids = [...Object.keys(SUB_PART_CLASS).map(Number), 1, 21791, 24368, 0];
      const { rows } = await client.query('SELECT id, fleet_part_letter(id) AS letter FROM unnest($1::int[]) AS id', [ids]);
      for (const r of rows) assert.strictEqual(r.letter, partLetter(r.id), `part ${r.id}`);
    });

    await scenario('supplies: hand-made cases give what the Supplies tab gives', async () => {
      await clear();
      // 1. Bags only, over 5 days: 100 a day used, one restock ignored; the base point is before the window.
      await character(client, 1, { ceruleum: 300, repairKits: 40, syncedHoursAgo: 1 });
      await history(client, [
        { cid: 1, metric: 'ceruleum', at: ago(20 * 24), value: 900 },
        { cid: 1, metric: 'ceruleum', at: ago(5 * 24), value: 800 },
        { cid: 1, metric: 'ceruleum', at: ago(4 * 24), value: 700 },
        { cid: 1, metric: 'ceruleum', at: ago(3 * 24), value: 1600 },
        { cid: 1, metric: 'ceruleum', at: ago(2 * 24), value: 1500 },
        { cid: 1, metric: 'repair_kits', at: ago(3 * 24), value: 50 },
      ]);
      // 2. Bags and retainers together cover more than a day: that wins over the bags.
      await character(client, 2, { ceruleum: 10, repairKits: 10 });
      await history(client, [
        { cid: 2, metric: 'item_qty:10155', at: ago(48), value: 500 },
        { cid: 2, metric: 'item_qty:10155', at: ago(10), value: 380 },
        { cid: 2, metric: 'ceruleum', at: ago(48), value: 500 },
        { cid: 2, metric: 'ceruleum', at: ago(10), value: 10 },
      ]);
      // 3. Bags and retainers cover under a day: the bags are used instead.
      await character(client, 3, { ceruleum: 50, repairKits: 5 });
      await history(client, [
        { cid: 3, metric: 'item_qty:10155', at: ago(12), value: 90 },
        { cid: 3, metric: 'ceruleum', at: ago(72), value: 200 },
      ]);
      // 4. No history: not enough to tell. 5. Nothing used for days: never runs out.
      await character(client, 4, { ceruleum: 7, repairKits: 7 });
      await character(client, 5, { ceruleum: 70, repairKits: 9 });
      await history(client, [{ cid: 5, metric: 'ceruleum', at: ago(100), value: 70 }, { cid: 5, metric: 'repair_kits', at: ago(100), value: 9 }]);
      // 6. No subs: not listed. 7. Hourly reminders (unchanged values) change nothing.
      await character(client, 6, { ceruleum: 1, subs: false });
      await character(client, 7, { ceruleum: 100, repairKits: 20 });
      await history(client, Array.from({ length: 72 }, (_, h) => ({ cid: 7, metric: 'ceruleum', at: ago(72 - h), value: h < 36 ? 400 : 100 })));
      const count = await compareSupplies(client, 14, 14);
      assert.strictEqual(count, 6);
      const r = (await client.query('SELECT * FROM fleet_supplies_view WHERE cid IN (2, 4, 5) ORDER BY cid')).rows;
      assert.ok(r[0].ceruleum_per_day > 0 && r[0].ceruleum_per_day < 100, `2: from bags and retainers (120 over the span), not the bags: ${r[0].ceruleum_per_day}`);
      assert.deepStrictEqual([r[1].ceruleum_per_day, r[1].ceruleum_days_left], [null, null], '4: not enough history');
      assert.deepStrictEqual([r[2].ceruleum_per_day, r[2].ceruleum_days_left, r[2].ceruleum_restock], [0, null, 0], '5: none used, never runs out');
    });

    await scenario('supplies: the window and restock days from Settings are used', async () => {
      await setting(client, 'supply_window_days', 3);
      await setting(client, 'restock_target_days', 30);
      await compareSupplies(client, 3, 30);
      await setting(client, 'supply_window_days', 5); // not a choice: the default
      await compareSupplies(client, 14, 30);
    });

    await scenario('supplies: 300 random histories (drops, restocks, hourly reminders, late syncs) match the Supplies tab', async () => {
      await clear();
      let seed = 42;
      const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
      const rows = [];
      for (let cid = 100; cid < 400; cid++) {
        const synced = random() < 0.2 ? random() * 300 : random() * 2; // some stopped syncing days ago
        let cer = Math.floor(random() * 5000);
        let kits = Math.floor(random() * 500);
        const span = Math.floor(random() * 20 * 24); // hours of history
        const withTotals = random() < 0.5;
        for (let h = span; h >= Math.ceil(synced); h--) {
          if (random() < 0.3) cer = Math.max(0, cer - Math.floor(random() * 60));
          if (random() < 0.02) cer += 2000;
          if (random() < 0.2) kits = Math.max(0, kits - Math.floor(random() * 4));
          if (random() < 0.4) rows.push({ cid, metric: 'ceruleum', at: ago(h), value: cer });
          if (random() < 0.4) rows.push({ cid, metric: 'repair_kits', at: ago(h), value: kits });
          if (withTotals && random() < 0.3) rows.push({ cid, metric: 'item_qty:10155', at: ago(h), value: cer + 100 });
        }
        await character(client, cid, { ceruleum: cer, repairKits: kits, syncedHoursAgo: synced, subs: random() < 0.9 });
      }
      await history(client, rows);
      for (const [w, t] of [[14, 14], [7, 10], [30, 1]]) {
        await setting(client, 'supply_window_days', w);
        await setting(client, 'restock_target_days', t);
        await compareSupplies(client, w, t);
      }
    });

    await scenario('subs: one row per built sub, with its build and where it is', async () => {
      await clear();
      const secs = Math.floor(now / 1000);
      await character(client, 1, { name: 'Aki', subs: false });
      await client.query(`INSERT INTO companion_submarine_snapshot (cid, sub_name, level, part1, part2, part3, part4, return_time, slot) VALUES
        (1, 'Submersible-2', 90, 24348, 24353, 23904, 21796, 0, NULL),
        (1, 'Back', 50, 21792, 21792, 21792, 21792, $1, 1),
        (1, 'Out', 60, 22526, 22526, 22526, 22526, $2, 3),
        (1, 'Unbuilt', 0, 0, 0, 0, 0, 0, 4)`, [secs - 60, secs + 3600]);
      const { rows } = await client.query('SELECT sub_name, character_name, slot, rank, build, status, return_time FROM fleet_subs_view ORDER BY slot');
      assert.deepStrictEqual(rows.map((r) => [r.sub_name, r.character_name, r.slot, r.rank, r.build, r.status]), [
        ['Back', 'Aki', 1, 50, 'S-S-S-S', 'returned'],
        ['Submersible-2', 'Aki', 2, 90, 'S+-U+-C-U', 'in_port'],
        ['Out', 'Aki', 3, 60, 'W-W-W-W', 'out'],
      ]);
      const app = (r) => [r.part1, r.part2, r.part3, r.part4].map(partLetter).join('-');
      assert.strictEqual(rows[1].build, app({ part1: 24348, part2: 24353, part3: 23904, part4: 21796 }), 'as the Subs tab joins them');
    });

    await scenario('summary: subs, retainers, low supplies and the soonest to run out', async () => {
      await setting(client, 'low_ceruleum_threshold', 100);
      await setting(client, 'low_repair_kit_threshold', 0); // off
      await character(client, 2, { ceruleum: 50, repairKits: 1 });
      await history(client, [{ cid: 2, metric: 'ceruleum', at: ago(48), value: 250 }]);
      const secs = Math.floor(now / 1000);
      await client.query(`INSERT INTO companion_retainer_lookup (retainer_id, owner_cid, name, job, has_venture, venture_ends_at) VALUES
        (1, 1, 'Done', 1, true, $1), (2, 1, 'Busy', 1, true, $2), (3, 1, 'Idle', 1, false, NULL), (4, 1, 'NoClass', 0, false, NULL)`, [secs - 10, secs + 999]);
      const { rows: [s] } = await client.query('SELECT * FROM fleet_summary_view');
      const supplies = (await client.query('SELECT * FROM fleet_supplies_view')).rows;
      assert.deepStrictEqual(
        [s.subs, s.subs_returned, s.subs_in_port, s.subs_out, s.retainers, s.ventures_done, s.retainers_idle, s.low_ceruleum, s.low_repair_kits],
        [4, 1, 2, 1, 3, 1, 1, 2, 0], 'Aki (0, with subs from the case before) and the new character (50) are under 100; repair kits are off');
      assert.strictEqual(Number(s.next_return_time), secs + 3600);
      const soonest = Math.min(...supplies.flatMap((r) => [r.ceruleum_days_left, r.repair_kits_days_left]).filter((d) => d !== null));
      assert.ok(close(s.soonest_runs_out_days, soonest), `soonest ${s.soonest_runs_out_days} vs ${soonest}`);
    });
  } finally {
    await client.end();
    await admin.query(`DROP DATABASE IF EXISTS ${NAME}`);
    await admin.end();
  }
})();
