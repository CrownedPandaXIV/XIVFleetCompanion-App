// The Subs tab's route answers for made-up fleets, for the plugin's own working out to be checked against (plugin 2.0
// routes stage: the plugin works out each sub's route, gil a day, speed and range, rank-up dates and next build itself,
// from the fleet_route_* views and the game's own files, the same way as ipc/subs.js loadSubmarinesWithRankUps). For
// each fleet it writes the views' rows and the game data (what the plugin reads) and the app's answers (what the
// plugin must give) to one file:
//
//   node tests/db/routes-fixture.js ../XIVFleetCompanion/tests/FleetWriterTests/routes-fixture.json
//
// Without a file it only checks that every case works out. Made-up game data (four maps of sectors, a rank table, the
// parts' speed and range) stands in for the game's; the plugin's tests hand the same to its working out. Set PGHOST,
// PGPORT, PGUSER, PGPASSWORD, PGDATABASE for a scratch server, as its administrator: it makes and drops a database
// named fleet_routes_check.
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const Module = require('module');

// ipc/subs.js registers its calls with Electron when loaded: stood in for, as in parts-fixture.js.
const original = Module._load;
Module._load = function load(request, ...rest) {
  if (request === 'electron') return { ipcMain: { handle() {} }, app: { getPath: () => '.', getVersion: () => '0' }, safeStorage: {}, BrowserWindow: { getAllWindows: () => [] } };
  return original.call(this, request, ...rest);
};
const { loadSubmarinesWithRankUps } = require('../../ipc/subs');
const { computePartsNeeded } = require('../../ipc/parts');
Module._load = original;

const NAME = 'fleet_routes_check';
const DB = path.join(__dirname, '..', '..', 'db');
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const VIEWS = {
  characters: 'SELECT * FROM fleet_parts_characters_view ORDER BY cid',
  subs: 'SELECT * FROM fleet_route_subs_view ORDER BY cid, sub_name COLLATE "C"',
  rules: 'SELECT * FROM fleet_parts_rules_view ORDER BY id',
  fightClub: 'SELECT * FROM fleet_route_fight_club_view ORDER BY id',
  history: 'SELECT * FROM fleet_sub_history_view ORDER BY cid, metric, recorded_at',
  voyages: 'SELECT * FROM fleet_voyage_sectors_view ORDER BY fc_id, sub_register, returned_at, sector',
  // For Look ahead on the Parts page: the Parts views too.
  partsSubs: 'SELECT * FROM fleet_parts_subs_view ORDER BY cid, sub_name COLLATE "C"',
  partsFightClub: 'SELECT * FROM fleet_parts_fight_club_view ORDER BY id',
  spares: 'SELECT * FROM fleet_parts_spares_view ORDER BY cid, is_retainer, retainer_id, fc_id, sorted_container, sorted_slot_index',
};

// Whole numbers as text when JavaScript's numbers can't hold them exactly (character ids), numbers otherwise; times
// in milliseconds; a sub's route stops as a list of numbers.
function plain(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.getTime();
  if (Buffer.isBuffer(v)) return [...v];
  if (typeof v === 'string' && /^-?\d+$/.test(v)) return Number.isSafeInteger(Number(v)) ? Number(v) : v;
  if (typeof v === 'string' && /^-?\d+\.\d+$/.test(v)) return Number(v);
  return v;
}
const row = (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, plain(v)]));

const TABLES = ['companion_character_current', 'character_sort_order', 'companion_submarine_snapshot', 'sub_craft_toggle', 'sub_build_rules',
  'fight_club_routes', 'fleet_economics_settings', 'companion_metric_history', 'companion_voyage_loot', 'companion_inventory_snapshot',
  'companion_fc_inventory_snapshot'];

async function insert(client, table, rows) {
  for (let start = 0; start < rows.length; start += 500) {
    const batch = rows.slice(start, start + 500);
    const cols = Object.keys(batch[0]);
    const values = [];
    const tuples = batch.map((r) => `(${cols.map((c) => { values.push(typeof r[c] === 'bigint' ? r[c].toString() : r[c]); return `$${values.length}`; }).join(', ')})`);
    await client.query(`INSERT INTO ${table} (${cols.join(', ')}) VALUES ${tuples.join(', ')}`, values);
  }
}

// mulberry32, as verify-sqlite-views.js.
function randomFrom(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// Made-up game data: four maps, each a starting point and 30 sectors lettered A to Z then AA to AD (as the game's
// later maps go past Z); ranks 1 to 125, the last with no experience to the next; each part's speed and range.
function gameData() {
  const random = randomFrom(99);
  const sectors = [];
  const letters = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''), 'AA', 'AB', 'AC', 'AD'];
  for (let m = 1; m <= 4; m++) {
    const first = (m - 1) * 31 + 1;
    sectors.push({ id: first - 1 + (m === 1 ? 0 : 0), location: '', map: m, x: 0, y: 0, z: 0, expReward: 0, surveyMinutes: 0, starting: true });
    for (let k = 0; k < 30; k++) {
      sectors.push({ id: first + k, location: letters[k], map: m, x: Math.floor(random() * 2000) - 1000, y: Math.floor(random() * 2000) - 1000,
        z: Math.floor(random() * 400) - 200, expReward: 1000 + Math.floor(random() * 40000), surveyMinutes: 10 + Math.floor(random() * 90), starting: false });
    }
  }
  // Starting points sit at 0, 31, 62 and 93: the sectors after each belong to it.
  for (const s of sectors) if (s.starting) s.id = (s.map - 1) * 31;
  const maps = [{ id: 1, name: 'Deep-sea Site' }, { id: 2, name: 'Sea of Ash' }, { id: 3, name: 'Sea of Jade' }, { id: 4, name: 'Sirensong Sea' }];
  const ranks = [];
  for (let r = 1; r <= 125; r++) ranks.push({ id: r, speed: 10 + Math.floor(r / 2), range: 5 + Math.floor(r / 3), expToNext: r < 125 ? 5000 + r * 4000 : 0 });
  const parts = [];
  for (let cl = 1; cl <= 10; cl++) for (let sl = 0; sl <= 3; sl++) parts.push({ class: cl, slot: sl, speed: Math.floor(random() * 30) - 5, range: Math.floor(random() * 20) });
  return { sectors, maps, ranks, parts };
}

async function writeGameData(client, game) {
  await client.query(`DROP TABLE IF EXISTS ffxiv_submarineexploration, ffxiv_submarinemap, ffxiv_submarinerank, ffxiv_submarinepart`);
  await client.query(`CREATE TABLE ffxiv_submarineexploration (id text, location text, exp_reward text, survey_durationmin text, x text, y text, z text,
    starting_point text, map text)`);
  await client.query('CREATE TABLE ffxiv_submarinemap (id text, name text)');
  await client.query('CREATE TABLE ffxiv_submarinerank (id text, speed_bonus text, range_bonus text, exp_to_next text)');
  await client.query('CREATE TABLE ffxiv_submarinepart (id text, "class" text, slot text, speed text, range text)');
  await insert(client, 'ffxiv_submarineexploration', game.sectors.map((s) => ({ id: String(s.id), location: s.location, exp_reward: String(s.expReward),
    survey_durationmin: String(s.surveyMinutes), x: String(s.x), y: String(s.y), z: String(s.z), starting_point: s.starting ? 'True' : 'False', map: String(s.map) })));
  await insert(client, 'ffxiv_submarinemap', game.maps.map((m) => ({ id: String(m.id), name: m.name })));
  await insert(client, 'ffxiv_submarinerank', game.ranks.map((r) => ({ id: String(r.id), speed_bonus: String(r.speed), range_bonus: String(r.range), exp_to_next: String(r.expToNext) })));
  await insert(client, 'ffxiv_submarinepart', game.parts.map((p, i) => ({ id: String(i + 1), class: String(p.class), slot: String(p.slot), speed: String(p.speed), range: String(p.range) })));
}

const BASE = { S: 21792, U: 21796, W: 22526, C: 23903, Y: 24344, 'S+': 24348, 'U+': 24352, 'W+': 24356, 'C+': 24360, 'Y+': 24364 };
const SLOT_OFFSET = { hull: 2, stern: 3, bow: 0, bridge: 1 };
const LETTERS = Object.keys(BASE);

// A random fleet from a seed, `now` in milliseconds: characters with subs on routes of one map each, their slots' rank
// and experience recorded as they go, the voyages SubmarineTracker recorded, Fight Club routes made of real letters
// (some the subs run), Sub Rules and the repair kit price.
function randomFleet(seed, now, game) {
  const random = randomFrom(seed);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const chance = (p) => random() < p;
  // Never within an hour of the views' 14-day edge (their now() and the app's clock are a moment apart).
  const ago = (hours) => {
    let h = hours;
    if (Math.abs(h - 14 * 24) < 1) h += 2;
    return new Date(now - h * HOUR - 1234);
  };
  const byMap = new Map();
  for (const s of game.sectors) if (!s.starting) { if (!byMap.has(s.map)) byMap.set(s.map, []); byMap.get(s.map).push(s); }
  const expToNext = new Map(game.ranks.map((r) => [r.id, r.expToNext]));
  const t = Object.fromEntries(TABLES.map((name) => [name, []]));
  const routes = [];
  for (let i = 0; i < 12; i++) {
    const cid = 18014498578000000n + BigInt(i);
    const fc = chance(0.85) ? 9232379236109516800n + BigInt(i % 5) : null;
    t.companion_character_current.push({ cid, name: `Char${i}`, world: pick(['Maduin', 'Golem']), account_label: pick(['A', 'B', null]), gil: 0, ceruleum: 0,
      repair_kits: 0, retainer_count: 0, submarine_count: 0, num_sub_slots: 4, fc_id: fc, first_seen_at: new Date(now - 90 * DAY), last_synced_at: new Date(now - 60000) });
    if (chance(0.7)) t.character_sort_order.push({ cid, sort_index: Math.floor(random() * 100) });
    // A few spare parts in its bags, for Look ahead's spares (needed now first, then soonest first).
    for (let k = 0; k < 4; k++) {
      if (chance(0.5)) t.companion_inventory_snapshot.push({ owner_cid: cid, retainer_id: cid, sorted_container: pick([0, 1, 2, 3]), sorted_slot_index: k,
        item_id: BASE[pick(LETTERS)] + pick([0, 1, 2, 3]), quantity: pick([1, 1, 2]), updated_at: new Date(now - 60000) });
    }
    const subs = 1 + Math.floor(random() * 4);
    for (let s = 1; s <= subs; s++) {
      const name = chance(0.3) ? `Sub ${s}` : `Submersible-${s}`;
      const rank = chance(0.1) ? pick([1, 124, 125]) : 1 + Math.floor(random() * 124);
      const exp = Math.floor(random() * (expToNext.get(rank) || 1));
      const letters = [0, 1, 2, 3].map(() => pick(LETTERS));
      const parts = ['hull', 'stern', 'bow', 'bridge'].map((slot, k) => (chance(0.03) ? pick([null, 30000]) : BASE[letters[k]] + SLOT_OFFSET[slot]));
      const map = pick([1, 2, 3, 4]);
      const route = chance(0.1) ? [] : [...new Set([0, 1, 2, 3, 4].slice(0, 1 + Math.floor(random() * 5)).map(() => pick(byMap.get(map)).id))];
      // Now and then a stop the game data doesn't know (no letter, so no voyage worked out).
      if (route.length && chance(0.05)) route[route.length - 1] = 125;
      if (route.length) routes.push(route.map((id) => (game.sectors.find((x) => x.id === id) || { location: '' }).location).join(''));
      const points = route.length ? Buffer.from([...route, 0, 0, 0, 0, 0].slice(0, 5)) : pick([null, Buffer.from([0, 0, 0, 0, 0])]);
      const returnTime = pick([0, Math.floor((now - random() * 20 * HOUR) / 1000), Math.floor((now + random() * 30 * HOUR) / 1000)]);
      t.companion_submarine_snapshot.push({ cid, sub_name: name, level: rank, part1: parts[0], part2: parts[1], part3: parts[2], part4: parts[3], points,
        return_time: returnTime, updated_at: new Date(now - 60000), current_exp: exp, next_level_exp: expToNext.get(rank) || 0, slot: chance(0.15) ? null : s });
      if (chance(0.4)) t.sub_craft_toggle.push({ cid, sub_name: name, craft_enabled: chance(0.6) });
      // Its slot's rank and experience recorded over the last 20 days, collected every voyage or so (some subs have
      // none recorded: their dates come from game data alone); the voyages SubmarineTracker recorded alongside.
      if (chance(0.8)) {
        let r = Math.max(1, rank - Math.floor(random() * 3));
        let e = 0;
        const perVoyage = 5000 + Math.floor(random() * 60000);
        const register = 500000 + i * 10 + s;
        const history = [];
        for (let h = 20 * 24; h >= 0; h -= 12 + Math.floor(random() * 30)) {
          if (chance(0.7)) {
            e += Math.floor(perVoyage * (0.8 + random() * 0.6));
            while (e >= (expToNext.get(r) || Infinity)) { e -= expToNext.get(r); r += 1; }
            if (fc && route.length && chance(0.85)) {
              const at = ago(h);
              for (const [k, sector] of (chance(0.9) ? route : [pick(byMap.get(map)).id]).entries()) {
                t.companion_voyage_loot.push({ fc_id: fc, sub_register: register, returned_at: at, sector, sub_name: chance(0.05) ? null : name,
                  primary_item: 22500, primary_count: 1, leg: chance(0.9) ? k + 1 : null });
              }
            }
          }
          history.push({ at: ago(h), rank: r, exp: e });
        }
        if (chance(0.05)) history.splice(Math.floor(history.length / 2), 0, { at: ago(10 * 24 + 0.5), rank: 1, exp: 0 }); // another sub took the slot once
        for (const p of history) {
          t.companion_metric_history.push({ recorded_at: p.at, subject_type: 'character', subject_id: cid, metric: `sub_rank:${s}`, value: p.rank });
          t.companion_metric_history.push({ recorded_at: p.at, subject_type: 'character', subject_id: cid, metric: `sub_exp:${s}`, value: p.exp });
        }
      }
    }
  }
  // Fight Club routes: some the subs run, some not; builds from rank 85 to 125.
  for (let r = 1; r <= 14; r++) {
    const route = chance(0.6) && routes.length ? pick(routes) : pick(['OJ', 'MROJZ', 'JORZ', 'ABAC']);
    const rank = pick([70, 80, 85, 90, 95, 100, 105, 110, 115, 120]); // some below 85, which Fight Club never offers there
    const letters = [0, 1, 2, 3].map(() => pick(['S', 'U', 'W', 'C', 'Y']));
    t.fight_club_routes.push({ id: r, route, hours: pick([24, 36.5, 48, null]), repair_times: pick(['4', '6 (3)', null, 'x', '3']),
      gil_sub_day: chance(0.1) ? null : 50000 + Math.floor(random() * 250000),
      rec_build_notes: pick([`${rank}: ${letters.join('')}`, `${rank}: ${letters.join('')}++`, `${rank}: ${letters.map((l) => `${l}+`).join('')}`, 'none', '']),
      unmod_min_rank: pick([`${pick([1, 30, 60, rank - 10])}: ${letters.join('')}`, '', null]), min_rank_build: pick([`${pick([20, 50, rank - 5])}: ${letters.join('')}++`, null]),
      gil_hr: Math.floor(random() * 10000) });
  }
  for (let r = 1; r <= 6; r++) {
    const letter = () => pick([...LETTERS, '', null]);
    t.sub_build_rules.push({ id: r, rank: pick([1, 30, 45, 70, 85, 90, 100, 110]), cid_override: chance(0.15) ? 18014498578000000n + BigInt(Math.floor(random() * 12)) : null,
      sub_filter: pick(['', 'All', null, 'Sub1Only', 'Sub2,Sub4', 'Sub3']), hull: letter(), stern: letter(), bow: letter(), bridge: letter() });
  }
  for (let f = 0; f < 5; f++) {
    for (let k = 0; k < 3; k++) {
      if (chance(0.5)) t.companion_fc_inventory_snapshot.push({ fc_id: 9232379236109516800n + BigInt(f), sorted_container: pick([20000, 20001, 20002]), sorted_slot_index: k,
        item_id: BASE[pick(LETTERS)] + pick([0, 1, 2, 3]), quantity: pick([1, 2]), updated_at: new Date(now - 60000) });
    }
  }
  if (chance(0.8)) t.fleet_economics_settings.push({ setting_key: 'repair_kit_cost', setting_value: pick([0, 1730, 2500.5]) });
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
  const realNow = Date.now;
  try {
    await client.query(fs.readFileSync(path.join(DB, 'schema.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(DB, 'views.sql'), 'utf8'));
    const game = gameData();
    await writeGameData(client, game);
    for (const seed of [11, 2026, 4242, 77, 123456]) {
      const now = realNow();
      const tables = randomFleet(seed, now, game);
      for (const table of TABLES) await client.query(`TRUNCATE ${table}`);
      for (const [table, rows] of Object.entries(tables)) if (rows.length) await insert(client, table, rows);
      const inputs = {};
      for (const [key, sql] of Object.entries(VIEWS)) inputs[key] = (await client.query(sql)).rows.map(row);
      // The app's answers at the same moment (its clock held at `now`).
      Date.now = () => now;
      let subs;
      let partsAhead;
      try {
        subs = await loadSubmarinesWithRankUps(client);
        // The Parts page with Look ahead at 14 days: what's needed now, then the next builds due by then.
        partsAhead = await computePartsNeeded(client, { aheadDays: 14 });
      } finally { Date.now = realNow; }
      const expected = subs.map((s) => row({
        cid: String(s.cid), sub_name: s.sub_name, current_setup: s.current_setup, current_route: s.current_route,
        current_map: s.current_map ? s.current_map.id : null, target_route: s.target_route, target_gil_day: s.target_gil_day === '' ? null : s.target_gil_day,
        current_gil_day: s.current_gil_day === '' ? null : s.current_gil_day, speed: s.speed === '' ? null : s.speed, range: s.range === '' ? null : s.range,
        rank_progress_pct: s.rank_progress_pct,
        rank_up: JSON.stringify(s.rank_up),
      }));
      const expectedParts = partsAhead.map((r) => row({
        cid: String(r.cid), sub_name: r.sub_name, rank: r.rank, slot: r.slot, needed_class: r.needed_class, needed_modified: r.needed_modified,
        spare_location: r.spare_location, recycled_from: r.recycled_from, due_at: r.due_at,
      }));
      for (const r of expectedParts) r.cid = String(r.cid);
      for (const r of [...inputs.characters, ...inputs.subs, ...inputs.history, ...inputs.partsSubs]) r.cid = String(r.cid);
      for (const r of inputs.spares) { if (r.cid !== null) r.cid = String(r.cid); if (r.retainer_id !== null) r.retainer_id = String(r.retainer_id); }
      for (const r of inputs.rules) if (r.cid_override !== null) r.cid_override = String(r.cid_override);
      const methods = {};
      for (const s of subs) methods[s.rank_up.method] = (methods[s.rank_up.method] || 0) + 1;
      console.log(`random fleet ${seed}: ${subs.length} subs, ${subs.filter((s) => s.target_route).length} with a Target Route, `
        + `${subs.filter((s) => typeof s.current_gil_day === 'number').length} with a Current Gil/Day, ${subs.filter((s) => s.rank_up.nextBuild).length} with a Next Build; `
        + `dates: ${Object.entries(methods).map(([m, n]) => `${m} ${n}`).join(', ')}`);
      console.log(`   Look ahead 14 days: ${expectedParts.length} parts, ${expectedParts.filter((p) => p.due_at !== null).length} for builds coming up`);
      cases.push({ name: `random fleet ${seed}`, now, inputs, expected, expectedParts });
    }
    if (out) {
      fs.writeFileSync(out, `${JSON.stringify({ about: 'Written by XIVFleetCompanion-App tests/db/routes-fixture.js: the fleet_route_* views, made-up game data and the app\'s Subs answers for made-up fleets.', game, cases })}\n`);
      console.log(`written to ${out}`);
    }
  } finally {
    Date.now = realNow;
    await client.end();
    await admin.query(`DROP DATABASE IF EXISTS ${NAME}`);
    await admin.end();
  }
})().catch((e) => { console.error(e); process.exit(1); });
