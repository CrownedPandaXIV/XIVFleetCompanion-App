// The Parts tab's answers for made-up fleets, for the plugin's own working out to be checked against (plugin 2.0
// batch 4: the plugin works parts out itself, from the fleet_parts_* views, the same way as ipc/parts.js
// computePartsNeeded). For each fleet it writes the views' rows (what the plugin reads) and the app's answers (what
// the plugin must give) to one file:
//
//   node tests/db/parts-fixture.js ../XIVFleetCompanion/tests/FleetWriterTests/parts-fixture.json
//
// Without a file it only checks that every case works out. Hand-made cases first (a shared FC chest, parts freed by
// upgrades, a new workshop, Sub Rules for one character or some slots, Fight Club builds for subs ticked Craft?),
// then random fleets. Set PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE for a scratch server, as its administrator:
// it makes and drops a database named fleet_parts_check.
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const Module = require('module');

// ipc/parts.js registers its calls with Electron when loaded: stood in for, as in verify-fleet-views.js.
const original = Module._load;
Module._load = function load(request, ...rest) {
  if (request === 'electron') return { ipcMain: { handle() {} }, app: { getPath: () => '.', getVersion: () => '0' }, safeStorage: {}, BrowserWindow: { getAllWindows: () => [] } };
  return original.call(this, request, ...rest);
};
const { computePartsNeeded } = require('../../ipc/parts');
Module._load = original;

const NAME = 'fleet_parts_check';
const DB = path.join(__dirname, '..', '..', 'db');
const VIEWS = {
  characters: 'SELECT * FROM fleet_parts_characters_view ORDER BY cid',
  subs: 'SELECT * FROM fleet_parts_subs_view ORDER BY cid, sub_name COLLATE "C"',
  rules: 'SELECT * FROM fleet_parts_rules_view ORDER BY id',
  fightClub: 'SELECT * FROM fleet_parts_fight_club_view ORDER BY id',
  spares: 'SELECT * FROM fleet_parts_spares_view ORDER BY cid, is_retainer, retainer_id, fc_id, sorted_container, sorted_slot_index',
};

// Whole numbers as text when JavaScript's numbers can't hold them exactly (character ids), numbers otherwise.
function plain(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' && /^-?\d+$/.test(v)) return Number.isSafeInteger(Number(v)) ? Number(v) : v;
  if (typeof v === 'string' && /^-?\d+\.\d+$/.test(v)) return Number(v);
  return v;
}
const row = (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, plain(v)]));

const TABLES = ['companion_character_current', 'character_sort_order', 'companion_character_housing', 'companion_submarine_snapshot',
  'sub_craft_toggle', 'sub_build_rules', 'fight_club_routes', 'companion_inventory_snapshot', 'companion_retainer_lookup',
  'companion_fc_inventory_snapshot', 'fleet_economics_settings'];

async function insert(client, table, rows) {
  for (const r of rows) {
    const cols = Object.keys(r);
    await client.query(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
      cols.map((c) => (typeof r[c] === 'bigint' ? r[c].toString() : r[c])));
  }
}

const S = { hull: 21794, stern: 21795, bow: 21792, bridge: 21793 }; // Shark parts (base + 2, 3, 0, 1)
const part = (base, slot) => base + { bow: 0, bridge: 1, hull: 2, stern: 3 }[slot];
const BASE = { S: 21792, U: 21796, W: 22526, C: 23903, Y: 24344, 'S+': 24348, 'U+': 24352, 'W+': 24356, 'C+': 24360, 'Y+': 24364 };
// A sub's four parts from letters: "S-U-W-C" is hull Shark, stern Unkiu, bow Whale, bridge Coelacanth.
const build = (letters) => {
  const [h, st, b, br] = letters.split('-');
  return { part1: part(BASE[h], 'hull'), part2: part(BASE[st], 'stern'), part3: part(BASE[b], 'bow'), part4: part(BASE[br], 'bridge') };
};
const character = (cid, name, extra = {}) => ({ cid, name, world: 'Maduin', account_label: 'A', gil: 0, ceruleum: 0, repair_kits: 0,
  retainer_count: 0, submarine_count: 0, num_sub_slots: 4, fc_id: null, first_seen_at: new Date(), last_synced_at: new Date(), ...extra });

// Hand-made fleets: each a name and the rows of each table.
const HAND = [
  {
    name: 'rules by rank, one character, some slots; spares in bags, retainers and a shared FC chest; freed parts reused',
    tables: {
      companion_character_current: [character(1, 'Aki', { fc_id: 77 }), character(2, 'Bex', { fc_id: 77 }), character(3, 'Cal', { num_sub_slots: 2 })],
      character_sort_order: [{ cid: 1, sort_index: 2 }, { cid: 2, sort_index: 1 }],
      companion_submarine_snapshot: [
        { cid: 1, sub_name: 'Submersible-1', level: 50, ...build('S-S-S-S'), slot: 1 },
        { cid: 1, sub_name: 'Old Faithful', level: 92, ...build('W-U-S-C'), slot: 2 },
        { cid: 1, sub_name: 'Submersible-3', level: 10, ...build('S-S-S-S'), slot: null },
        { cid: 2, sub_name: 'Submersible-1', level: 91, ...build('S-S-U-C'), slot: 1 },
        { cid: 3, sub_name: 'Submersible-1', level: 60, ...build('S-S-S-S'), slot: 1 },
      ],
      sub_build_rules: [
        { id: 1, rank: 1, sub_filter: 'All', hull: 'S', stern: 'S', bow: 'S', bridge: 'S' },
        { id: 2, rank: 45, sub_filter: '', hull: 'S', stern: 'S', bow: 'U', bridge: 'C' },
        { id: 3, rank: 90, sub_filter: 'Sub1,Sub2', hull: 'W', stern: 'U', bow: 'S', bridge: 'C' },
        { id: 4, rank: 90, cid_override: 2, sub_filter: 'Sub1Only', hull: 'S+', stern: 'S+', bow: 'U+', bridge: 'C+' },
        { id: 5, rank: 55, cid_override: 3, sub_filter: 'All', hull: '', stern: null, bow: 'W', bridge: ' ' },
      ],
      companion_retainer_lookup: [{ retainer_id: 501, owner_cid: 1, name: 'Ret One', updated_at: new Date() }, { retainer_id: 502, owner_cid: 1, name: '', updated_at: new Date() }],
      companion_inventory_snapshot: [
        { owner_cid: 1, retainer_id: 1, sorted_container: 2, sorted_slot_index: 4, item_id: part(BASE.U, 'bow'), quantity: 1 },
        { owner_cid: 1, retainer_id: 501, sorted_container: 10001, sorted_slot_index: 0, item_id: part(BASE.C, 'bridge'), quantity: 1 },
        { owner_cid: 1, retainer_id: 502, sorted_container: 10000, sorted_slot_index: 0, item_id: part(BASE.U, 'bow'), quantity: 2 },
        { owner_cid: 1, retainer_id: 1, sorted_container: 4000, sorted_slot_index: 0, item_id: part(BASE.U, 'bow'), quantity: 5 },
        { owner_cid: 1, retainer_id: 1, sorted_container: 0, sorted_slot_index: 1, item_id: part(BASE.C, 'bridge'), quantity: 0 },
      ],
      companion_fc_inventory_snapshot: [
        { fc_id: 77, sorted_container: 20001, sorted_slot_index: 3, item_id: part(BASE['S+'], 'hull'), quantity: 1 },
        { fc_id: 77, sorted_container: 20000, sorted_slot_index: 0, item_id: part(BASE.C, 'bridge'), quantity: 1 },
        { fc_id: 88, sorted_container: 20000, sorted_slot_index: 0, item_id: part(BASE.W, 'bow'), quantity: 9 },
      ],
    },
  },
  {
    name: 'a house but no workshop yet, a workshop with empty slots, unknown parts, a rule the app does not understand',
    tables: {
      companion_character_current: [character(10, 'Dee', { num_sub_slots: 0, fc_id: 5 }), character(11, 'Eve', { num_sub_slots: 3 }),
        character(12, 'Fay', { num_sub_slots: 0 })],
      companion_character_housing: [{ cid: 10, fc_id: 5, has_house: true, updated_at: new Date() }, { cid: 12, has_house: false, updated_at: new Date() }],
      companion_submarine_snapshot: [
        { cid: 11, sub_name: 'Submersible-1', level: 3, part1: 30000, part2: null, part3: part(BASE.S, 'bow'), part4: part(BASE.S, 'bridge'), slot: 1 },
        { cid: 11, sub_name: 'Submersible-2', level: 0, ...build('S-S-S-S'), slot: 2 },
      ],
      sub_build_rules: [
        { id: 1, rank: 1, sub_filter: null, hull: 'S', stern: 'S', bow: 'S', bridge: 'S' },
        { id: 2, rank: 1, sub_filter: 'nonsense', hull: 'Y', stern: 'Y', bow: 'Y', bridge: 'Y' },
        { id: 3, rank: 2, sub_filter: 'Sub1', hull: 'X', stern: 'S', bow: 'S', bridge: 'S' },
      ],
      companion_fc_inventory_snapshot: [{ fc_id: 5, sorted_container: 20002, sorted_slot_index: 0, item_id: part(BASE.S, 'hull'), quantity: 1 }],
    },
  },
  {
    name: 'Fight Club builds for subs ticked Craft? from rank 85, after repair kits',
    tables: {
      companion_character_current: [character(20, 'Gus')],
      companion_submarine_snapshot: [
        { cid: 20, sub_name: 'Submersible-1', level: 84, ...build('S-S-U-C'), slot: 1 },
        { cid: 20, sub_name: 'Submersible-2', level: 95, ...build('S-S-U-C'), slot: 2 },
        { cid: 20, sub_name: 'Submersible-3', level: 110, ...build('S-S-U-C'), slot: 3 },
        { cid: 20, sub_name: 'Submersible-4', level: 100, ...build('W-U-S-C'), slot: 4 },
      ],
      sub_craft_toggle: [{ cid: 20, sub_name: 'Submersible-1', craft_enabled: true }, { cid: 20, sub_name: 'Submersible-2', craft_enabled: true },
        { cid: 20, sub_name: 'Submersible-3', craft_enabled: true }, { cid: 20, sub_name: 'Submersible-4', craft_enabled: false }],
      sub_build_rules: [{ id: 1, rank: 1, sub_filter: 'All', hull: 'S', stern: 'S', bow: 'U', bridge: 'C' }],
      fight_club_routes: [
        { id: 1, route: 'OJ', hours: 24, repair_times: '6', gil_sub_day: 100000, rec_build_notes: '90: WUSS' },
        { id: 2, route: 'MROJZ', hours: 36.5, repair_times: '3 (2)', gil_sub_day: 140000, rec_build_notes: '105: SSUC++' },
        { id: 3, route: 'JORZ', hours: null, repair_times: null, gil_sub_day: 100000, rec_build_notes: '90: S+S+U+C+' },
        { id: 4, route: 'MOVZ', hours: 24, repair_times: '4', gil_sub_day: null, rec_build_notes: 'none' },
      ],
      fleet_economics_settings: [{ setting_key: 'repair_kit_cost', setting_value: 1730 }],
    },
  },
];

// A random fleet, from a seed (mulberry32, as verify-sqlite-views.js).
function randomFleet(seed) {
  const random = () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const pick = (list) => list[Math.floor(random() * list.length)];
  const chance = (p) => random() < p;
  const LETTERS = Object.keys(BASE);
  const t = Object.fromEntries(TABLES.map((name) => [name, []]));
  let retainerId = 33777097243660300n;
  for (let i = 0; i < 30; i++) {
    const cid = 18014498578000000n + BigInt(i);
    const fc = chance(0.8) ? 9232379236109516800n + BigInt(Math.floor(random() * 15)) : null;
    t.companion_character_current.push(character(cid, `Char${i}`, { fc_id: fc, num_sub_slots: pick([0, 1, 2, 3, 4, 4, 4]), world: pick(['Maduin', 'Golem']),
      account_label: pick(['A', 'B', null]) }));
    if (chance(0.7)) t.character_sort_order.push({ cid, sort_index: Math.floor(random() * 100) });
    if (fc && chance(0.7)) t.companion_character_housing.push({ cid, fc_id: fc, has_house: chance(0.6), updated_at: new Date() });
    const subs = Math.floor(random() * 5);
    for (let s = 1; s <= subs; s++) {
      const named = chance(0.3);
      const parts = [0, 1, 2, 3].map((k) => (chance(0.04) ? pick([null, 30000]) : part(BASE[pick(LETTERS)], ['hull', 'stern', 'bow', 'bridge'][k])));
      t.companion_submarine_snapshot.push({ cid, sub_name: named ? `Sub ${s}` : `Submersible-${s}`, level: chance(0.08) ? 0 : Math.floor(random() * 125) + 1,
        part1: parts[0], part2: parts[1], part3: parts[2], part4: parts[3], slot: chance(0.2) ? null : s });
      if (chance(0.4)) t.sub_craft_toggle.push({ cid, sub_name: named ? `Sub ${s}` : `Submersible-${s}`, craft_enabled: chance(0.6) });
    }
    for (let k = 0; k < 6; k++) {
      if (chance(0.5)) t.companion_inventory_snapshot.push({ owner_cid: cid, retainer_id: cid, sorted_container: pick([0, 1, 2, 3, 4000, 2000]), sorted_slot_index: k,
        item_id: part(BASE[pick(LETTERS)], pick(['hull', 'stern', 'bow', 'bridge'])), quantity: pick([0, 1, 1, 2, 5]) });
    }
    for (let r = 0; r < Math.floor(random() * 3); r++) {
      const id = retainerId++;
      t.companion_retainer_lookup.push({ retainer_id: id, owner_cid: cid, name: chance(0.1) ? '' : `Ret${i}-${r}`, updated_at: new Date() });
      for (let k = 0; k < 4; k++) {
        if (chance(0.4)) t.companion_inventory_snapshot.push({ owner_cid: cid, retainer_id: id, sorted_container: pick([10000, 10002, 10004, 10006, 11000]), sorted_slot_index: k,
          item_id: part(BASE[pick(LETTERS)], pick(['hull', 'stern', 'bow', 'bridge'])), quantity: pick([1, 1, 3]) });
      }
    }
  }
  for (let f = 0; f < 15; f++) {
    for (let k = 0; k < 5; k++) {
      if (chance(0.5)) t.companion_fc_inventory_snapshot.push({ fc_id: 9232379236109516800n + BigInt(f), sorted_container: pick([20000, 20001, 20002, 20003, 20004]),
        sorted_slot_index: k, item_id: part(BASE[pick(LETTERS)], pick(['hull', 'stern', 'bow', 'bridge'])), quantity: pick([1, 1, 2, 4]) });
    }
  }
  for (let r = 1; r <= 10; r++) {
    const letter = () => pick([...LETTERS, '', null, ' S ']);
    t.sub_build_rules.push({ id: r, rank: pick([1, 1, 30, 45, 70, 85, 90, 100, 110]), cid_override: chance(0.15) ? 18014498578000000n + BigInt(Math.floor(random() * 30)) : null,
      sub_filter: pick(['', 'All', 'all', null, 'Sub1Only', 'Sub2,Sub4', 'Sub3', 'Sub1, Sub3', 'nonsense']), hull: letter(), stern: letter(), bow: letter(), bridge: letter() });
  }
  for (let r = 1; r <= 8; r++) {
    t.fight_club_routes.push({ id: r, route: pick(['MROJZ', 'OJ', 'JORZ']), hours: pick([24, 36.5, null]), repair_times: pick(['4', '6 (3)', null, 'x']),
      gil_sub_day: chance(0.1) ? null : Math.floor(random() * 300000), rec_build_notes: pick(['90: SSUC', '95: WUSS++', '100: S+S+U+C+', '88: YYYY', 'none', '']) });
  }
  if (chance(0.7)) t.fleet_economics_settings.push({ setting_key: 'repair_kit_cost', setting_value: pick([0, 1730, 2500.5]) });
  return t;
}

(async () => {
  const out = process.argv[2];
  const admin = new Client();
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${NAME}`);
  await admin.query(`CREATE DATABASE ${NAME}`);
  const client = new Client({ host: process.env.PGHOST, port: process.env.PGPORT, user: process.env.PGUSER, password: process.env.PGPASSWORD, database: NAME });
  await client.connect();
  const cases = [];
  try {
    await client.query(fs.readFileSync(path.join(DB, 'schema.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(DB, 'views.sql'), 'utf8'));
    const fleets = [...HAND, ...[11, 2026, 4242].map((seed) => ({ name: `random fleet ${seed}`, tables: randomFleet(seed) }))];
    for (const fleet of fleets) {
      for (const table of TABLES) await client.query(`TRUNCATE ${table}`);
      for (const [table, rows] of Object.entries(fleet.tables)) await insert(client, table, rows);
      const inputs = {};
      for (const [key, sql] of Object.entries(VIEWS)) inputs[key] = (await client.query(sql)).rows.map(row);
      const expected = (await computePartsNeeded(client)).map((r) => row({
        cid: String(r.cid), character_name: r.character_name, world: r.world, account_label: r.account_label, sort_index: r.sort_index,
        sub_name: r.sub_name, rank: r.rank, slot: r.slot, needed_class: r.needed_class, needed_modified: r.needed_modified,
        spare_location: r.spare_location, recycled_from: r.recycled_from,
      }));
      // Character ids as text throughout, so the plugin reads every case the same way.
      for (const r of [...inputs.characters, ...inputs.subs]) r.cid = String(r.cid);
      for (const r of inputs.spares) { if (r.cid !== null) r.cid = String(r.cid); if (r.retainer_id !== null) r.retainer_id = String(r.retainer_id); }
      for (const r of inputs.rules) if (r.cid_override !== null) r.cid_override = String(r.cid_override);
      for (const r of expected) r.cid = String(r.cid);
      const crafted = expected.filter((r) => !r.spare_location).length;
      console.log(`${fleet.name}: ${expected.length} parts needed, ${crafted} to craft, ${expected.filter((r) => r.recycled_from).length} reused`);
      cases.push({ name: fleet.name, inputs, expected });
    }
    if (out) {
      fs.writeFileSync(out, `${JSON.stringify({ about: 'Written by XIVFleetCompanion-App tests/db/parts-fixture.js: the fleet_parts_* views and the app\'s Parts answers for made-up fleets.', cases })}\n`);
      console.log(`written to ${out}`);
    }
  } finally {
    await client.end();
    await admin.query(`DROP DATABASE IF EXISTS ${NAME}`);
    await admin.end();
  }
})().catch((e) => { console.error(e); process.exit(1); });
