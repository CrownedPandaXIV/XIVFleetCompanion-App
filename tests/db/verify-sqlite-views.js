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
  ['fleet_retainer_counts_view', []],
  ['fleet_summary_view', []],
  ['fleet_alerts_view', null], // in the view's own order
  ['fleet_roster_view', ['cid']],
  ['fleet_retainers_view', ['retainer_id']],
  ['fleet_retainer_gear_view', ['retainer_id', 'item_id']],
  ['fleet_pcs_view', ['pc_name', 'account_label']],
  ['fleet_fcs_view', ['fc_id']],
  ['fleet_holdings_view', 'all'], // several stacks can sit in the same place: compared as whole rows
  ['fleet_item_totals_view', ['item_id', 'hq']],
  ['fleet_salvage_view', ['cid']],
  ['fleet_income_view', ['cid']],
  ['fleet_venture_income_view', ['owner_cid', 'item_id']],
  ['fleet_parts_characters_view', ['cid']],
  ['fleet_parts_subs_view', ['cid', 'sub_name']],
  ['fleet_parts_rules_view', ['id']],
  ['fleet_parts_fight_club_view', ['id']],
  ['fleet_parts_spares_view', 'all'],
  ['fleet_market_settings_view', []],
  ['fleet_settings_view', []],
  ['fleet_market_accounts_view', ['account_label']],
  ['fleet_market_listings_view', ['retainer_id', 'slot']],
  ['fleet_route_subs_view', ['cid', 'sub_name']],
  ['fleet_route_fight_club_view', ['id']],
  ['fleet_sub_history_view', 'all'],
  ['fleet_voyage_sectors_view', 'all'],
  ['fleet_voyage_loot_view', 'all'],
  ['fleet_rankup_forecast_view', 'all'],
  ['fleet_rankup_history_view', 'all'],
  ['fleet_voyage_returns_view', 'all'],
  ['fleet_shopping_held_view', ['item_id', 'who', 'place']],
  ['fleet_shopping_progress_view', 'all'],
];

let n = 0;
async function scenario(name, fn) {
  try { await fn(); console.log(`PASS ${++n}. ${name}`); } catch (e) { console.log(`FAIL ${++n}. ${name}\n   ${e.stack}`); process.exitCode = 1; }
}

const { TIMES, BOOLS, LISTS, insert, fleet } = require('./made-up-fleet');

// One value as a comparable plain value: numbers as numbers, times as Unix seconds, booleans as 0/1, intervals as
// seconds.
function plain(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Uint8Array) return `bytes:${Buffer.from(v).toString('hex')}`; // a sub's route stops (bytea, BLOB)
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

// How much to buy is rounded up. When the amount before rounding is within a millionth of a whole number, the two
// databases' arithmetic (PostgreSQL's numeric, SQLite's floating point) can round it either way: a difference of 1
// there is not a difference in the working out. Anything else still has to match.
function roundingTie(view, col, pgRow, liteRow) {
  const m = /^(ceruleum|repair_kits)_restock$/.exec(col);
  if (view !== 'fleet_supplies_view' || !m || Math.abs(pgRow[col] - liteRow[col]) !== 1) return false;
  const exact = pgRow[`${m[1]}_per_day`] * pgRow.target_days - pgRow[m[1]];
  return Math.abs(exact - Math.round(exact)) < 1e-6;
}

async function compare(pg, lite, view, key) {
  const pgRows = (await pg.query(`SELECT * FROM ${view}`)).rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, plain(v)])));
  const stmt = lite.prepare(`SELECT * FROM ${view}`);
  stmt.setReadBigInts(true);
  const liteRows = stmt.all().map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, plain(v)])));
  assert.deepStrictEqual(Object.keys(liteRows[0] || {}).sort(), Object.keys(pgRows[0] || {}).sort(), `${view}: the same columns`);
  assert.strictEqual(liteRows.length, pgRows.length, `${view}: the same number of rows`);
  const whole = (r) => JSON.stringify(Object.keys(r).sort().map((k) => [k, typeof r[k] === 'number' ? Number(r[k].toPrecision(12)) : r[k]]));
  const order = (rows) => (key === 'all' ? [...rows].sort((a, b) => (whole(a) < whole(b) ? -1 : whole(a) > whole(b) ? 1 : 0))
    : key ? [...rows].sort((a, b) => {
      for (const k of key) { if (a[k] < b[k]) return -1; if (a[k] > b[k]) return 1; }
      return 0;
    }) : rows);
  const [p, l] = [order(pgRows), order(liteRows)];
  for (let i = 0; i < p.length; i++) {
    for (const col of Object.keys(p[i])) {
      if (roundingTie(view, col, p[i], l[i])) continue;
      assert.ok(same(p[i][col], l[i][col]),
        `${view} row ${i + 1} (${(Array.isArray(key) ? key : []).map((k) => `${k} ${p[i][k]}`).join(', ') || 'in order'}), ${col}: PostgreSQL ${JSON.stringify(p[i][col])}, SQLite ${JSON.stringify(l[i][col])}`);
    }
  }
  return p.length;
}

const SETTINGS = [
  { low_ceruleum_threshold: 100, low_repair_kit_threshold: 10, supply_window_days: 14, restock_target_days: 14, not_synced_after_minutes: 30, house_warn_days: 7,
    income_window_days: 7, repair_kit_cost: 1730, market_stale_days: 7 },
  { low_ceruleum_threshold: 0, low_repair_kit_threshold: 0, supply_window_days: 3, restock_target_days: 30, not_synced_after_minutes: 10, house_warn_days: 1,
    income_window_days: 3, repair_kit_cost: 0, market_stale_days: 1 },
  // Odd values: a threshold with a fraction (the warning text rounds it), a window that isn't a choice (14 instead),
  // a restock with a fraction, a not-synced setting that isn't whole (30 instead), a house warning out of range (7).
  { low_ceruleum_threshold: 2500.5, low_repair_kit_threshold: 150.5, supply_window_days: 5, restock_target_days: 45.5, not_synced_after_minutes: 30.5, house_warn_days: 50,
    income_window_days: 5, repair_kit_cost: 1999.5, market_stale_days: 2.5 },
  { low_ceruleum_threshold: 900, low_repair_kit_threshold: 90, supply_window_days: 30, restock_target_days: 1, not_synced_after_minutes: 1440, house_warn_days: 44,
    income_window_days: 30, repair_kit_cost: 2500, market_stale_days: 90 },
  { low_ceruleum_threshold: 400, supply_window_days: 7, restock_target_days: 90, income_window_days: 14 }, // some unset: their defaults
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
            // As plain seconds: passing it through a Julian day (as julianday('now') is) would round it by up to 40
            // microseconds, enough to tip a rounded-up amount over a whole number now and then.
            lite.exec(viewsSql.replaceAll("((julianday('now') - 2440587.5) * 86400.0)", `(${at})`));
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
