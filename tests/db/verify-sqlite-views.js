// Checks that the fleet views give the same answers on SQLite (db/sqlite/views.sql, for the plugin-only one-file
// version planned near the end of 2.x) as on PostgreSQL (db/views.sql). Both get the same made-up fleet: random
// characters, subs, supply history, retainers, houses, setups and settings, with the awkward cases (missing values,
// unknown parts, characters no longer synced, odd settings) on purpose. Then every row of every view is compared.
// PostgreSQL's views are themselves checked against the app's own code in verify-fleet-views.js.
//
// Set PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE for a scratch server, as its administrator: it makes and drops a
// database named fleet_sqlite_check. SQLite is Node's own (node:sqlite, Node 22.13 or later), in memory.
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const assert = require('node:assert');

process.removeAllListeners('warning'); // node:sqlite's "experimental" notice
const { DatabaseSync } = require('node:sqlite');

const NAME = 'fleet_sqlite_check';
const DB = path.join(__dirname, '..', '..', 'db');
const VIEWS = [
  ['fleet_supplies_view', ['cid']],
  ['fleet_subs_view', ['cid', 'sub_name']],
  ['fleet_not_synced_view', ['cid']],
  ['fleet_summary_view', []],
  ['fleet_alerts_view', null], // in the view's own order
  ['fleet_roster_view', ['cid']],
  ['fleet_retainers_view', ['retainer_id']],
  ['fleet_retainer_gear_view', ['retainer_id', 'item_id']],
  ['fleet_pcs_view', ['pc_name', 'account_label']],
];

let n = 0;
async function scenario(name, fn) {
  try { await fn(); console.log(`PASS ${++n}. ${name}`); } catch (e) { console.log(`FAIL ${++n}. ${name}\n   ${e.stack}`); process.exitCode = 1; }
}

// Column kinds that are stored differently: times (PostgreSQL timestamps, SQLite Unix seconds), booleans (true/false,
// 0/1) and lists (text[], one per line).
const TIMES = new Set(['first_seen_at', 'last_synced_at', 'updated_at', 'recorded_at', 'items_seen_at', 'house_last_visited',
  'logged_in_at', 'last_sync_at', 'check_at']);
const BOOLS = new Set(['has_venture', 'has_house', 'only_crafted', 'autoretainer_ready', 'allagantools_ready', 'fctracker_found',
  'submarinetracker_found', 'venture_stats_found']);
const LISTS = new Set(['problems']);

// Puts the same rows in both: rows are plain objects, times in Unix seconds.
async function insert(pg, lite, table, rows) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const forPg = (c, v) => (v === null || v === undefined ? null : TIMES.has(c) ? new Date(v * 1000) : typeof v === 'bigint' ? v.toString() : v);
  const forLite = (c, v) => (v === null || v === undefined ? null : BOOLS.has(c) ? (v ? 1 : 0) : LISTS.has(c) ? v.join('\n') : v);
  for (let start = 0; start < rows.length; start += 500) {
    const batch = rows.slice(start, start + 500);
    const values = [];
    const tuples = batch.map((r) => `(${cols.map((c) => { values.push(forPg(c, r[c])); return `$${values.length}`; }).join(', ')})`);
    await pg.query(`INSERT INTO ${table} (${cols.join(', ')}) VALUES ${tuples.join(', ')}`, values);
  }
  const stmt = lite.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`);
  for (const r of rows) stmt.run(...cols.map((c) => forLite(c, r[c])));
}

// One value as a comparable plain value: numbers as numbers, times as Unix seconds, booleans as 0/1, intervals as
// seconds.
function plain(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.getTime() / 1000;
  if (typeof v === 'boolean') return v ? 1 : 0;
  // Whole numbers too big for JavaScript's numbers (character and retainer ids) stay exact, as text.
  if (typeof v === 'bigint') return Number.isSafeInteger(Number(v)) ? Number(v) : v.toString();
  if (typeof v === 'object' && ('hours' in v || 'days' in v || 'minutes' in v || 'seconds' in v || typeof v.toPostgres === 'function')) {
    return (v.days || 0) * 86400 + (v.hours || 0) * 3600 + (v.minutes || 0) * 60 + (v.seconds || 0) + (v.milliseconds || 0) / 1000;
  }
  if (typeof v === 'string' && /^-?\d+$/.test(v)) return Number.isSafeInteger(Number(v)) ? Number(v) : v;
  if (typeof v === 'string' && /^-?\d+\.\d+$/.test(v)) return Number(v);
  return v;
}
const same = (a, b) => {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
  return a === b;
};

async function compare(pg, lite, view, key) {
  const pgRows = (await pg.query(`SELECT * FROM ${view}`)).rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, plain(v)])));
  const stmt = lite.prepare(`SELECT * FROM ${view}`);
  stmt.setReadBigInts(true);
  const liteRows = stmt.all().map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, plain(v)])));
  assert.deepStrictEqual(Object.keys(liteRows[0] || {}).sort(), Object.keys(pgRows[0] || {}).sort(), `${view}: the same columns`);
  assert.strictEqual(liteRows.length, pgRows.length, `${view}: the same number of rows`);
  const order = (rows) => (key ? [...rows].sort((a, b) => {
    for (const k of key) { if (a[k] < b[k]) return -1; if (a[k] > b[k]) return 1; }
    return 0;
  }) : rows);
  const [p, l] = [order(pgRows), order(liteRows)];
  for (let i = 0; i < p.length; i++) {
    for (const col of Object.keys(p[i])) {
      assert.ok(same(p[i][col], l[i][col]),
        `${view} row ${i + 1} (${(key || []).map((k) => `${k} ${p[i][k]}`).join(', ') || 'in order'}), ${col}: PostgreSQL ${JSON.stringify(p[i][col])}, SQLite ${JSON.stringify(l[i][col])}`);
    }
  }
  return p.length;
}

// A made-up fleet, the same for both, from a seed.
function fleet(seed, now) {
  // mulberry32: 32-bit integer steps, so JavaScript's numbers never lose digits (which would make it repeat).
  const random = () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const pick = (list) => list[Math.floor(random() * list.length)];
  const chance = (p) => random() < p;
  const ago = (hours) => now - hours * 3600 - 1234; // never exactly on an hour, so never right on a window's edge
  const PARTS = [21792, 21795, 21797, 22527, 23904, 24346, 24349, 24353, 24358, 24361, 24366];
  const t = { companion_character_current: [], character_sort_order: [], companion_submarine_snapshot: [], companion_metric_history: [],
    companion_retainer_lookup: [], companion_character_housing: [], companion_character_login: [], companion_pc_status: [],
    companion_inventory_snapshot: [], retainer_gear_targets: [] };
  let retainerId = 33777097243660300n;
  for (let i = 0; i < 160; i++) {
    const cid = 18014498578000000n + BigInt(i);
    const label = pick(['A', 'A', 'B', 'B', '', null]);
    const behindHours = chance(0.15) ? random() * 200 : random() * 0.08;
    let cer = Math.floor(random() * 3000);
    let kits = Math.floor(random() * 300);
    const fc = chance(0.8) ? 9230000000000000n + BigInt(Math.floor(random() * 25)) : null;
    t.companion_character_current.push({ cid, name: `Char${i}`, world: pick(['Maduin', 'Behemoth', 'Exodus']), account_label: label,
      gil: Math.floor(random() * 5e9), ceruleum: chance(0.05) ? null : cer, repair_kits: chance(0.05) ? null : kits,
      retainer_count: Math.floor(random() * 10), submarine_count: Math.floor(random() * 5), num_sub_slots: 4, fc_id: fc,
      first_seen_at: ago(5000), last_synced_at: ago(behindHours) });
    if (chance(0.7)) t.character_sort_order.push({ cid, sort_index: Math.floor(random() * 300), updated_at: ago(10) });
    const subs = chance(0.75) ? Math.floor(random() * 5) : 0;
    for (let s = 1; s <= subs; s++) {
      const parts = [0, 1, 2, 3].map(() => (chance(0.05) ? pick([0, 1, null, 30000]) : pick(PARTS)));
      const named = chance(0.6);
      t.companion_submarine_snapshot.push({ cid, sub_name: named ? `Sub ${s}` : `Submersible-${s}`, level: chance(0.1) ? 0 : Math.floor(random() * 125) + 1,
        part1: parts[0], part2: parts[1], part3: parts[2], part4: parts[3],
        return_time: pick([0, null, Math.floor(now - random() * 90000), Math.floor(now + random() * 90000) + 60]),
        updated_at: ago(1), current_exp: Math.floor(random() * 1e6), next_level_exp: chance(0.1) ? null : 1e6, slot: chance(0.3) ? null : s });
    }
    // Supply history: drops, restocks, unchanged hourly values; sometimes the bags-and-retainers totals too.
    const span = Math.floor(random() * 40 * 24);
    const totals = chance(0.5);
    for (let h = span; h >= Math.ceil(behindHours); h--) {
      if (chance(0.3)) cer = Math.max(0, cer - Math.floor(random() * 60));
      if (chance(0.02)) cer += 2000;
      if (chance(0.2)) kits = Math.max(0, kits - Math.floor(random() * 4));
      if (chance(0.3)) t.companion_metric_history.push({ recorded_at: ago(h), subject_type: 'character', subject_id: cid, metric: 'ceruleum', value: cer });
      if (chance(0.3)) t.companion_metric_history.push({ recorded_at: ago(h), subject_type: 'character', subject_id: cid, metric: 'repair_kits', value: kits });
      if (totals && chance(0.25)) t.companion_metric_history.push({ recorded_at: ago(h), subject_type: 'character', subject_id: cid, metric: 'item_qty:10155', value: cer + 100 });
      if (totals && chance(0.25)) t.companion_metric_history.push({ recorded_at: ago(h), subject_type: 'character', subject_id: cid, metric: 'item_qty:10373', value: kits + 7 });
    }
    // As the plugin does at a sync: values recorded at exactly the moment the character last synced.
    if (chance(0.5)) {
      t.companion_metric_history.push({ recorded_at: ago(behindHours), subject_type: 'character', subject_id: cid, metric: 'ceruleum', value: Math.max(0, cer - 25) });
      if (totals) t.companion_metric_history.push({ recorded_at: ago(behindHours), subject_type: 'character', subject_id: cid, metric: 'item_qty:10155', value: cer + 60 });
    }
    if (fc && chance(0.8)) {
      const visited = chance(0.15) ? null : ago(random() * 60 * 24);
      t.companion_character_housing.push({ cid, fc_id: fc, fc_name: chance(0.1) ? null : `FC ${fc % 100n}${chance(0.3) ? ' (renamed)' : ''}`,
        fc_points: chance(0.2) ? null : Math.floor(random() * 1e5), has_house: chance(0.7), house_city: pick([2, 8, 9, 70, 111, 999]),
        house_ward: Math.floor(random() * 30) + 1, house_plot: Math.floor(random() * 60) + 1, house_last_visited: visited, updated_at: ago(random() * 100) });
    }
    if (chance(0.6)) t.companion_character_login.push({ cid, pc_name: pick(['DESKTOP-1', 'LAPTOP']), account_label: label || '', logged_in_at: ago(random() * 48) });
    const retainers = Math.floor(random() * 6);
    for (let r = 0; r < retainers; r++) {
      const id = retainerId++;
      const venture = pick([true, true, false, null]);
      t.companion_retainer_lookup.push({ retainer_id: id, owner_cid: chance(0.03) ? 999n : cid, name: `Ret${i}-${r}`, updated_at: ago(1),
        job: pick([0, 0, 1, 10, 18, 33, null]), gil: chance(0.1) ? null : Math.floor(random() * 1e7), has_venture: venture,
        venture_id: venture ? Math.floor(random() * 800) : null, venture_begins_at: null,
        venture_ends_at: venture ? pick([0, Math.floor(now - random() * 50000), Math.floor(now + random() * 50000) + 60]) : null,
        level: chance(0.1) ? null : Math.floor(random() * 100) + 1, hire_order_index: chance(0.1) ? null : r, items_seen_at: chance(0.4) ? ago(5) : null });
      if (chance(0.5)) {
        for (let slot = 0; slot < 12; slot++) {
          if (chance(0.7)) t.companion_inventory_snapshot.push({ owner_cid: cid, retainer_id: id, sorted_container: chance(0.8) ? 11000 : 10000,
            sorted_slot_index: slot, item_id: chance(0.05) ? null : 40000 + Math.floor(random() * 2000), quantity: 1, updated_at: ago(1) });
        }
      }
      if (chance(0.3)) t.retainer_gear_targets.push({ retainer_id: id, target_mode: pick(['level', 'ilvl', null]), target_value: chance(0.2) ? null : Math.floor(random() * 700) + 1,
        only_crafted: chance(0.5), updated_at: ago(3) });
    }
  }
  for (const [pc, label] of [['DESKTOP-1', 'A'], ['DESKTOP-1', 'B'], ['LAPTOP', ''], ['DESKTOP-2', 'A'], ['OLD', 'C']]) {
    t.companion_pc_status.push({ pc_name: pc, account_label: label, plugin_version: pick(['2.0.0.11', '1.0.3.4', null]),
      last_sync_at: pick([ago(0.05), ago(30), ago(90), null]), autoretainer_ready: pick([true, false, null]), allagantools_ready: pick([true, false, null]),
      fctracker_found: pick([true, false, null]), submarinetracker_found: pick([true, false, null]), venture_stats_found: pick([true, false, null]),
      characters_synced: chance(0.2) ? null : Math.floor(random() * 30), characters_left_out: Math.floor(random() * 3), characters_elsewhere: chance(0.3) ? null : Math.floor(random() * 4),
      problems: pick([[], ['Char1: no FC chest', 'Char2: no retainers'], null, ['One thing']]), check_text: pick([null, 'All good\nNothing to fix']),
      check_to_fix: pick([null, 0, 2]), check_at: pick([null, ago(2)]) });
  }
  return t;
}

const SETTINGS = [
  { low_ceruleum_threshold: 100, low_repair_kit_threshold: 10, supply_window_days: 14, restock_target_days: 14, not_synced_after_minutes: 30, house_warn_days: 7 },
  { low_ceruleum_threshold: 0, low_repair_kit_threshold: 0, supply_window_days: 3, restock_target_days: 30, not_synced_after_minutes: 10, house_warn_days: 1 },
  // Odd values: a threshold with a fraction (the warning text rounds it), a window that isn't a choice (14 instead),
  // a restock with a fraction, a not-synced setting that isn't whole (30 instead), a house warning out of range (7).
  { low_ceruleum_threshold: 2500.5, low_repair_kit_threshold: 150.5, supply_window_days: 5, restock_target_days: 45.5, not_synced_after_minutes: 30.5, house_warn_days: 50 },
  { low_ceruleum_threshold: 900, low_repair_kit_threshold: 90, supply_window_days: 30, restock_target_days: 1, not_synced_after_minutes: 1440, house_warn_days: 44 },
  { low_ceruleum_threshold: 400, supply_window_days: 7, restock_target_days: 90 }, // some unset: their defaults
];

(async () => {
  const admin = new Client();
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${NAME}`);
  // Sorting text like a person would, ignoring spaces and brackets (as GitHub's PostgreSQL does), not letter by letter, so an order that depends on
  // the database's language setting shows up here: PostgreSQL 15 and later can be told to, where ICU is built in.
  try {
    await admin.query(`CREATE DATABASE ${NAME} TEMPLATE template0 LOCALE_PROVIDER icu ICU_LOCALE 'en-US-u-ka-shifted' LOCALE 'C.UTF-8'`);
  } catch {
    await admin.query(`CREATE DATABASE ${NAME}`);
  }
  const pg = new Client({ host: process.env.PGHOST, port: process.env.PGPORT, user: process.env.PGUSER, password: process.env.PGPASSWORD, database: NAME });
  await pg.connect();
  try {
    await pg.query(fs.readFileSync(path.join(DB, 'schema.sql'), 'utf8'));
    await pg.query(fs.readFileSync(path.join(DB, 'views.sql'), 'utf8'));
    const lite = new DatabaseSync(':memory:');
    lite.exec(fs.readFileSync(path.join(DB, 'sqlite', 'tables.sql'), 'utf8'));
    const viewsSql = fs.readFileSync(path.join(DB, 'sqlite', 'views.sql'), 'utf8');
    lite.exec(viewsSql);

    await scenario('SQLite has every view PostgreSQL has, with the same columns', async () => {
      const pgViews = (await pg.query(`SELECT table_name FROM information_schema.views WHERE table_schema = current_schema() AND table_name LIKE 'fleet\\_%' ORDER BY 1`)).rows.map((r) => r.table_name);
      const liteViews = lite.prepare(`SELECT name FROM sqlite_master WHERE type = 'view' AND name LIKE 'fleet\\_%' ESCAPE '\\' ORDER BY 1`).all().map((r) => r.name);
      assert.deepStrictEqual(liteViews, pgViews);
      assert.deepStrictEqual([...VIEWS.map(([v]) => v)].sort(), pgViews, 'and this check compares each of them');
      for (const [view] of VIEWS) {
        const pgCols = (await pg.query(`SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`, [view])).rows.map((r) => r.column_name);
        const liteCols = lite.prepare(`SELECT name FROM pragma_table_info('${view}')`).all().map((r) => r.name);
        assert.deepStrictEqual(liteCols, pgCols, view);
      }
    });

    for (const [round, seed] of [[1, 7], [2, 42], [3, 2026]]) {
      const now = Date.now() / 1000;
      const data = fleet(seed, now);
      for (const table of Object.keys(data)) {
        await pg.query(`TRUNCATE ${table}`);
        lite.exec(`DELETE FROM ${table}`);
        await insert(pg, lite, table, data[table]);
      }
      for (const [i, settings] of SETTINGS.entries()) {
        await scenario(`fleet ${round} (${data.companion_character_current.length} characters, ${data.companion_metric_history.length} history values), settings ${i + 1}: every view the same on both`, async () => {
          await pg.query('TRUNCATE fleet_economics_settings');
          lite.exec('DELETE FROM fleet_economics_settings');
          await insert(pg, lite, 'fleet_economics_settings', Object.entries(settings).map(([setting_key, setting_value]) => ({ setting_key, setting_value })));
          // The same moment on both: PostgreSQL's now() is fixed for a transaction, and SQLite's views are made again
          // with that moment in place of julianday('now').
          await pg.query('BEGIN');
          try {
            const { rows: [{ at }] } = await pg.query('SELECT extract(epoch FROM now())::float8 AS at');
            lite.exec(viewsSql.replaceAll("julianday('now')", `(${at} / 86400.0 + 2440587.5)`));
            const counts = [];
            for (const [view, key] of VIEWS) counts.push(`${view.replace(/^fleet_|_view$/g, '')} ${await compare(pg, lite, view, key)}`);
            console.log(`   rows: ${counts.join(', ')}`);
          } finally {
            await pg.query('COMMIT');
          }
        });
      }
    }
  } finally {
    await pg.end();
    await admin.query(`DROP DATABASE IF EXISTS ${NAME}`);
    await admin.end();
  }
})();
