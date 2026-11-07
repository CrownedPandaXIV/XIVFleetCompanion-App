// The plugin updates the database itself (plugin 2.1.0, DatabaseUpkeep.cs), with a copy of this app's own files:
// db/schema.sql, db/catch-up.sql, db/updates/*.sql and db/views.sql (and db/sqlite/, the one-file version's). This copies them into the plugin and works out,
// with the app's own ensureDatabase, what a database looks like after each way of updating it, for the plugin's
// tests to check its own updating gives exactly the same: every table and column, index, view (its definition) and
// version record.
//   node tests/db/plugin-database-fixture.js ../XIVFleetCompanion
// Needs a scratch Postgres (PGHOST, PGPORT, PGUSER, PGPASSWORD): it makes and drops databases named pdb_*.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client } = require('pg');
const { ensureDatabase } = require('../../db/apply-updates');
const { version: APP_VERSION } = require('../../package.json');

const DB_DIR = path.join(__dirname, '..', '..', 'db');
const plugin = process.argv[2];

// What a database looks like: the same queries run in the plugin's test (copied there through the fixture).
const SIGNATURE = {
  columns: `SELECT table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '') AS v
            FROM information_schema.columns WHERE table_schema = 'public'
              AND table_name NOT IN (SELECT table_name FROM information_schema.views WHERE table_schema = 'public') ORDER BY 1`,
  indexes: `SELECT indexdef AS v FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1`,
  views: `SELECT viewname || ' ' || md5(definition) AS v FROM pg_views WHERE schemaname = 'public' ORDER BY 1`,
  versions: `SELECT version || ' ' || name AS v FROM companion_schema_version ORDER BY version`,
  viewsChecksum: `SELECT checksum AS v FROM companion_views`,
};

// A database from before the app kept a version record, missing what versions 6 to 16 add (as the app's own
// tests/db/verify-database-updates.js makes it): db/catch-up.sql, then the updates.
const SCHEMA = fs.readFileSync(path.join(DB_DIR, 'schema.sql'), 'utf8');
const OLDER = `${SCHEMA}
INSERT INTO companion_submarine_snapshot (cid, sub_name) VALUES (1, 'Submersible-2'), (1, 'Renamed');
INSERT INTO fleet_economics_settings (setting_key, setting_value) VALUES
  ('alert_sync_stale_minutes', 45), ('alert_enabled', 1), ('alert_mention_user_id', 123456789012345678), ('house_warn_days', 30);
DROP TABLE companion_schema_version, companion_pc_status, companion_venture_result, companion_market_listing;
DROP INDEX companion_metric_history_metric_idx;
ALTER TABLE companion_voyage_loot DROP COLUMN leg;
ALTER TABLE companion_retainer_lookup DROP COLUMN items_seen_at;
ALTER TABLE companion_submarine_snapshot DROP COLUMN slot;
ALTER TABLE companion_metric_latest DROP COLUMN label;
DROP TABLE companion_database_move, companion_rankup_forecast, companion_character_login, companion_game_data_check, companion_views;`;

const admin = () => new Client({ database: process.env.PGDATABASE || 'postgres' });
async function dropDatabase(name) {
  const a = admin();
  await a.connect();
  await a.query(`DROP DATABASE IF EXISTS ${name}`);
  await a.end();
}
async function freshDatabase(name) {
  await dropDatabase(name);
  const a = admin();
  await a.connect();
  await a.query(`CREATE DATABASE ${name}`);
  await a.end();
  const c = new Client({ database: name });
  await c.connect();
  return c;
}
async function signature(c) {
  const out = {};
  for (const [key, sql] of Object.entries(SIGNATURE)) {
    try { out[key] = (await c.query(sql)).rows.map((r) => String(r.v)); } catch { out[key] = null; }
  }
  return out;
}
// The updates up to `last` only, as an older app had them.
function updatesUpTo(last) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdb-updates-'));
  for (const f of fs.readdirSync(path.join(DB_DIR, 'updates')).filter((x) => /^\d+_.*\.sql$/.test(x) && Number(x.split('_')[0]) <= last)) {
    fs.copyFileSync(path.join(DB_DIR, 'updates', f), path.join(dir, f));
  }
  return dir;
}

(async () => {
  if (!plugin) throw new Error('Give the plugin folder: node tests/db/plugin-database-fixture.js ../XIVFleetCompanion');
  // The files, copied as they are.
  const target = path.join(plugin, 'XIVFleetCompanion', 'Database');
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.join(target, 'updates'), { recursive: true });
  for (const f of ['schema.sql', 'catch-up.sql', 'views.sql']) fs.copyFileSync(path.join(DB_DIR, f), path.join(target, f));
  for (const f of fs.readdirSync(path.join(DB_DIR, 'updates')).filter((x) => x.endsWith('.sql'))) {
    fs.copyFileSync(path.join(DB_DIR, 'updates', f), path.join(target, 'updates', f));
  }
  // The one-file version's tables and views (Just this PC, SQLite).
  fs.mkdirSync(path.join(target, 'sqlite'), { recursive: true });
  for (const f of ['tables.sql', 'views.sql']) fs.copyFileSync(path.join(DB_DIR, 'sqlite', f), path.join(target, 'sqlite', f));
  // Which app version they're from: what the plugin records as the views' version, so the app and the plugin agree
  // which is newer.
  const appVersion = APP_VERSION.split('-')[0];
  fs.writeFileSync(path.join(target, 'app-version.txt'), `${appVersion}\n`);

  // Each: the SQL that makes the database, then each update in turn (upTo: only the updates up to that number and no
  // views, as an older copy has them; otherwise everything) with what the database looks like after it, then once
  // more (nothing changes).
  const scenarios = {};
  const run = async (name, setup, steps) => {
    const c = await freshDatabase(`pdb_${name}`);
    if (setup) await c.query(setup);
    const done = [];
    for (const step of [...steps, { again: true }]) {
      await ensureDatabase(c, step.upTo
        ? { appVersion: '1.7.0', updatesDir: updatesUpTo(step.upTo), viewsFile: path.join(os.tmpdir(), 'no-views.sql') }
        : { appVersion: APP_VERSION });
      done.push({ ...step, expect: await signature(c) });
    }
    await c.end();
    await dropDatabase(`pdb_${name}`);
    scenarios[name] = { setup, steps: done };
  };
  await run('empty', '', [{}]);
  await run('older', OLDER, [{}]);
  await run('partway', OLDER, [{ upTo: 13 }, {}]);
  const tables = (sc) => JSON.stringify(sc.steps[sc.steps.length - 1].expect.columns.slice().sort());
  for (const [name, sc] of Object.entries(scenarios)) {
    if (tables(sc) !== tables(scenarios.empty)) throw new Error(`${name}: not the same tables as a new database`);
  }

  const out = path.join(plugin, 'tests', 'FleetWriterTests', 'database-fixture.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify({
    about: 'Written by XIVFleetCompanion-App tests/db/plugin-database-fixture.js: the database after the app updates it each way.',
    appVersion,
    signature: SIGNATURE,
    scenarios,
  }, null, 1)}\n`);
  console.log(`Copied the database files to ${target} and wrote ${out}: ${Object.entries(scenarios).map(([k, v]) => {
    const e = v.steps[v.steps.length - 1].expect;
    return `${k}: ${e.columns.length} columns, ${e.views.length} views, versions ${e.versions[0]} to ${e.versions[e.versions.length - 1]}`;
  }).join('; ')}.`);
})().catch((err) => { console.error(err); process.exit(1); });
