// The app's edits, for the plugin's in-game edits to be checked against (plugin 2.0 "ticking things off" stage: Sub
// Rules, Craft?, gear targets, the Roster order, Gil & Market's unsold days, the Income window, removing a PC and the
// Shopping List's ticks, made from the game). It fills a scratch database, makes a list of edits through the app's own
// calls (as the window makes them), and writes the starting rows, each edit, the app's answer and the edited tables
// after it to one file:
//
//   node tests/db/edits-fixture.js ../XIVFleetCompanion/tests/FleetWriterTests/edits-fixture.json
//
// The plugin's tests make the same database (db/schema.sql, included), make the same edits their own way and compare.
// Set PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE for a scratch server, as its administrator: it makes and drops a
// database named fleet_edits_check.
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const Module = require('module');

const handlers = new Map();
const original = Module._load;
Module._load = function load(request, ...rest) {
  if (request === 'electron') return { ipcMain: { handle(name, fn) { handlers.set(name, fn); } }, app: { getPath: () => '.', getVersion: () => '0' }, safeStorage: {}, BrowserWindow: { getAllWindows: () => [] } };
  return original.call(this, request, ...rest);
};
const NAME = 'fleet_edits_check';
const db = require('../../db');
let shared = null;
// The app's calls work on this script's database (withClient as the app's: an error is answered, not thrown).
db.withClient = async (work, onError) => { try { return await work(shared); } catch (err) { return onError(err, shared); } };
require('../../ipc/parts');
require('../../ipc/subs');
require('../../ipc/retainers');
require('../../ipc/roster');
require('../../ipc/details');
require('../../ipc/income');
require('../../ipc/shopping');
require('../../ipc/settings');
require('../../ipc/universalis');
require('../../ipc/supplies');
const { loadPlayStyle } = require('../../ipc/play-style');
Module._load = original;

const DB = path.join(__dirname, '..', '..', 'db');

// The tables the edits change, each read the same way on both sides (updated_at left out; the Shopping List's ticks
// read as JSON, as either side may write them in its own order).
const TABLES = {
  sub_build_rules: 'SELECT id, rank, cid_override::text AS cid_override, sub_filter, hull, stern, bow, bridge FROM sub_build_rules ORDER BY id',
  sub_craft_toggle: 'SELECT cid::text AS cid, sub_name, craft_enabled FROM sub_craft_toggle ORDER BY cid, sub_name COLLATE "C"',
  retainer_gear_targets: 'SELECT retainer_id::text AS retainer_id, target_mode, target_value, only_crafted FROM retainer_gear_targets ORDER BY retainer_id',
  character_sort_order: 'SELECT cid::text AS cid, sort_index FROM character_sort_order ORDER BY cid',
  fleet_economics_settings: 'SELECT setting_key, setting_value::text AS setting_value FROM fleet_economics_settings ORDER BY setting_key COLLATE "C"',
  tier3_settings: `SELECT setting_key, CASE WHEN setting_key = 'shopping_progress' THEN setting_value::jsonb::text ELSE setting_value END AS setting_value
                   FROM tier3_settings ORDER BY setting_key COLLATE "C"`,
  companion_pc_status: 'SELECT pc_name, account_label, plugin_version FROM companion_pc_status ORDER BY pc_name COLLATE "C", account_label COLLATE "C"',
};

// The starting rows: three characters, their retainers, two Sub Rules, a Craft? setting, a gear target, part of a
// Roster order, the settings and two PCs, and some Shopping List ticks.
const SEED = `
  INSERT INTO companion_character_current (cid, name, world, account_label, gil, ceruleum, repair_kits, retainer_count, submarine_count, num_sub_slots, first_seen_at, last_synced_at)
    VALUES (18014498578000001, 'Ann', 'Maduin', 'A', 0, 0, 0, 2, 2, 4, now(), now()),
           (18014498578000002, 'Bo', 'Golem', 'A', 0, 0, 0, 1, 1, 4, now(), now()),
           (18014498578000003, 'Cy', 'Siren', 'B', 0, 0, 0, 0, 0, 4, now(), now());
  INSERT INTO companion_retainer_lookup (retainer_id, owner_cid, name) VALUES (33777097243660301, 18014498578000001, 'Amy'),
    (33777097243660302, 18014498578000001, 'Bea'), (33777097243660303, 18014498578000002, 'Cat');
  INSERT INTO sub_build_rules (rank, cid_override, sub_filter, hull, stern, bow, bridge) VALUES (1, NULL, '', 'S', 'S', 'S', 'S'),
    (85, 18014498578000002, 'Sub1,Sub3', 'W', 'U', 'C', 'Y+');
  INSERT INTO sub_craft_toggle (cid, sub_name, craft_enabled) VALUES (18014498578000001, 'Submersible-1', true);
  INSERT INTO retainer_gear_targets (retainer_id, target_mode, target_value, only_crafted) VALUES (33777097243660302, 'ilvl', 560, true);
  INSERT INTO character_sort_order (cid, sort_index) VALUES (18014498578000002, 0), (18014498578000001, 1);
  INSERT INTO fleet_economics_settings (setting_key, setting_value) VALUES ('market_stale_days', 7), ('income_window_days', 7);
  INSERT INTO tier3_settings (setting_key, setting_value) VALUES ('shopping_progress', '{"24348":{"made":1,"outOf":3},"21794":{"made":2,"outOf":2,"ahead":7}}');
  INSERT INTO companion_pc_status (pc_name, account_label, plugin_version) VALUES ('DESKTOP-1', 'A', '2.0.0'), ('LAPTOP', '', '1.0.3'), ('LAPTOP', 'B', '2.0.0');
`;

// The edits, in order, as the window makes them (tests/db/edits-list.js).
const { EDITS } = require('./edits-list');

async function tables(client) {
  const out = {};
  for (const [name, sql] of Object.entries(TABLES)) out[name] = (await client.query(sql)).rows;
  return out;
}

(async () => {
  const out = process.argv[2];
  const admin = new Client();
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${NAME}`);
  await admin.query(`CREATE DATABASE ${NAME}`);
  const client = new Client({ host: process.env.PGHOST, port: process.env.PGPORT, user: process.env.PGUSER, password: process.env.PGPASSWORD, database: NAME });
  await client.connect();
  shared = client;
  try {
    const schema = fs.readFileSync(path.join(DB, 'schema.sql'), 'utf8');
    await client.query(schema);
    await client.query(SEED);
    const start = await tables(client);
    const edits = [];
    for (const [call, ...args] of EDITS) {
      const answer = await handlers.get(call)(null, ...args);
      edits.push({ call, args, answer, after: await tables(client) });
      console.log(`${call} ${JSON.stringify(args)}: ${JSON.stringify(answer)}`);
    }
    // What the app's Settings shows after them (the plugin reads the same through fleet_settings_view).
    const views = fs.readFileSync(path.join(DB, 'views.sql'), 'utf8');
    await client.query(views);
    await client.query(`INSERT INTO companion_submarine_snapshot (cid, sub_name, level) VALUES (18014498578000001, 'Sub1', 50), (18014498578000002, 'Sub1', 0)`);
    await client.query(`UPDATE companion_retainer_lookup SET job = 3 WHERE retainer_id = 33777097243660301`);
    const warnings = await handlers.get('settings:get-low-thresholds')();
    const play = await loadPlayStyle(client);
    const settings = {
      repairKitThreshold: warnings.repairKitThreshold, ceruleumThreshold: warnings.ceruleumThreshold, houseWarnDays: warnings.houseWarnDays,
      notSyncedMinutes: warnings.notSyncedMinutes, repairKitCost: (await handlers.get('settings:get-repair-kit-cost')()).value,
      livePrices: (await handlers.get('get-universalis-setting')()).enabled, playChoice: play.choice, playStyle: play.style, subs: play.counts.subs, retainers: play.counts.retainers,
    };
    console.log(`settings after: ${JSON.stringify(settings)}`);
    if (out) {
      fs.writeFileSync(out, `${JSON.stringify({
        about: 'Written by XIVFleetCompanion-App tests/db/edits-fixture.js: the app\'s edits, their answers and the tables after each.',
        schema, seed: SEED, tables: TABLES, start, edits, views, settings,
      })}\n`);
      console.log(`written to ${out}`);
    }
  } finally {
    await client.end();
    await admin.query(`DROP DATABASE IF EXISTS ${NAME}`);
    await admin.end();
  }
})().catch((e) => { console.error(e); process.exit(1); });
