// Checks the views plugin 2.0 reads (db/views.sql) against the app's own code
// on a real Postgres: fleet_supplies_view against what the Supplies tab works out (ipc/supplies.js: metricWindow,
// usageRate, runway, restockAmount), fleet_subs_view against the Subs tab's part letters and status, and
// fleet_summary_view against counts made here; 2.x's Roster, Retainers and PCs views (fleet_roster_view against
// characters/roster-warnings.js and the Roster's house text, the others against what their tabs read); and the Salvage, Income and venture views against the Salvage and Income tabs' own working out, run here (ipc/inventory.js, ipc/income.js). Hand-made cases first, then a few hundred random histories. Set
// PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE for a scratch server, as its administrator: it makes and drops a
// database named fleet_views_check.
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const assert = require('node:assert');
const { metricWindow } = require('../../db/metric-window');
const { DAY, usageRate, runway, restockAmount } = require('../../subs/supply-runway');
const { SUB_PART_CLASS, partLetter } = require('../../subs/submarine-builds');
const { notSyncedCharacters } = require('../../characters/not-synced');
const { daysSince, houseLevel } = require('../../characters/house-warning');
const { rosterWarnings } = require('../../characters/roster-warnings');
const { retainerSummary } = require('../../characters/retainer-summary');
const { fcDirectorySql, fcDirectoryRows } = require('../../characters/fc-directory-rows');
const { buildSnapshotFragments } = require('../../db/snapshot-fragments');
const { placeLabel, MONEY_CONTAINERS } = require('../../characters/item-locations');
const { chestHolders } = require('../../characters/fc-chest');
const { ventureTotals } = require('../../subs/loot');
const Module = require('module');

// The Salvage and Income tabs' own working out (ipc/inventory.js get-salvage, ipc/income.js loadIncome), run here on
// the check's database: Electron is stood in for (they register their calls with it when loaded) and their database
// connection is the check's own.
const handlers = new Map();
let appClient = null;
const original = Module._load;
Module._load = function load(request, ...rest) {
  if (request === 'electron') return { ipcMain: { handle(name, fn) { handlers.set(name, fn); } }, app: { getPath: () => '.', getVersion: () => '0' }, safeStorage: {}, BrowserWindow: { getAllWindows: () => [] } };
  return original.call(this, request, ...rest);
};
const appDb = require('../../db');
appDb.withClient = async (fn, onError) => { try { return await fn(appClient); } catch (e) { if (onError) return onError(e); throw e; } };
const { SALVAGE_PRICES } = require('../../ipc/inventory');
const { loadIncome } = require('../../ipc/income');
Module._load = original;

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

// Inserts history rows for Free Companies [{ fc, metric, at (ms), value }].
async function fcHistory(client, rows) {
  if (!rows.length) return;
  await client.query(`INSERT INTO companion_metric_history (subject_type, subject_id, metric, recorded_at, value)
    SELECT 'fc', fc, metric, to_timestamp(at / 1000.0), value FROM unnest($1::numeric[], $2::text[], $3::float8[], $4::numeric[]) AS t(fc, metric, at, value)`,
  [rows.map((r) => r.fc), rows.map((r) => r.metric), rows.map((r) => r.at), rows.map((r) => r.value)]);
}

// What the Income tab works out for each character with subs (ipc/income.js loadIncome; the view leaves out its Fight
// Club expected figures), by cid.
async function appIncome(client) {
  appClient = client;
  const result = await loadIncome(client);
  return { out: new Map(result.rows.map((r) => [String(r.cid), r])), windowDays: result.windowDays, kitCost: result.kitCost };
}

async function compareIncome(client) {
  const { out, windowDays, kitCost } = await appIncome(client);
  const rows = (await client.query('SELECT * FROM fleet_income_view')).rows;
  assert.strictEqual(rows.length, out.size, 'one row per character with subs');
  let enough = 0;
  for (const r of rows) {
    const e = out.get(String(r.cid));
    assert.ok(e, `character ${r.cid} has subs`);
    assert.strictEqual(r.window_days, windowDays);
    assert.strictEqual(Number(r.kit_cost), kitCost);
    assert.strictEqual(r.enough, e.enough, `${r.cid}: enough history (view ${r.span_days}, app ${e.spanDays})`);
    // The app's clock and the database's differ by a moment: allow a few seconds.
    assert.ok(Math.abs(Number(r.span_days) - e.spanDays) < 1e-4, `${r.cid}: span ${r.span_days} against ${e.spanDays}`);
    if (!e.enough) continue;
    enough++;
    const got = { pieces: Number(r.pieces), fromChest: Number(r.from_chest), firstStored: Number(r.first_stored), salvageGil: Number(r.salvage_gil),
      kitsUsed: Number(r.kits_used), kitGil: Number(r.kit_gil), net: Number(r.net) };
    const want = { pieces: e.pieces, fromChest: e.fromChest, firstStored: e.firstStored, salvageGil: e.salvageGil, kitsUsed: e.kitsUsed, kitGil: e.kitGil, net: e.net };
    assert.deepStrictEqual(got, want, `${r.cid}`);
    for (const [col, field] of [['per_day', 'perDay'], ['salvage_per_day', 'salvagePerDay'], ['kit_per_day', 'kitPerDay']]) {
      assert.ok(Math.abs(r[col] - e[field]) <= 1e-4 * Math.max(1, Math.abs(e[field])), `${r.cid} ${col}: view ${r[col]}, app ${e[field]}`);
    }
  }
  return { rows: rows.length, enough };
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
  const clear = () => client.query('TRUNCATE companion_character_current, companion_submarine_snapshot, companion_metric_history, companion_retainer_lookup, fleet_economics_settings, companion_character_housing, companion_pc_status, character_sort_order, companion_character_login, companion_inventory_snapshot, retainer_gear_targets, companion_fc_inventory_snapshot, companion_venture_result');
  try {
    await client.query(fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'schema.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'views.sql'), 'utf8'));
    // The game data columns the Salvage and Income tabs read (a new database has the tables, empty, without them); the
    // views read none of them.
    await client.query(`ALTER TABLE ffxiv_item ADD COLUMN name text, ADD COLUMN pricelow text;
      ALTER TABLE ffxiv_submarineexploration ADD COLUMN location text;
      ALTER TABLE ffxiv_submarinerank ADD COLUMN speed_bonus text, ADD COLUMN range_bonus text;
      ALTER TABLE ffxiv_submarinepart ADD COLUMN class text, ADD COLUMN slot text, ADD COLUMN speed text, ADD COLUMN range text`);
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
      // mulberry32: 32-bit integer steps, so JavaScript's numbers never lose digits (which would make it repeat).
      const random = () => {
        seed = (seed + 0x6D2B79F5) | 0;
        let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
      };
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
    await scenario('alerts: houses, low supplies, characters no longer synced and AutoRetainer, by the app\'s own rules', async () => {
      await clear();
      await setting(client, 'low_ceruleum_threshold', 100);
      await setting(client, 'low_repair_kit_threshold', 10);
      await setting(client, 'house_warn_days', 7);
      // Account A: Aki low on both; Bex low but no longer synced (2 hours behind); Cal fine. Account B: Dee without subs, low.
      await character(client, 1, { name: 'Aki', ceruleum: 50, repairKits: 5, label: 'A' });
      await character(client, 2, { name: 'Bex', ceruleum: 1, repairKits: 1, label: 'A', syncedHoursAgo: 2 });
      await character(client, 3, { name: 'Cal', ceruleum: 500, repairKits: 50, label: 'A' });
      await character(client, 4, { name: 'Dee', ceruleum: 0, repairKits: 0, label: 'B', subs: false });
      const day = 86400 * 1000;
      const houses = [[11, 'Fresh', true, 1], [12, 'Getting old', true, 9], [13, 'Danger', true, 33], [14, 'Gone soon', true, 50], [15, 'No date', true, null], [16, 'No house', false, 60]];
      for (const [fc, fcName, has, days] of houses) {
        // Two members: the newer visit counts, and the newest row gives the name.
        await client.query(`INSERT INTO companion_character_housing (cid, fc_id, fc_name, has_house, house_last_visited, updated_at) VALUES
          ($1, $2, 'Old name', $3, $4, now() - interval '1 day'), ($5, $2, $6, $3, $7, now())`,
        [fc * 10, fc, has, days === null ? null : new Date(now - (days + 3) * day), fc * 10 + 1, fcName, days === null ? null : new Date(now - days * day - 3600 * 1000)]);
      }
      await client.query(`INSERT INTO companion_pc_status (pc_name, account_label, last_sync_at, autoretainer_ready) VALUES
        ('DESKTOP-1', 'A', now() - interval '5 minutes', false), ('LAPTOP', '', now() - interval '3 days', false), ('DESKTOP-2', 'B', now(), true)`);
      const { rows } = await client.query('SELECT level, kind, subject, detail FROM fleet_alerts_view');

      // What the app's own code makes of the same data.
      const chars = (await client.query('SELECT cid::text AS cid, name, world, account_label, last_synced_at, ceruleum, repair_kits, EXISTS (SELECT 1 FROM companion_submarine_snapshot s WHERE s.cid = c.cid AND s.level > 0) AS subs FROM companion_character_current c')).rows;
      const behind = notSyncedCharacters(chars, 30);
      const want = [];
      for (const [, fcName, has, days] of houses) {
        if (!has) continue;
        const d = daysSince(days === null ? null : new Date(now - days * day - 3600 * 1000), Date.now());
        const level = houseLevel(d, 7);
        if (level !== 'ok') want.push(`${level === 'danger' ? 'danger' : 'warn'} house ${fcName}`);
      }
      for (const c of chars.filter((c) => c.subs && !behind.has(c.cid))) {
        if (c.ceruleum < 100) want.push(`warn low_ceruleum ${c.name} (Maduin)`);
        if (c.repair_kits < 10) want.push(`warn low_repair_kits ${c.name} (Maduin)`);
      }
      for (const c of chars.filter((c) => behind.has(c.cid))) want.push(`warn not_synced ${c.name} (Maduin)`);
      want.push('warn autoretainer DESKTOP-1 (A)');
      assert.deepStrictEqual(rows.map((r) => `${r.level} ${r.kind} ${r.subject}`).sort(), want.sort());
      assert.strictEqual(rows[0].kind, 'house', 'worst first: the oldest houses');
      assert.strictEqual(rows[0].subject, 'Gone soon');
      assert.match(rows[0].detail, /past 45, the game can demolish it any time/);
      assert.match(rows.find((r) => r.subject === 'Getting old').detail, /not entered for 9 days; demolished after 36 more/);
      assert.match(rows.find((r) => r.subject === 'No date').detail, /no date yet/);
      const { rows: [s] } = await client.query('SELECT low_ceruleum, low_repair_kits FROM fleet_summary_view');
      assert.deepStrictEqual([s.low_ceruleum, s.low_repair_kits], [1, 1], 'the summary leaves out Bex (no longer synced) too');
    });

    await scenario('roster: every character, with its FC, house, setup and the Roster\'s own supply warnings', async () => {
      await clear();
      await setting(client, 'low_ceruleum_threshold', 100);
      await setting(client, 'low_repair_kit_threshold', 10);
      // Account A: Aki low on both, with a house in Mist; Bex low but no longer synced; Cal low without a built sub.
      // Account B: Dee with no ceruleum recorded (NULL counts as none, as in the app), with a house in a district the
      // lookup doesn't know.
      await character(client, 1, { name: 'Aki', ceruleum: 50, repairKits: 5, label: 'A' });
      await character(client, 2, { name: 'Bex', ceruleum: 1, repairKits: 1, label: 'A', syncedHoursAgo: 2 });
      await character(client, 3, { name: 'Cal', ceruleum: 0, repairKits: 0, label: 'A', subs: false });
      await character(client, 4, { name: 'Dee', ceruleum: 0, repairKits: 50, label: 'B' });
      await client.query('UPDATE companion_character_current SET ceruleum = NULL, gil = 1234567, retainer_count = 3, submarine_count = 1 WHERE cid = 4');
      await client.query(`INSERT INTO companion_character_housing (cid, fc_id, fc_name, fc_points, has_house, house_city, house_ward, house_plot) VALUES
        (1, 11, 'Cute Kittehs!', 52000, true, 8, 12, 30), (4, 12, 'Elsewhere', NULL, true, 999, 1, 2), (3, 13, 'No House', 10, false, NULL, NULL, NULL)`);
      await client.query(`INSERT INTO companion_character_login (cid, pc_name, account_label, logged_in_at) VALUES (1, 'DESKTOP-1', 'A', now())`);
      await client.query('INSERT INTO character_sort_order (cid, sort_index) VALUES (1, 2), (2, 0)');
      const rows = (await client.query('SELECT * FROM fleet_roster_view ORDER BY cid')).rows;

      // What the Roster tab makes of the same rows (ipc/roster.js, renderer formatHouse).
      const chars = (await client.query(`SELECT c.cid::text AS cid, c.account_label, c.last_synced_at, c.ceruleum, c.repair_kits,
        (SELECT count(*) FROM companion_submarine_snapshot s WHERE s.cid = c.cid AND s.level > 0) AS subs_built FROM companion_character_current c`)).rows;
      const app = new Map(rosterWarnings(chars, notSyncedCharacters(chars, 30), { ceruleum: 100, repairKits: 10 }).map((r) => [r.cid, r]));
      const formatHouse = (h) => (h.has_house ? `${h.district_name || `City ${h.house_city}`} W${h.house_ward} P${h.house_plot}` : null);
      const housing = new Map((await client.query(`SELECT h.cid::text AS cid, h.*, k.city_name AS district_name FROM companion_character_housing h
        LEFT JOIN housing_key_city_lookup k ON k.city_id = h.house_city`)).rows.map((h) => [h.cid, h]));
      assert.strictEqual(rows.length, 4, 'every character, with or without subs');
      for (const r of rows) {
        const want = app.get(String(r.cid));
        const h = housing.get(String(r.cid));
        assert.deepStrictEqual([r.low_ceruleum, r.low_repair_kits, r.behind_minutes !== null], [want.low_ceruleum, want.low_repair, want.not_synced_ms !== null], `${r.name}: warnings`);
        if (want.not_synced_ms !== null) assert.strictEqual(r.behind_minutes, Math.floor(want.not_synced_ms / 60000), `${r.name}: minutes behind`);
        assert.strictEqual(r.house, h ? formatHouse(h) : null, `${r.name}: house`);
      }
      const [aki, bex, cal, dee] = rows;
      assert.deepStrictEqual([aki.low_ceruleum, aki.low_repair_kits, bex.low_ceruleum, cal.low_ceruleum, dee.low_ceruleum, dee.low_repair_kits],
        [true, true, false, false, true, false], 'Aki low on both; Bex no longer synced; Cal has no sub; Dee has no ceruleum recorded');
      assert.deepStrictEqual([aki.house, dee.house, cal.house, bex.house], ['Mist W12 P30', 'City 999 W1 P2', null, null]);
      assert.deepStrictEqual([aki.fc_name, aki.fc_points, aki.login_pc, aki.login_label, aki.sort_index, bex.sort_index, cal.sort_index],
        ['Cute Kittehs!', 52000, 'DESKTOP-1', 'A', 2, 0, null]);
      assert.deepStrictEqual([Number(dee.gil), dee.retainer_count, dee.submarine_count, dee.subs_built, cal.subs_built], [1234567, 3, 1, 1, 0]);
      assert.ok(bex.behind_minutes >= 119 && bex.behind_minutes <= 120, `Bex is about 2 hours behind: ${bex.behind_minutes}`);
    });

    await scenario('retainers: every retainer with its owner, venture, gear target and whether its items were seen; gear one row per item', async () => {
      await clear();
      await character(client, 1, { name: 'Aki', label: 'A' });
      await client.query('INSERT INTO character_sort_order (cid, sort_index) VALUES (1, 4)');
      await client.query(`INSERT INTO companion_retainer_lookup (retainer_id, owner_cid, name, job, level, gil, has_venture, venture_id, venture_ends_at, hire_order_index, items_seen_at) VALUES
        (10, 1, 'Seen', 18, 100, 5000, true, 395, 1800000000, 0, NULL),
        (11, 1, 'Empty', 1, 90, 0, false, NULL, NULL, 1, now()),
        (12, 1, 'Unseen', 0, NULL, NULL, NULL, NULL, NULL, 2, NULL),
        (13, 99, 'Orphan', 10, 5, 1, false, NULL, NULL, NULL, NULL)`);
      await client.query(`INSERT INTO companion_inventory_snapshot (owner_cid, retainer_id, sorted_container, sorted_slot_index, item_id, quantity) VALUES
        (1, 10, 11000, 0, 40000, 1), (1, 10, 11000, 1, 40001, 1), (1, 10, 10000, 0, 5, 99), (1, 10, 11000, 2, NULL, 0)`);
      await client.query(`INSERT INTO retainer_gear_targets (retainer_id, target_mode, target_value, only_crafted) VALUES (10, 'ilvl', 690, true)`);
      const rows = (await client.query('SELECT * FROM fleet_retainers_view ORDER BY retainer_id')).rows;
      assert.deepStrictEqual(rows.map((r) => [Number(r.retainer_id), r.owner_name, r.retainer_name, r.job, r.level, r.has_venture, r.venture_id, r.target_mode, r.target_value, r.only_crafted, r.items_seen, r.sort_index]), [
        [10, 'Aki', 'Seen', 18, 100, true, 395, 'ilvl', 690, true, true, 4],
        [11, 'Aki', 'Empty', 1, 90, false, null, null, null, false, true, 4],
        [12, 'Aki', 'Unseen', 0, null, null, null, null, null, false, false, 4],
        [13, null, 'Orphan', 10, 5, false, null, null, null, false, false, null],
      ], 'as the Retainers tab reads them (ipc/retainers.js get-retainer-targets): items seen when stored or seen holding nothing');
      assert.strictEqual(Number(rows[0].venture_ends_at), 1800000000);
      const gear = (await client.query('SELECT retainer_id, item_id FROM fleet_retainer_gear_view ORDER BY item_id')).rows;
      assert.deepStrictEqual(gear.map((g) => [Number(g.retainer_id), g.item_id]), [[10, 40000], [10, 40001]], 'only what it wears (container 11000), as the Avg ilvl');
    });

    await scenario('PCs: every setup as the PCs tab reads it, with what it couldn\'t see one per line', async () => {
      await clear();
      await client.query(`INSERT INTO companion_pc_status (pc_name, account_label, plugin_version, last_sync_at, autoretainer_ready, allagantools_ready,
          fctracker_found, submarinetracker_found, venture_stats_found, characters_synced, characters_left_out, characters_elsewhere, problems, check_text, check_to_fix, check_at) VALUES
        ('DESKTOP-1', 'A', '2.0.0.9', now(), true, true, false, true, true, 12, 2, 3, ARRAY['Aki: no FC chest', 'Bex: no retainers'], 'All good', 0, now()),
        ('LAPTOP', '', '1.0.3.4', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '{}', NULL, NULL, NULL)`);
      const rows = (await client.query('SELECT * FROM fleet_pcs_view ORDER BY pc_name')).rows;
      assert.deepStrictEqual(rows.map((r) => [r.pc_name, r.account_label, r.plugin_version, r.autoretainer_ready, r.fctracker_found, r.characters_synced, r.characters_left_out, r.characters_elsewhere, r.problems, r.check_text]), [
        ['DESKTOP-1', 'A', '2.0.0.9', true, false, 12, 2, 3, 'Aki: no FC chest\nBex: no retainers', 'All good'],
        ['LAPTOP', '', '1.0.3.4', null, null, null, null, null, '', null],
      ]);
    });

    await scenario('retainer counts: the app Summary\'s own (characters/retainer-summary.js), leaving out characters no longer synced', async () => {
      await clear();
      await character(client, 1, { name: 'Aki', label: 'A' });
      await character(client, 2, { name: 'Bex', label: 'A', syncedHoursAgo: 2 }); // no longer synced
      const secs = Math.floor(Date.now() / 1000);
      await client.query(`INSERT INTO companion_retainer_lookup (retainer_id, owner_cid, name, job, has_venture, venture_ends_at) VALUES
        (1, 1, 'Done', 1, true, $1), (2, 1, 'Away', 1, true, $2), (3, 1, 'Idle', 1, false, NULL), (4, 1, 'NoEnd', 1, true, 0),
        (5, 1, 'Unknown', 1, NULL, NULL), (6, 1, 'NoClass', 0, false, NULL), (7, 1, 'NullClass', NULL, false, NULL),
        (8, 2, 'BexIdle', 1, false, NULL), (9, 99, 'Orphan', 1, false, NULL)`, [secs - 10, secs + 999]);
      const { rows: [v] } = await client.query('SELECT * FROM fleet_retainer_counts_view');
      // What the app's Summary makes of the same retainers (ipc/retainers.js get-retainer-summary).
      const rows = (await client.query(`SELECT rl.owner_cid::text AS owner_cid, c.name AS owner_name, c.account_label, c.last_synced_at, rl.name AS retainer_name,
        rl.has_venture, rl.venture_ends_at FROM companion_retainer_lookup rl JOIN companion_character_current c ON c.cid = rl.owner_cid WHERE rl.job > 0`)).rows;
      const behind = notSyncedCharacters(rows.map((r) => ({ cid: r.owner_cid, account_label: r.account_label, last_synced_at: r.last_synced_at })), 30);
      const app = retainerSummary(rows.filter((r) => !behind.has(String(r.owner_cid))));
      assert.deepStrictEqual([v.retainers, v.ventures_done, v.retainers_away, v.retainers_idle], [app.total, app.ready, app.away, app.idle.length]);
      assert.deepStrictEqual([v.retainers, v.ventures_done, v.retainers_away, v.retainers_idle], [5, 1, 2, 2], 'no end time counts as away; no class, no longer synced and no owner left out');
      const { rows: [s] } = await client.query('SELECT retainers, ventures_done, retainers_idle FROM fleet_summary_view');
      assert.deepStrictEqual([s.retainers, s.ventures_done, s.retainers_idle], [5, 1, 2], 'the summary counts the same');
    });

    await scenario('Free Companies: as the Free Companies tab (characters/fc-directory-rows.js), houses and bid eligibility', async () => {
      await clear();
      await setting(client, 'house_warn_days', 7);
      await client.query('ALTER TABLE ffxiv_world ADD COLUMN IF NOT EXISTS name text');
      await character(client, 1, { name: 'Aki', label: 'B' });
      await character(client, 2, { name: 'Bex', label: 'A' });
      await character(client, 3, { name: 'Cal', label: null });
      await client.query('UPDATE companion_character_current SET fc_id = CASE cid WHEN 1 THEN 9232379236109516811 WHEN 2 THEN 9232379236109516811 WHEN 3 THEN 12 END');
      await client.query('INSERT INTO character_sort_order (cid, sort_index) VALUES (1, 5), (2, 3)');
      const day = 86400 * 1000;
      const at = (days) => new Date(Date.now() - days * day - 3600 * 1000);
      // FC 9232379236109516811 (a real-sized id, past a signed 64-bit number): a house entered 9 days ago (two members' rows: the newer details win). FC 12-17: no house, founded at
      // different times, ranks good, low, missing and not a number. FC 18: a house with no date.
      await client.query(`INSERT INTO companion_character_housing (cid, fc_id, fc_name, fc_master, fc_points, fc_rank, total_members, has_house,
          house_city, house_ward, house_plot, house_last_visited, fc_home_world_id, fc_founding_date, fc_eligibility_override, updated_at) VALUES
        (1, 9232379236109516811, 'Old name', 'Aki', 10, '8', 3, true, 8, 12, 30, $1, 34, NULL, NULL, now() - interval '1 day'),
        (2, 9232379236109516811, 'Cute Kittehs!', 'Aki', 52000, '8', 3, true, 8, 12, 30, $2, 34, NULL, NULL, now()),
        (3, 12, 'Young', 'Cal', 0, '7', 1, false, NULL, NULL, NULL, NULL, 63, $3, NULL, now()),
        (31, 13, 'Ready', 'X', 0, ' 6', 1, false, NULL, NULL, NULL, NULL, NULL, $4, NULL, now()),
        (32, 14, 'Low rank', 'X', 0, '3', 1, false, NULL, NULL, NULL, NULL, NULL, $4, NULL, now()),
        (33, 15, 'No rank', 'X', 0, NULL, 1, false, NULL, NULL, NULL, NULL, NULL, $4, NULL, now()),
        (34, 16, 'Odd rank', 'X', 0, 'x', 1, false, NULL, NULL, NULL, NULL, NULL, $4, NULL, now()),
        (35, 17, 'Override', 'X', 0, '9', 1, false, NULL, NULL, NULL, NULL, NULL, $4, $5, now()),
        (36, 18, 'No date', 'X', 0, '9', 1, true, 999, 1, 2, NULL, NULL, NULL, NULL, now())`,
      [at(12), at(9), at(29.5), at(45), at(1)]);
      const view = (await client.query('SELECT * FROM fleet_fcs_view ORDER BY fc_id')).rows;
      const current = buildSnapshotFragments({ useCurrent: true }).latestFcMember;
      const app = fcDirectoryRows((await client.query(fcDirectorySql(current))).rows, 7);
      assert.strictEqual(view.length, app.length, 'one row per Free Company');
      const formatHouse = (h) => (h.has_house ? `${h.district_name || `City ${h.house_city}`} W${h.house_ward} P${h.house_plot}` : null);
      for (const v of view) {
        const a = app.find((x) => String(x.fc_id) === String(v.fc_id));
        const got = [v.fc_name, v.fc_master, v.fc_points, v.fc_rank, v.total_members, v.has_house, v.house, v.house_days, v.house_level, v.demolition_in_days,
          v.eligibility, v.eligible_at ? v.eligible_at.toISOString() : null, v.account_label, v.sort_index];
        const want = [a.fc_name, a.fc_master, a.fc_points, a.fc_rank, a.total_members, a.has_house, formatHouse(a), a.house_days, a.house_level, a.demolition_in_days,
          a.eligibility, a.eligible_at, a.account_label, a.sort_index];
        assert.deepStrictEqual(got, want, `FC ${v.fc_id}`);
      }
      const by = Object.fromEntries(view.map((v) => [v.fc_name, v]));
      assert.deepStrictEqual([by['Cute Kittehs!'].house, by['Cute Kittehs!'].house_days, by['Cute Kittehs!'].house_level, by['Cute Kittehs!'].account_label, by['Cute Kittehs!'].sort_index],
        ['Mist W12 P30', 9, 'warn', 'A', 3], 'the newest details, the latest visit, the first account label and Roster place');
      assert.deepStrictEqual([by.Young.eligibility, by.Ready.eligibility, by['Low rank'].eligibility, by['No rank'].eligibility, by['Odd rank'].eligibility, by.Override.eligibility, by['No date'].house_level],
        ['Eligible in 1 day', 'Eligible', 'Rank too low (3/6)', 'Rank too low (?/6)', 'Rank too low (?/6)', 'Eligible in 29 days', 'unknown']);
      assert.strictEqual(Number(by.Young.home_world_id), 63);
    });

    await scenario('holdings: every stack with the place Where is it? names, FC chests on the member the app counts them on', async () => {
      await clear();
      await character(client, 1, { name: 'Aki', label: 'A' });
      await character(client, 2, { name: 'Bex', label: 'B' });
      await character(client, 3, { name: 'Cal', label: 'B' });
      await client.query('UPDATE companion_character_current SET fc_id = CASE cid WHEN 1 THEN 9232379236109516811 WHEN 2 THEN 9232379236109516811 WHEN 3 THEN 12 END');
      await client.query('INSERT INTO character_sort_order (cid, sort_index) VALUES (1, 5), (2, 3), (3, 9)');
      await client.query(`INSERT INTO companion_character_housing (cid, fc_id, fc_name, fc_master, updated_at) VALUES
        (1, 9232379236109516811, 'Kittehs', 'aki', now()), (2, 9232379236109516811, 'Kittehs', 'aki', now() - interval '1 day'), (3, 12, NULL, 'Nobody', now())`);
      await client.query(`INSERT INTO companion_retainer_lookup (retainer_id, owner_cid, name, hire_order_index) VALUES (100, 1, 'Ret A', 0), (101, 1, '', 1)`);
      const containers = [0, 3, 1000, 2000, 2001, 2003, 2004, 2500, 2501, 2502, 3200, 3500, 4000, 4101, 25000, 27010, 9999];
      let slot = 0;
      const own = containers.map((c) => `(1, 1, ${c}, ${slot++}, ${c === 2000 ? 1 : 1010155}, 5)`);
      const retainer = [10000, 10006, 11000, 12000, 12001, 12002, 13000].map((c) => `(1, ${c === 13000 ? 101 : 100}, ${c}, ${slot++}, 10155, 2)`);
      const empty = ['(2, 2, 0, 0, 10155, 0)', '(3, 3, 1, 1, 10155, 7)', '(77, 77, 0, 0, 10373, 1)'];
      await client.query(`INSERT INTO companion_inventory_snapshot (owner_cid, retainer_id, sorted_container, sorted_slot_index, item_id, quantity) VALUES ${[...own, ...retainer, ...empty].join(', ')}`);
      await client.query(`INSERT INTO companion_fc_inventory_snapshot (fc_id, sorted_container, sorted_slot_index, item_id, quantity) VALUES
        (9232379236109516811, 20000, 0, 10155, 100), (9232379236109516811, 20004, 1, 10155, 1), (9232379236109516811, 22000, 0, 1, 500000), (9232379236109516811, 22001, 0, 2, 9), (12, 21000, 0, 10155, 3), (12, 20010, 1, 10155, 0)`);
      const rows = (await client.query('SELECT * FROM fleet_holdings_view')).rows;
      assert.strictEqual(rows.length, own.length + retainer.length + 2 + 5, 'every stack with something in it (2 more bags, 5 FC stacks)');
      // The app's own names for the places (characters/item-locations.js), and its chest holders (characters/fc-chest.js).
      const names = new Map((await client.query('SELECT sorted_container, display_name FROM companion_inventory_type_lookup')).rows.map((r) => [r.sorted_container, r.display_name]));
      const characters = (await client.query(`SELECT c.cid, c.name, c.fc_id, h.fc_master, so.sort_index FROM companion_character_current c
        LEFT JOIN character_sort_order so ON so.cid = c.cid LEFT JOIN companion_character_housing h ON h.cid = c.cid AND h.fc_id = c.fc_id`)).rows;
      const holders = chestHolders(characters);
      const retainerNames = { 100: 'Ret A', 101: '' };
      for (const r of rows) {
        const want = placeLabel({ kind: r.kind, container: r.container, containerName: names.get(r.container), retainerName: retainerNames[Number(r.retainer_id)] });
        assert.strictEqual(r.place, want, `${r.kind} container ${r.container}`);
        assert.strictEqual(r.money, MONEY_CONTAINERS.includes(r.container), `container ${r.container}: money`);
        if (r.kind === 'fc') assert.strictEqual(String(r.owner_cid), holders.get(String(r.fc_id)), `FC ${r.fc_id}: counted on the app's holder`);
      }
      const bag = rows.find((r) => r.kind === 'character' && r.container === 0);
      assert.deepStrictEqual([bag.item_id, bag.hq, bag.who, bag.account_label, bag.sort_index], [10155, true, 'Aki', 'A', 5], 'HQ items as the plain item, marked hq');
      const kittehs = rows.find((r) => r.kind === 'fc' && r.container === 20000);
      assert.deepStrictEqual([kittehs.who, kittehs.owner_name, kittehs.account_label, kittehs.place], ['Kittehs', 'Aki', 'A', 'FC chest tab 1'], 'the leader holds the chest (names compared without case)');
      const nameless = rows.find((r) => r.kind === 'fc' && r.fc_id == 12);
      assert.deepStrictEqual([nameless.who, nameless.owner_name], ['Free Company 12', 'Cal'], 'no FC name; the only member holds it');
      assert.strictEqual(rows.find((r) => String(r.owner_cid) === '77').who, 'Character 77', 'a character not in the Roster');

      // Fleet totals, as the Inventory tab's (ipc/inventory.js get-fleet-inventory-summary): bags except the character's
      // gil, plus every FC chest, by item as stored (HQ apart).
      const app = new Map();
      for (const r of (await client.query(`SELECT item_id, SUM(quantity) AS q FROM companion_inventory_snapshot WHERE quantity > 0 AND sorted_container != 2000 GROUP BY item_id
          UNION ALL SELECT item_id, SUM(quantity) FROM companion_fc_inventory_snapshot WHERE quantity > 0 GROUP BY item_id`)).rows) {
        app.set(Number(r.item_id), (app.get(Number(r.item_id)) || 0) + Number(r.q));
      }
      const totals = (await client.query('SELECT * FROM fleet_item_totals_view')).rows;
      assert.deepStrictEqual(new Map(totals.map((t) => [t.item_id + (t.hq ? 1000000 : 0), Number(t.total)])), app);
    });
    await scenario('salvage: what the Salvage tab counts for each character, FC chests on the member it counts them on', async () => {
      await clear();
      await character(client, 1, { name: 'Aki', label: 'A' });
      await character(client, 2, { name: 'Bex', label: 'B' });
      await character(client, 3, { name: 'Cal', label: 'B' });
      await character(client, 4, { name: 'Dee', label: 'B' });
      await client.query('UPDATE companion_character_current SET fc_id = CASE cid WHEN 1 THEN 9232379236109516811 WHEN 2 THEN 9232379236109516811 WHEN 3 THEN 12 END');
      await client.query('INSERT INTO character_sort_order (cid, sort_index) VALUES (1, 5), (2, 3), (3, 9)');
      await client.query(`INSERT INTO companion_character_housing (cid, fc_id, fc_name, fc_master, updated_at) VALUES (1, 9232379236109516811, 'Kittehs', 'Bex', now())`);
      await client.query(`INSERT INTO companion_inventory_snapshot (owner_cid, retainer_id, sorted_container, sorted_slot_index, item_id, quantity) VALUES
        (1, 1, 0, 0, 22500, 3), (1, 1, 0, 1, 22500, 2), (1, 100, 10000, 0, 22507, 1), (1, 1, 4000, 0, 22503, 4), (1, 1, 0, 2, 10155, 9),
        (2, 2, 0, 0, 22504, 0), (3, 3, 3200, 0, 22506, 1), (77, 77, 0, 0, 22500, 5), (4, 4, 0, 0, 10155, 1)`);
      await client.query(`INSERT INTO companion_fc_inventory_snapshot (fc_id, sorted_container, sorted_slot_index, item_id, quantity) VALUES
        (9232379236109516811, 20000, 0, 22501, 10), (9232379236109516811, 20001, 0, 22505, 2), (12, 20000, 0, 22502, 1), (55, 20000, 0, 22502, 8)`);
      appClient = client;
      const app = await handlers.get('get-salvage')();
      assert.ok(app.success, app.error);
      const rows = (await client.query('SELECT * FROM fleet_salvage_view')).rows;
      const view = new Map(rows.map((r) => [String(r.cid), r]));
      assert.deepStrictEqual([...view.keys()].sort(), app.rows.map((r) => String(r.cid)).sort(), 'the same characters (only those holding salvage)');
      for (const a of app.rows) {
        const r = view.get(String(a.cid));
        assert.deepStrictEqual([Number(r.standard), Number(r.extravagant), Number(r.gil), r.name, r.account_label, r.sort_index],
          [a.standard_total, a.extravagant_total, a.calculated_gil, a.character_name, a.account_label, a.sort_index], a.character_name);
        const pieces = Object.fromEntries(Object.keys(SALVAGE_PRICES).map((id) => [id, 0]));
        for (const b of [...a.standard_breakdown, ...a.extravagant_breakdown]) pieces[b.item_id] = b.qty;
        assert.deepStrictEqual(Object.fromEntries(Object.keys(SALVAGE_PRICES).map((id) => [id, Number(r[`q${id}`])])), pieces, `${a.character_name}: each piece`);
      }
      assert.strictEqual(Number(view.get('2').extravagant), 2, 'Bex leads Kittehs, so its chest is counted on Bex');
    });

    await scenario('income: hand-made cases give what the Income tab gives (chest, first-stored, kits, short history)', async () => {
      await clear();
      const at = (h) => ago(h) - 7 * 60 * 1000; // a few minutes off the hour, away from the window's edge
      await character(client, 1, { name: 'Aki' });
      await character(client, 2, { name: 'Bex' });
      await character(client, 3, { name: 'Cal', syncedHoursAgo: 0 });
      await character(client, 4, { name: 'Dee', subs: false });
      await client.query('UPDATE companion_character_current SET fc_id = 9232379236109516811 WHERE cid IN (1, 2)');
      await setting(client, 'repair_kit_cost', 2500);
      await history(client, [
        // Aki: 5 came in, 2 more taken out of the chest at the same moment, then 3 seen for the first time.
        { cid: 1, metric: 'item_qty:22500', at: at(200), value: 4 },
        { cid: 1, metric: 'item_qty:22500', at: at(100), value: 9 },
        { cid: 1, metric: 'item_qty:22505', at: at(90), value: 0 },
        { cid: 1, metric: 'item_qty:22505', at: at(50), value: 4 },
        { cid: 1, metric: 'item_qty:22500', at: at(20), value: 12 },
        { cid: 1, metric: 'item_qty:22500', at: at(10), value: 1 },
        { cid: 1, metric: 'inventory_sources', at: at(100), value: 3 },
        { cid: 1, metric: 'inventory_sources', at: at(20), value: 4 },
        { cid: 1, metric: 'repair_kits', at: at(200), value: 50 },
        { cid: 1, metric: 'repair_kits', at: at(60), value: 41 },
        { cid: 1, metric: 'repair_kits', at: at(30), value: 60 },
        { cid: 1, metric: 'repair_kits', at: at(5), value: 55 },
        // Bex: kits in bags and retainers from before the window, so those count.
        { cid: 2, metric: 'item_qty:22501', at: at(150), value: 1 },
        { cid: 2, metric: 'item_qty:22501', at: at(40), value: 6 },
        { cid: 2, metric: 'item_qty:10373', at: at(190), value: 100 },
        { cid: 2, metric: 'item_qty:10373', at: at(30), value: 90 },
        { cid: 2, metric: 'repair_kits', at: at(30), value: 1 },
        // Cal: under a day of salvage history.
        { cid: 3, metric: 'item_qty:22500', at: at(10), value: 1 },
        { cid: 3, metric: 'item_qty:22500', at: at(2), value: 7 },
      ]);
      await fcHistory(client, [
        { fc: '9232379236109516811', metric: 'item_qty:22505', at: at(90), value: 10 },
        { fc: '9232379236109516811', metric: 'item_qty:22505', at: at(50), value: 8 },
      ]);
      const { rows, enough } = await compareIncome(client);
      assert.deepStrictEqual([rows, enough], [3, 2], 'Aki, Bex and Cal have subs; Cal has under a day');
      const aki = (await client.query('SELECT * FROM fleet_income_view WHERE cid = 1')).rows[0];
      assert.deepStrictEqual([Number(aki.pieces), Number(aki.from_chest), Number(aki.first_stored)], [7, 2, 3], 'Aki: 5 + 2 came in, 2 from the chest, 3 first stored');
      await setting(client, 'income_window_days', 3);
      await compareIncome(client);
      await setting(client, 'income_window_days', 30);
      await compareIncome(client);
    });

    await scenario('income: 200 random histories (rises, drops, chest moves, first-time items, late syncs) match the Income tab', async () => {
      await clear();
      let seed = 7;
      const random = () => {
        seed = (seed + 0x6D2B79F5) | 0;
        let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
      };
      const ids = Object.keys(SALVAGE_PRICES);
      const rows = [];
      const chest = [];
      const fcs = ['9232379236109516811', '9232379236109516900', '31'];
      const chestCount = new Map();
      for (let cid = 500; cid < 700; cid++) {
        const fc = random() < 0.7 ? fcs[Math.floor(random() * fcs.length)] : null;
        const minute = (cid - 500) * 0.25 + 1; // each character syncs at its own moment, so FC members never share one
        const synced = random() < 0.2 ? random() * 200 : random() * 2;
        const span = Math.floor(random() * 40 * 24);
        const counts = Object.fromEntries(ids.map((id) => [id, Math.floor(random() * 5)]));
        let kits = Math.floor(random() * 200);
        let sources = 2;
        const withTotals = random() < 0.5;
        for (let h = span; h >= Math.ceil(synced); h--) {
          const t = ago(h) - minute * 60 * 1000;
          const newSource = random() < 0.03;
          if (newSource) { sources++; rows.push({ cid, metric: 'inventory_sources', at: t, value: sources }); }
          for (const id of ids) {
            if (random() > 0.08) continue;
            const before = counts[id];
            if (random() < 0.7) counts[id] += 1 + Math.floor(random() * 4); else counts[id] = Math.max(0, counts[id] - Math.floor(random() * 6));
            if (fc && counts[id] > before && random() < 0.3) {
              const key = `${fc}|${id}`;
              const had = chestCount.get(key) ?? 20;
              const taken = Math.min(had, Math.floor(random() * 4));
              chestCount.set(key, had - taken);
              chest.push({ fc, metric: `item_qty:${id}`, at: t, value: had - taken });
            }
            rows.push({ cid, metric: `item_qty:${id}`, at: t, value: counts[id] });
          }
          if (random() < 0.2) { kits = random() < 0.1 ? kits + 50 : Math.max(0, kits - Math.floor(random() * 3)); rows.push({ cid, metric: 'repair_kits', at: t, value: kits }); }
          if (withTotals && random() < 0.2) rows.push({ cid, metric: 'item_qty:10373', at: t, value: kits + 10 });
          if (random() < 0.02) rows.push({ cid, metric: `item_qty:${ids[0]}`, at: t, value: counts[ids[0]] }); // an hourly reminder
        }
        await character(client, cid, { syncedHoursAgo: synced, subs: random() < 0.9 });
        if (fc) await client.query('UPDATE companion_character_current SET fc_id = $2 WHERE cid = $1', [cid, fc]);
      }
      await history(client, rows);
      await fcHistory(client, chest);
      await setting(client, 'repair_kit_cost', 1730);
      for (const w of [7, 3, 14, 30]) {
        await setting(client, 'income_window_days', w);
        const { enough } = await compareIncome(client);
        assert.ok(enough > 50, `enough characters with history to compare (${enough})`);
      }
    });

    await scenario('venture income: each character\'s rewards over the window, by item, leaving out characters not in the Roster', async () => {
      await clear();
      await character(client, 1, { name: 'Aki', label: 'A' });
      await character(client, 2, { name: 'Bex', label: 'B' });
      await setting(client, 'income_window_days', 7);
      const rewards = [];
      let k = 0;
      for (const [owner, retainer, hoursAgo, item, hq, qty] of [
        [1, 'Ret A', 1, 5111, false, 3], [1, 'Ret A', 2, 5111, true, 2], [1, 'Ret B', 3, 22500, false, 1], [1, 'Ret B', 200, 5111, false, 9],
        [2, 'Ret C', 10, 6000, false, 1], [2, 'Ret C', 11, 6000, false, 1], [180144985774840040, 'Gone', 5, 6600, false, 67],
      ]) rewards.push(`(${owner}, '${retainer}', now() - make_interval(secs => ${hoursAgo * 3600 + k++}), ${item}, ${hq}, ${qty})`);
      await client.query(`INSERT INTO companion_venture_result (owner_cid, retainer_name, received_at, item_id, hq, quantity) VALUES ${rewards.join(', ')}`);
      const recent = (await client.query(`SELECT * FROM companion_venture_result WHERE received_at > now() - interval '7 days'
        AND owner_cid IN (SELECT cid FROM companion_character_current)`)).rows;
      const want = new Map();
      for (const t of ventureTotals(recent)) {
        const key = `${t.owner_cid}|${t.item_id}`;
        want.set(key, (want.get(key) || 0) + t.quantity);
      }
      const rows = (await client.query('SELECT * FROM fleet_venture_income_view')).rows;
      assert.deepStrictEqual(new Map(rows.map((r) => [`${r.owner_cid}|${r.item_id}`, Number(r.quantity)])), want);
      const aki = rows.filter((r) => String(r.owner_cid) === '1');
      assert.deepStrictEqual([Number(aki[0].rewards), Number(aki[0].retainers), aki[0].window_days, aki[0].name], [3, 2, 7, 'Aki'], 'Aki: 3 rewards in the window from 2 retainers');
      assert.strictEqual(rows.find((r) => r.item_id === 22500).salvage_price, 8000, 'salvage at its fixed price');
      assert.ok(!rows.some((r) => String(r.owner_cid) === '180144985774840040'), 'a removed character is left out');
    });
  } finally {
    await client.end();
    await admin.query(`DROP DATABASE IF EXISTS ${NAME}`);
    await admin.end();
  }
})();
