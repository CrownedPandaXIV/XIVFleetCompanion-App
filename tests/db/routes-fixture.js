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
// Its calls are kept, so the Shopping List's (ipc/shopping.js get-shopping-list) can be asked as the window asks it.
const handlers = new Map();
const original = Module._load;
Module._load = function load(request, ...rest) {
  if (request === 'electron') return { ipcMain: { handle(name, fn) { handlers.set(name, fn); } }, app: { getPath: () => '.', getVersion: () => '0' }, safeStorage: {}, BrowserWindow: { getAllWindows: () => [] } };
  return original.call(this, request, ...rest);
};
// Stood in for before the rest loads (they take these when loaded): the Shopping List works on this script's database
// (not the app's saved one) and asks a made-up Universalis (fakeUniversalis below) when Live Market Prices is on.
const db = require('../../db');
const universalisSetting = require('../../ipc/universalis');
let shoppingClient = null;
let liveMarket = null;
db.withClient = async (work, onError) => { try { return await work(shoppingClient); } catch (err) { return onError(err); } };
universalisSetting.liveUniversalis = async (client) => {
  const { rows } = await client.query("SELECT setting_value FROM tier3_settings WHERE setting_key = 'universalis_enabled'");
  return rows.length && rows[0].setting_value === 'true' ? liveMarket : null;
};
const { loadSubmarinesWithRankUps, loadForecastAccuracy } = require('../../ipc/subs');
const { computePartsNeeded } = require('../../ipc/parts');
const { loadLoot } = require('../../ipc/details');
const { voyagesFrom, marketLoot } = require('../../subs/loot');
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
  // Loot per Voyage on the Income page.
  loot: 'SELECT * FROM fleet_voyage_loot_view ORDER BY fc_id, sub_register, returned_at, sector',
  // How close the Next Rank dates came (the Subs page's forecast line).
  forecasts: 'SELECT * FROM fleet_rankup_forecast_view ORDER BY cid, slot, rank, made_at',
  rankHistory: 'SELECT * FROM fleet_rankup_history_view ORDER BY cid, metric, recorded_at',
  returns: 'SELECT * FROM fleet_voyage_returns_view ORDER BY fc_id, sub_name, returned_at',
  // The Shopping List: what's held where, the ticks and the retainers whose listings aren't the market.
  shoppingHeld: 'SELECT * FROM fleet_shopping_held_view ORDER BY item_id, who COLLATE "C", place COLLATE "C"',
  shoppingProgress: 'SELECT * FROM fleet_shopping_progress_view',
  retainers: 'SELECT retainer_name AS name, world FROM fleet_retainers_view ORDER BY retainer_id',
};

// A made-up Universalis for the Shopping List's market prices: three data centers in two regions, and listings made
// up from the place and item (some by the fleet's own retainers, some free or with no quantity, some items not listed
// at all). Everything it answers is kept in `asked` (place -> item -> listings) for the plugin's tests to answer the same.
const PLACES = [['Dynamis', 'North-America', ['Maduin', 'Golem', 'Halicarnassus']], ['Aether', 'North-America', ['Siren', 'Jenova']],
  ['Chaos', 'Europe', ['Omega', 'Moogle']]];
function fakeUniversalis(ownRetainers) {
  const places = new Map();
  for (const [dc, region, worlds] of PLACES) for (const w of worlds) places.set(w.toLowerCase(), { name: w, dc, region });
  const asked = {};
  const worldsIn = (scope) => [...places.values()].filter((p) => p.name === scope || p.dc === scope || p.region === scope).map((p) => p.name);
  return {
    asked,
    placesOf: async () => places,
    listingsIn: async (scope, ids) => {
      const listings = new Map();
      asked[scope] = asked[scope] || {};
      for (const id of [...new Set(ids.map(Number).filter((x) => x > 0))]) {
        let h = 17;
        for (const ch of `${scope}|${id}`) h = (h * 31 + ch.charCodeAt(0)) % 1000003;
        if (h % 7 === 0) continue;
        const random = randomFrom(h);
        const pick = (list) => list[Math.floor(random() * list.length)];
        const isWorld = places.has(String(scope).toLowerCase());
        const list = Array.from({ length: Math.floor(random() * 5) }, (_, k) => {
          const world = isWorld ? undefined : pick(worldsIn(scope).length ? worldsIn(scope) : ['Golem']);
          const own = ownRetainers.length && random() < 0.2 ? pick(ownRetainers) : null;
          // Now and then exactly a vendor's price (the vendor wins a tie).
          return { pricePerUnit: random() < 0.05 ? 0 : random() < 0.15 ? pick([15, 120, 999]) : 10 + Math.floor(random() * 5000), quantity: pick([0, 1, 1, 3, 10, 99]), hq: random() < 0.3,
            retainerName: own ? own.name : `Seller${k}`, ...(world ? { worldName: world } : {}) };
        });
        listings.set(id, list);
        asked[scope][id] = list;
      }
      return { listings, stale: null };
    },
  };
}

// How the Shopping List is asked for (Look ahead, Buy from vendors, Prices from), with Live Market Prices off or on.
const SHOPPING_RUNS = [
  { live: false, options: { aheadDays: 0 } },
  { live: false, options: { aheadDays: 14, buyFromVendors: true } },
  { live: true, options: { aheadDays: 7, priceScope: 'world:Golem' } },
  { live: true, options: { aheadDays: 0, priceScope: 'region:North-America', buyFromVendors: true } },
  { live: true, options: { aheadDays: 3 } },
  { live: true, options: { aheadDays: 14, priceScope: 'dc:Chaos' } },
  { live: true, options: { aheadDays: 0, priceScope: 'world:Nowhere' } },
];

// What a vendor pays for the made-up loot that isn't salvage (the app's item table; 99999 has no price).
const ITEM_PRICES = { 5111: 120, 12500: 3400, 12501: 77 };

// Made-up market prices for Loot per Voyage at market prices: the same on both sides, by world, scope and item.
function fakePrice(world, scope, id) {
  let h = 7;
  for (const ch of `${world}|${scope}|${id}`) h = (h * 31 + ch.charCodeAt(0)) % 100003;
  return h % 5 === 0 ? null : 100 + (h % 9000);
}

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
  'companion_fc_inventory_snapshot', 'companion_rankup_forecast', 'companion_retainer_lookup', 'companion_character_housing', 'tier3_settings'];

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
  return { sectors, maps, ranks, parts, shop: shopData() };
}

// Made-up crafting data for the Shopping List, in the shape of the game's sheets: every sub part (but one) built at
// the FC workshop in phases (sequences -> their parts -> their processes, each asking for supply items in sets), the
// in-between items made from recipes (some with two, the lower id used; one with an empty one first), raw materials
// and crystals, what gil shops sell and each item's name and vendor price (PriceMid).
const SHOP_MADE = Array.from({ length: 16 }, (_, k) => 30001 + k);
const SHOP_RAW = Array.from({ length: 20 }, (_, k) => 31001 + k);
const SHOP_CRYSTALS = [2, 3, 4, 8, 9, 14, 19];
function shopData() {
  const random = randomFrom(4321);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const partIds = Object.values(BASE).flatMap((b) => [0, 1, 2, 3].map((k) => b + k)).filter((id) => id !== BASE['Y+'] + 3);
  const supplyItems = [];
  const supplyFor = (item) => {
    let found = supplyItems.find((x) => x.item === item);
    if (!found) { found = { id: 100 + supplyItems.length, item }; supplyItems.push(found); }
    return found.id;
  };
  const processes = [];
  const craftParts = [];
  const sequences = [];
  for (const [k, id] of partIds.entries()) {
    const partsOf = [];
    for (let c = 0; c < 1 + Math.floor(random() * 2); c++) {
      const procs = [];
      for (let q = 0; q < 1 + Math.floor(random() * 3); q++) {
        const n = 1 + Math.floor(random() * 3);
        const items = Array.from({ length: n }, () => supplyFor(pick([...SHOP_MADE, ...SHOP_MADE, ...SHOP_RAW, 2, 8])));
        processes.push({ id: 1000 + processes.length, supply: items, perSet: items.map(() => pick([1, 2, 3, 5])), sets: items.map(() => pick([1, 2, 3])) });
        procs.push(processes[processes.length - 1].id);
      }
      craftParts.push({ id: 500 + craftParts.length, procs });
      partsOf.push(craftParts[craftParts.length - 1].id);
    }
    // Now and then a part with a phase asking for nothing (left out), or a second sequence for the same part (the first counts).
    if (random() < 0.05) craftParts.push({ id: 500 + craftParts.length, procs: [] });
    sequences.push({ id: 10 + k * 2, result: id, parts: partsOf });
    if (random() < 0.1) sequences.push({ id: 11 + k * 2, result: id, parts: [craftParts[0].id] });
  }
  // In-between items: each made from raw materials, crystals and in-between items made later in the list (so no loops).
  const recipes = [];
  for (const [k, id] of SHOP_MADE.entries()) {
    const later = SHOP_MADE.slice(k + 1);
    const ingredients = () => {
      const list = [];
      for (let n = 0; n < 1 + Math.floor(random() * 4); n++) {
        const item = later.length && random() < 0.3 ? pick(later) : pick(SHOP_RAW);
        if (!list.some(([i]) => i === item)) list.push([item, pick([1, 2, 3, 4])]);
      }
      list.push([pick(SHOP_CRYSTALS), pick([1, 2, 5])]);
      return list;
    };
    if (random() < 0.15) recipes.push({ id: 20 + k * 3, result: id, yield: 1, craftType: 1, ingredients: [] });
    recipes.push({ id: 21 + k * 3, result: id, yield: pick([1, 1, 2, 3]), craftType: pick([0, 1, 2, 3, 4, 5, 6, 7, 9]), ingredients: ingredients() });
    if (random() < 0.3) recipes.push({ id: 22 + k * 3, result: id, yield: 1, craftType: pick([0, 5]), ingredients: ingredients() });
  }
  // A recipe for a crystal (so it's made, not gathered) and one for something nothing on the list uses.
  recipes.push({ id: 9000, result: 2, yield: 3, craftType: 6, ingredients: [[SHOP_RAW[0], 1]] });
  recipes.push({ id: 9001, result: 39999, yield: 1, craftType: 6, ingredients: [[SHOP_RAW[1], 1]] });
  const items = [...partIds, ...SHOP_MADE, ...SHOP_RAW, ...SHOP_CRYSTALS]
    .map((id) => ({ id, name: random() < 0.05 ? null : `Thing ${id}`, priceMid: pick([0, 3, 15, 120, 999, 2400]) }));
  const gilShop = [...SHOP_RAW, ...SHOP_MADE, ...SHOP_CRYSTALS].filter(() => random() < 0.35);
  return { sequences, craftParts, processes, supplyItems, recipes, items, gilShop };
}

async function writeGameData(client, game) {
  await client.query(`DROP TABLE IF EXISTS ffxiv_submarineexploration, ffxiv_submarinemap, ffxiv_submarinerank, ffxiv_submarinepart`);
  await client.query(`CREATE TABLE ffxiv_submarineexploration (id text, location text, exp_reward text, survey_durationmin text, x text, y text, z text,
    starting_point text, map text)`);
  await client.query('CREATE TABLE ffxiv_submarinemap (id text, name text)');
  await client.query('CREATE TABLE ffxiv_submarinerank (id text, speed_bonus text, range_bonus text, exp_to_next text)');
  await client.query('CREATE TABLE ffxiv_submarinepart (id text, "class" text, slot text, speed text, range text)');
  await client.query('DROP TABLE IF EXISTS ffxiv_item');
  await client.query('CREATE TABLE ffxiv_item (id text, name text, price_low text, price_mid text)');
  await insert(client, 'ffxiv_item', Object.entries(ITEM_PRICES).map(([id, price]) => ({ id, name: `Item ${id}`, price_low: String(price), price_mid: '0' })));
  // The Shopping List's: the FC workshop's phases, recipes, gil shops and the items' names and vendor prices.
  const shop = game.shop;
  await insert(client, 'ffxiv_item', shop.items.map((i) => ({ id: String(i.id), name: i.name, price_low: '0', price_mid: String(i.priceMid) })));
  const numbered = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}_${i}`);
  await client.query('DROP TABLE IF EXISTS ffxiv_companycraftsequence, ffxiv_companycraftpart, ffxiv_companycraftprocess, ffxiv_companycraftsupplyitem, ffxiv_recipe, ffxiv_gilshopitem');
  await client.query(`CREATE TABLE ffxiv_companycraftsequence (id text, result_item text, ${numbered('company_craft_part', 8).map((c) => `${c} text`).join(', ')})`);
  await client.query(`CREATE TABLE ffxiv_companycraftpart (id text, ${numbered('company_craft_process', 3).map((c) => `${c} text`).join(', ')})`);
  await client.query(`CREATE TABLE ffxiv_companycraftprocess (id text, ${[...numbered('supply_item', 12), ...numbered('set_quantity', 12), ...numbered('sets_required', 12)].map((c) => `${c} text`).join(', ')})`);
  await client.query('CREATE TABLE ffxiv_companycraftsupplyitem (id text, item text)');
  await client.query(`CREATE TABLE ffxiv_recipe (id text, craft_type text, item_result text, amount_result text, ${[...numbered('ingredient', 8), ...numbered('amount_ingredient', 8)].map((c) => `${c} text`).join(', ')})`);
  await client.query('CREATE TABLE ffxiv_gilshopitem (id text, item text)');
  const slots = (list, n) => Array.from({ length: n }, (_, i) => String(list[i] || 0));
  await insert(client, 'ffxiv_companycraftsequence', shop.sequences.map((q) => ({ id: String(q.id), result_item: String(q.result),
    ...Object.fromEntries(numbered('company_craft_part', 8).map((c, i) => [c, slots(q.parts, 8)[i]])) })));
  await insert(client, 'ffxiv_companycraftpart', shop.craftParts.map((c) => ({ id: String(c.id),
    ...Object.fromEntries(numbered('company_craft_process', 3).map((col, i) => [col, slots(c.procs, 3)[i]])) })));
  await insert(client, 'ffxiv_companycraftprocess', shop.processes.map((p) => ({ id: String(p.id),
    ...Object.fromEntries(numbered('supply_item', 12).map((c, i) => [c, slots(p.supply, 12)[i]])),
    ...Object.fromEntries(numbered('set_quantity', 12).map((c, i) => [c, slots(p.perSet, 12)[i]])),
    ...Object.fromEntries(numbered('sets_required', 12).map((c, i) => [c, slots(p.sets, 12)[i]])) })));
  await insert(client, 'ffxiv_companycraftsupplyitem', shop.supplyItems.map((x) => ({ id: String(x.id), item: String(x.item) })));
  await insert(client, 'ffxiv_recipe', shop.recipes.map((r) => ({ id: String(r.id), craft_type: String(r.craftType), item_result: String(r.result), amount_result: String(r.yield),
    ...Object.fromEntries(numbered('ingredient', 8).map((c, i) => [c, String(r.ingredients[i] ? r.ingredients[i][0] : 0)])),
    ...Object.fromEntries(numbered('amount_ingredient', 8).map((c, i) => [c, String(r.ingredients[i] ? r.ingredients[i][1] : 0)])) })));
  await insert(client, 'ffxiv_gilshopitem', shop.gilShop.map((id, k) => ({ id: String(262144 + k), item: String(id) })));
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
    for (const days of [3, 7, 14, 30]) if (Math.abs(h - days * 24) < 1) h += 2;
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
    t.companion_character_current.push({ cid, name: `Char${i}`, world: seed === 77 ? (i % 2 ? 'Siren' : 'Maduin') : chance(0.08) ? 'Nowhere' : pick(['Maduin', 'Golem']), account_label: pick(['A', 'B', null]), gil: 0, ceruleum: 0,
      repair_kits: 0, retainer_count: 0, submarine_count: 0, num_sub_slots: 4, fc_id: fc, first_seen_at: new Date(now - 90 * DAY), last_synced_at: new Date(now - 60000) });
    if (chance(0.7)) t.character_sort_order.push({ cid, sort_index: Math.floor(random() * 100) });
    // A few spare parts in its bags, for Look ahead's spares (needed now first, then soonest first).
    for (let k = 0; k < 4; k++) {
      if (chance(0.5)) t.companion_inventory_snapshot.push({ owner_cid: cid, retainer_id: cid, sorted_container: pick([0, 1, 2, 3]), sorted_slot_index: k,
        item_id: BASE[pick(LETTERS)] + pick([0, 1, 2, 3]), quantity: pick([1, 1, 2]), updated_at: new Date(now - 60000) });
    }
    // For the Shopping List: materials and crystals here and there (normal and high quality), only some of the places
    // counting (bags, crystals, saddlebags; not what's worn, mail or the armoire), its retainers' (bags and crystals
    // count; what they wear or sell doesn't) and its FC's name.
    const material = () => pick([...SHOP_MADE, ...SHOP_RAW, ...SHOP_RAW, ...SHOP_CRYSTALS]) + (chance(0.15) ? 1000000 : 0);
    for (let k = 0; k < 8; k++) {
      if (chance(0.6)) t.companion_inventory_snapshot.push({ owner_cid: cid, retainer_id: cid, sorted_container: pick([0, 1, 2, 3, 2001, 4000, 4001, 4100, 4101, 1000, 2003, 2500]),
        sorted_slot_index: 100 + k, item_id: material(), quantity: pick([1, 2, 5, 20, 99]), updated_at: new Date(now - 60000) });
    }
    for (let r = 0; r < Math.floor(random() * 3); r++) {
      const retainerId = 7000000n + BigInt(i * 10 + r);
      t.companion_retainer_lookup.push({ retainer_id: retainerId, owner_cid: cid, name: chance(0.1) ? '' : pick([`Amy${i}`, `Bo${r}`, 'Cid']) });
      for (let k = 0; k < 4; k++) {
        if (chance(0.6)) t.companion_inventory_snapshot.push({ owner_cid: cid, retainer_id: retainerId, sorted_container: pick([10000, 10003, 10006, 12001, 11000, 12002]),
          sorted_slot_index: k, item_id: material(), quantity: pick([1, 3, 10, 50]), updated_at: new Date(now - 60000) });
      }
    }
    if (fc && chance(0.8)) t.companion_character_housing.push({ cid, fc_id: fc, fc_name: chance(0.2) ? null : `Company ${fc % 100n}`, updated_at: new Date(now - (i + 1) * 60000) });
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
        // Now and then renamed since: its voyages carry an old name, so its character is any member of its FC.
        const lootName = chance(0.15) ? `${name} (old)` : name;
        const history = [];
        for (let h = 20 * 24; h >= 0; h -= 12 + Math.floor(random() * 30)) {
          if (chance(0.7)) {
            e += Math.floor(perVoyage * (0.8 + random() * 0.6));
            while (e >= (expToNext.get(r) || Infinity)) { e -= expToNext.get(r); r += 1; }
            if (fc && route.length && chance(0.85)) {
              const at = ago(h);
              for (const [k, sector] of (chance(0.9) ? route : [pick(byMap.get(map)).id]).entries()) {
                // What it brought back: salvage, now and then something else (priced from the item table, or not at all).
                const loot = () => (chance(0.7) ? 22500 + Math.floor(random() * 8) : pick([5111, 12500, 12501, 99999]));
                t.companion_voyage_loot.push({ fc_id: fc, sub_register: register, returned_at: at, sector, sub_name: chance(0.05) ? null : lootName,
                  primary_item: loot(), primary_count: 1 + Math.floor(random() * 3), additional_item: chance(0.5) ? loot() : null,
                  additional_count: chance(0.9) ? 1 + Math.floor(random() * 2) : 0, leg: chance(0.9) ? k + 1 : null });
              }
            }
          }
          history.push({ at: ago(h), rank: r, exp: e });
        }
        if (chance(0.05)) history.splice(Math.floor(history.length / 2), 0, { at: ago(10 * 24 + 0.5), rank: 1, exp: 0 }); // another sub took the slot once
        // Next Rank dates the app saved now and then over the last 30 days, some for ranks it has since reached.
        for (let k = 0; k < 8; k++) {
          const p = pick(history);
          const made = new Date(p.at.getTime() - random() * 3 * 24 * HOUR);
          if (made.getTime() < now - 29 * 24 * HOUR) continue;
          t.companion_rankup_forecast.push({ cid, slot: s, rank: p.rank + pick([0, 1, 1, 2]), made_at: made,
            predicted_at: new Date(made.getTime() + random() * 4 * 24 * HOUR), sub_name: name });
        }
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
  for (let f = 0; f < 5; f++) {
    for (let k = 0; k < 5; k++) {
      if (chance(0.5)) t.companion_fc_inventory_snapshot.push({ fc_id: 9232379236109516800n + BigInt(f), sorted_container: pick([20000, 20005, 20010, 22001, 21000]),
        sorted_slot_index: 100 + k, item_id: pick([...SHOP_MADE, ...SHOP_RAW, ...SHOP_CRYSTALS]) + (chance(0.1) ? 1000000 : 0), quantity: pick([1, 4, 30, 999]),
        updated_at: new Date(now - 60000) });
    }
  }
  // Parts already ticked off on the Shopping List, some with a Look ahead (and one the Parts page doesn't offer).
  const ticks = {};
  for (let k = 0; k < 12; k++) {
    const id = BASE[pick(LETTERS)] + pick([0, 1, 2, 3]);
    const ahead = pick([0, 0, 3, 7, 14, 5]);
    const outOf = 1 + Math.floor(random() * 4);
    ticks[id] = ahead ? { made: 1 + Math.floor(random() * outOf), outOf, ahead } : { made: 1 + Math.floor(random() * outOf), outOf };
  }
  if (chance(0.85)) t.tier3_settings.push({ setting_key: 'shopping_progress', setting_value: JSON.stringify(ticks) });
  if (chance(0.8)) t.fleet_economics_settings.push({ setting_key: 'repair_kit_cost', setting_value: pick([0, 1730, 2500.5]) });
  if (chance(0.8)) t.fleet_economics_settings.push({ setting_key: 'income_window_days', setting_value: pick([3, 7, 14, 30, 5]) });
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
      let loot;
      let accuracy;
      try {
        subs = await loadSubmarinesWithRankUps(client);
        // The Parts page with Look ahead at 14 days: what's needed now, then the next builds due by then.
        partsAhead = await computePartsNeeded(client, { aheadDays: 14 });
        loot = await loadLoot(client, {});
        accuracy = await loadForecastAccuracy(client);
      } finally { Date.now = realNow; }
      // Loot per Voyage at (made-up) market prices, by the app's own working out.
      const worldOf = new Map(loot.subs.filter((r) => r.world).map((r) => [`${r.fcId}|${r.register}`, r.world]));
      const letterFor = new Map(game.sectors.filter((x) => x.location).map((x) => [x.id, x.location]));
      const priceFor = (world, scope) => new Map([...new Set(inputs.loot.flatMap((r) => [r.primary_item, r.additional_item]).filter(Boolean))]
        .map((id) => [Number(id), fakePrice(world, scope, id)]).filter(([, p]) => p !== null));
      const market = marketLoot(voyagesFrom(inputs.loot.map((r) => ({ ...r, returned_at: new Date(r.returned_at) }))), { worldOf, priceFor, letterFor, windowDays: loot.windowDays });
      const expectedLoot = {
        windowDays: loot.windowDays,
        totals: loot.totals,
        subs: loot.subs.map((r) => ({ fcId: r.fcId, register: String(r.register), subName: r.subName, voyages: r.voyages, gil: r.gil, perVoyage: r.perVoyage,
          perDay: r.perDay, route: r.route, lastAt: r.lastAt, character: r.character_name, world: r.world, expectedPerDay: r.expectedPerDay })),
        routes: loot.routes.map((r) => ({ route: r.route, voyages: r.voyages, subs: r.subs, gil: r.gil, perVoyage: r.perVoyage })),
        market: Object.fromEntries(['world', 'dc', 'region'].map((sc) => [sc, {
          totals: market[sc].totals,
          subs: [...market[sc].subs.entries()].map(([key, v]) => ({ key, ...v })),
          routes: [...market[sc].routes.entries()].map(([route, v]) => ({ route, ...v })),
        }])),
      };
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
      for (const r of [...inputs.characters, ...inputs.subs, ...inputs.history, ...inputs.partsSubs, ...inputs.forecasts, ...inputs.rankHistory]) r.cid = String(r.cid);
      for (const r of inputs.spares) { if (r.cid !== null) r.cid = String(r.cid); if (r.retainer_id !== null) r.retainer_id = String(r.retainer_id); }
      for (const r of inputs.rules) if (r.cid_override !== null) r.cid_override = String(r.cid_override);
      // The Shopping List, asked for each way in turn, each from the same saved ticks (asking saves them reconciled).
      liveMarket = fakeUniversalis(inputs.retainers.filter((r) => r.name).map((r) => ({ name: r.name, world: r.world })));
      shoppingClient = client;
      const shopping = [];
      const storedTicks = inputs.shoppingProgress.length ? inputs.shoppingProgress[0].progress : null;
      for (const run of SHOPPING_RUNS) {
        await client.query(`DELETE FROM tier3_settings WHERE setting_key IN ('universalis_enabled', 'shopping_progress')`);
        await client.query(`INSERT INTO tier3_settings (setting_key, setting_value) VALUES ('universalis_enabled', $1)`, [String(run.live)]);
        if (storedTicks !== null) await client.query(`INSERT INTO tier3_settings (setting_key, setting_value) VALUES ('shopping_progress', $1)`, [storedTicks]);
        Date.now = () => now;
        try {
          shopping.push({ ...run, result: await handlers.get('get-shopping-list')(null, run.options) });
        } finally { Date.now = realNow; }
      }
      const listed = shopping.filter((x) => x.result.success && !x.result.empty);
      console.log(`   Shopping List: ${listed.length} of ${shopping.length} ways with parts to craft (${listed.map((x) => x.result.parts.length).join(', ')} parts), `
        + `${shopping.filter((x) => x.result.market && x.result.market.scope).length} priced`);
      const methods = {};
      for (const s of subs) methods[s.rank_up.method] = (methods[s.rank_up.method] || 0) + 1;
      console.log(`random fleet ${seed}: ${subs.length} subs, ${subs.filter((s) => s.target_route).length} with a Target Route, `
        + `${subs.filter((s) => typeof s.current_gil_day === 'number').length} with a Current Gil/Day, ${subs.filter((s) => s.rank_up.nextBuild).length} with a Next Build; `
        + `dates: ${Object.entries(methods).map(([m, n]) => `${m} ${n}`).join(', ')}`);
      console.log(`   Look ahead 14 days: ${expectedParts.length} parts, ${expectedParts.filter((p) => p.due_at !== null).length} for builds coming up`);
      console.log(`   Loot per Voyage over ${loot.windowDays} days: ${loot.totals.voyages} voyages, ${loot.subs.length} subs, ${loot.routes.length} routes, ${Math.round(loot.totals.gil)} gil`);
      console.log(`   Next Rank dates checked: ${accuracy.count} (${accuracy.checks.length} listed), off by ${accuracy.averageOff === null ? '-' : (accuracy.averageOff / 3600000).toFixed(1)}h on average`);
      cases.push({ name: `random fleet ${seed}`, now, inputs, expected, expectedParts, expectedLoot, expectedAccuracy: accuracy, shopping, listings: liveMarket.asked });
    }
    if (out) {
      fs.writeFileSync(out, `${JSON.stringify({ about: 'Written by XIVFleetCompanion-App tests/db/routes-fixture.js: the fleet_route_* views, made-up game data and the app\'s Subs answers for made-up fleets.', game, itemPrices: ITEM_PRICES, places: PLACES, cases })}\n`);
      console.log(`written to ${out}`);
    }
  } finally {
    Date.now = realNow;
    await client.end();
    await admin.query(`DROP DATABASE IF EXISTS ${NAME}`);
    await admin.end();
  }
})().catch((e) => { console.error(e); process.exit(1); });
