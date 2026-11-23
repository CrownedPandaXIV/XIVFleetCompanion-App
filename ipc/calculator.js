// The Sub Calculator's Planner page: the game's sectors, parts and ranks, the shipped loot and breakpoints
// (subs/calculator-data.json), the player's own subs to start from, and the plan for a build and route
// (subs/calculator.js). The game data is read once per page load and kept for the plans asked for after it.
const { ipcMain } = require('electron');
const { withClient } = require('../db');
const { columnsByKey } = require('./shopping');
const { loadSubmarines, loadStatTables, loadRankUpGameData } = require('./subs');
const rankUp = require('../subs/rank-up');
const { Worker } = require('worker_threads');
const path = require('path');
const { itemNames, itemPrices } = require('./details');
const { repairKitCostFrom, sparePartLookup, SLOT_KEYS } = require('./parts');
const { snapshotFragments } = require('../db');
const finder = require('../subs/build-finder');
const routeFinder = require('../subs/route-finder');
const compare = require('../subs/compare');
const levelling = require('../subs/levelling');
const { buildStats, partLetter } = require('../subs/submarine-builds');
const calculatorData = require('../subs/calculator-data');
const calc = require('../subs/calculator');
const { liveUniversalis, universalisEnabled } = require('./universalis');
const { scopePrices, ownRetainerKeys, REGION_LABELS } = require('../characters/universalis');

const quote = (name) => `"${name.replace(/"/g, '""')}"`;
// Part letters in the order the page offers them, and their class numbers (as submarine-builds.js).
const PART_LETTERS = ['S', 'U', 'W', 'C', 'Y', 'S+', 'U+', 'W+', 'C+', 'Y+'];
const CLASS_OF = { W: 1, U: 2, S: 3, C: 4, Y: 5, 'W+': 6, 'U+': 7, 'S+': 8, 'C+': 9, 'Y+': 10 };
const CLASS_NAMES = { S: 'Shark', U: 'Unkiu', W: 'Whale', C: 'Coelacanth', Y: 'Syldra' };
const partName = (letter) => (letter.endsWith('+') ? `Modified ${CLASS_NAMES[letter[0]]}` : CLASS_NAMES[letter]);

let cache = null;

// Everything the plans are worked out from, read from the database's game data.
async function loadGame(client) {
  const stats = await loadStatTables(client);
  const { expToNext } = await loadRankUpGameData(client);
  const cols = await columnsByKey(client, 'ffxiv_submarineexploration');
  const want = { letter: 'location', name: 'destination', map: 'map', rankReq: 'rankreq', x: 'x', y: 'y', z: 'z', expReward: 'expreward',
    surveyMinutes: 'surveydurationmin', surveyDistance: 'surveydistance', tanks: 'ceruleumtankreq', starting: 'startingpoint' };
  const missing = Object.values(want).filter((k) => !cols.has(k));
  if (missing.length) return { missing };
  const { rows } = await client.query(`SELECT id, ${Object.entries(want).map(([as, k]) => `${quote(cols.get(k))} AS "${as}"`).join(', ')} FROM ffxiv_submarineexploration`);
  const sectors = new Map();
  const startingPoints = [];
  for (const r of rows) {
    // The game's names end in the sector's letter ("South Isle of Zozonan (A)"): left off, as the letter is shown beside it.
    const s = { id: Number(r.id), letter: r.letter || '', name: String(r.name || '').replace(new RegExp(`\\s*\\(${String(r.letter || '').replace(/[^A-Za-z]/g, '')}\\)$`), '').trim(), map: Number(r.map) || 0, rankReq: Number(r.rankReq) || 0,
      x: Number(r.x) || 0, y: Number(r.y) || 0, z: Number(r.z) || 0, expReward: Number(r.expReward) || 0,
      surveyMinutes: Number(r.surveyMinutes) || 0, surveyDistance: Number(r.surveyDistance) || 0, tanks: Number(r.tanks) || 0 };
    if (String(r.starting).toLowerCase() === 'true') startingPoints.push(s);
    else if (s.id > 0 && s.name) sectors.set(s.id, s);
  }
  const mapCols = await columnsByKey(client, 'ffxiv_submarinemap');
  const maps = mapCols.has('name')
    ? (await client.query(`SELECT id, ${quote(mapCols.get('name'))} AS name FROM ffxiv_submarinemap`)).rows
      .map((r) => ({ id: Number(r.id), name: r.name || '' })).filter((m) => m.id > 0 && m.name && [...sectors.values()].some((s) => s.map === m.id))
    : [];
  const partCols = await columnsByKey(client, 'ffxiv_submarinepart');
  const parts = (partCols.has('rank') && partCols.has('repairmaterials')
    ? (await client.query(`SELECT class, slot, ${quote(partCols.get('rank'))} AS rank, ${quote(partCols.get('repairmaterials'))} AS kits FROM ffxiv_submarinepart`)).rows
    : []).map((r) => ({ class: Number(r.class), slot: Number(r.slot), rank: Number(r.rank) || 0, repairKits: Number(r.kits) || 0 }))
    .filter((p) => p.class > 0);
  const maxRank = Math.max(1, rankUp.topRank(stats.rankStatsById, expToNext));
  return { sectors, startingPoints, maps, parts, stats, maxRank, expToNext };
}

// The page's starting data: maps, sectors, part classes, the player's subs, and where the loot data is from.
async function loadCalculator(client) {
  const game = await loadGame(client);
  if (game.missing) return { success: true, missingGameData: game.missing };
  const data = calculatorData.load();
  const itemIds = [...new Set(data.sectors.flatMap((s) => Object.values(s.pools).flatMap((p) => p.loot.map((l) => l[0]))))];
  const [names, prices, repairKitCost] = await Promise.all([itemNames(client, itemIds), itemPrices(client, itemIds), repairKitCostFrom(client)]);
  cache = { game, data, names, prices, repairKitCost, live: await universalisEnabled(client).catch(() => false), market: new Map(),
    fcs: await fcSectors(client).catch(() => []) };

  // The player's subs for the sub picker: who has them (account, character, world, Free Company), their build,
  // route and whether they are out (return_time), in the roster's order.
  let subs = [];
  try {
    const fcNames = new Map();
    try {
      for (const r of (await client.query('SELECT cid, fc_name FROM companion_character_housing')).rows) if (r.fc_name) fcNames.set(String(r.cid), r.fc_name);
    } catch { /* no Free Company names: the picker searches without them */ }
    const fcIds = await fcIdsOf(client);
    subs = (await loadSubmarines(client)).map((s) => ({
      cid: String(s.cid), subName: s.sub_name, character: s.character_name || 'Unknown character', world: s.world || '',
      account: s.account_label || '', fc: fcNames.get(String(s.cid)) || '', fcId: fcIds.get(String(s.cid)) || null, sortIndex: s.sort_index ?? null,
      rank: s.rank, exp: Number(s.current_exp) || 0, parts: s.part_letters, routeText: s.current_route || '', returnTime: Number(s.return_time) || 0,
      route: Array.from(s.points || []).filter((b) => b > 0),
    })).filter((s) => s.parts.every((p) => CLASS_OF[p]));
  } catch { /* no subs yet: the page still works from scratch */ }

  return {
    success: true,
    maps: game.maps,
    sectors: [...game.sectors.values()].map((s) => {
      const d = data.sectors.find((x) => x.id === s.id);
      // The items it can drop, for the Build Finder's goals: each once, at the lowest tier dropping it.
      const items = d ? [...new Set(Object.values(d.pools).flatMap((p) => p.loot.map((l) => l[0])))]
        .map((id) => {
          // For the item search: at its lowest tier, how often it came in XIVStats' records (of that tier's voyages),
          // how many each time (poor to optimal), and the surveillance that tier needs.
          const tier = finder.itemTier(d, id);
          const pool = d.pools[tier];
          const entry = pool.loot.find((l) => l[0] === id);
          // amounts: how many each time at poor, normal and optimal retrieval, and the retrieval normal and optimal need.
          return { itemId: id, name: names.get(id) || `Item ${id}`, tier, chance: pool.records > 0 ? entry[1] / pool.records : null,
            low: entry[4], high: entry[9], at: tier >= 2 ? calc.breakpoint(d, tier === 3 ? 1 : 0) : null,
            amounts: { poor: [entry[4], entry[5]], normal: [entry[6], entry[7]], optimal: [entry[8], entry[9]] },
            retrievalAt: { normal: calc.breakpoint(d, 2), optimal: calc.breakpoint(d, 3) } };
        })
        .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name)) : [];
      // from: the sector it opens from (XIVStats; 0: open from the start), for the Route Finder's unlocks.
      return { id: s.id, map: s.map, letter: s.letter, name: s.name, rankReq: s.rankReq, hasData: !!d, items, from: d ? Number(d.unlockedFrom) || 0 : null };
    }),
    partLetters: PART_LETTERS.map((letter) => ({ letter, name: partName(letter) })),
    // The rank each part needs ("letter|slot" -> rank), for the note when a build has a part its rank can't fit yet.
    partRanks: Object.fromEntries(PART_LETTERS.flatMap((letter) => [0, 1, 2, 3].map((slot) => [`${letter}|${slot}`, levelling.partRanks(game.parts)(letter, slot)]))),
    maxRank: game.maxRank,
    subs,
    // The Free Companies, with the sectors each has unlocked and explored as the plugin last read them (Route Finder).
    fcs: cache.fcs,
    repairKitCost,
    about: data.about,
    // Live Market Prices (Settings): whether the loot is priced from Universalis, and the worlds to price it on, the
    // one most of the player's subs are on first.
    live: cache.live,
    markets: cache.live ? await marketPlaces(client).catch(() => null) : null,
    worlds: [...subs.reduce((m, s) => (s.world ? m.set(s.world, (m.get(s.world) || 0) + 1) : m), new Map()).entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([w]) => w),
  };
}

// Each character's Free Company (as text), from its latest snapshot.
async function fcIdsOf(client) {
  const out = new Map();
  try {
    const { latestCharacter } = await snapshotFragments(client);
    for (const r of (await client.query(`SELECT c.cid, c.fc_id FROM ${latestCharacter} c`)).rows) {
      if (r.fc_id && String(r.fc_id) !== '0') out.set(String(r.cid), String(r.fc_id));
    }
  } catch { /* no snapshots yet */ }
  return out;
}

// Every Free Company with subs or a reading, by name, each with the sectors the plugin last read in its workshop
// (database update 18): [{ fcId, name, world, accounts: [{ account ('' when none), sortIndex }], readAt (ms, or null: not
// read yet), sectors: { id: [unlocked, explored] } }].
async function fcSectors(client) {
  const fcIds = await fcIdsOf(client);
  // Who is in each FC, for the pickers: the account labels its characters are on (each with the place of the first of
  // them in the Character Roster), and its world.
  const members = new Map();
  try {
    const { latestCharacter } = await snapshotFragments(client);
    const rows = (await client.query(`SELECT c.cid::text AS cid, c.world, c.account_label, c.fc_id::text AS fc_id, so.sort_index
      FROM ${latestCharacter} c LEFT JOIN character_sort_order so ON so.cid = c.cid`)).rows;
    for (const r of rows) {
      if (!r.fc_id || r.fc_id === '0') continue;
      if (!members.has(r.fc_id)) members.set(r.fc_id, { world: '', accounts: new Map() });
      const m = members.get(r.fc_id);
      if (!m.world && r.world) m.world = r.world;
      const account = r.account_label || '';
      const at = r.sort_index === null || r.sort_index === undefined ? 1e9 : Number(r.sort_index);
      m.accounts.set(account, Math.min(m.accounts.has(account) ? m.accounts.get(account) : 1e9, at));
    }
  } catch { /* no snapshots yet: the pickers show names only */ }
  const names = new Map();
  try {
    for (const r of (await client.query('SELECT cid, fc_name FROM companion_character_housing')).rows) {
      const fc = fcIds.get(String(r.cid));
      if (fc && r.fc_name && !names.has(fc)) names.set(fc, r.fc_name);
    }
  } catch { /* no FC names: shown by number */ }
  const byFc = new Map();
  for (const fc of new Set(fcIds.values())) byFc.set(fc, { fcId: fc, name: names.get(fc) || `Free Company ${fc}`, readAt: null, sectors: {} });
  let rows = [];
  try {
    rows = (await client.query('SELECT fc_id, sector_id, unlocked, explored, read_at FROM companion_fc_sub_sector')).rows;
  } catch { /* a database without update 18 yet: nothing read */ }
  for (const r of rows) {
    const fc = String(r.fc_id);
    if (!byFc.has(fc)) byFc.set(fc, { fcId: fc, name: names.get(fc) || `Free Company ${fc}`, readAt: null, sectors: {} });
    const one = byFc.get(fc);
    const at = r.read_at instanceof Date ? r.read_at.getTime() : typeof r.read_at === 'number' ? r.read_at * 1000 : new Date(r.read_at).getTime();
    one.readAt = Math.max(one.readAt || 0, at || 0) || null;
    one.sectors[Number(r.sector_id)] = [r.unlocked === true || Number(r.unlocked) === 1, r.explored === true || Number(r.explored) === 1];
  }
  for (const one of byFc.values()) {
    const m = members.get(one.fcId);
    one.world = m ? m.world : '';
    one.accounts = m ? [...m.accounts.entries()].map(([account, sortIndex]) => ({ account, sortIndex })) : [];
  }
  return [...byFc.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// One FC's reading as subs/route-finder.js reads it (Map id -> { unlocked, explored }), or null when not read.
function readOf(fcId) {
  const fc = fcId ? (cache.fcs || []).find((f) => f.fcId === String(fcId)) : null;
  if (!fc || !fc.readAt) return null;
  return new Map(Object.entries(fc.sectors).map(([id, [unlocked, explored]]) => [Number(id), { unlocked, explored }]));
}

// The Route Finder: { rank, parts, mapId, maxStops, maxHours, must, leaveOut, rankBy, itemId, exploreFirst, fcId, place,
// scope, limit }. The best routes for the build on the map, only through sectors the FC has discovered (every sector
// when it hasn't been read) and the sub's rank allows; each sector's state for the page's tiles.
async function routesFor(client, request = {}) {
  if (!cache) await loadCalculator(client);
  if (!cache || !cache.game || cache.game.missing) return { success: false, error: 'The game data has no sub tables yet.' };
  const { game, data } = cache;
  const rank = Number(request.rank);
  const parts = request.parts || [];
  const stats = buildStats(rank, parts, game.stats.rankStatsById, game.stats.partStatsByClassSlot);
  if (!stats) return { success: true, stats: null, routes: [], tiles: [] };
  const onMap = [...game.sectors.values()].filter((x) => x.map === Number(request.mapId)).sort((a, b) => a.id - b.id);
  if (!onMap.length) return { success: true, stats, routes: [], tiles: [] };
  const dataOf = new Map(data.sectors.map((d) => [d.id, d]));
  const openerOf = new Map([...game.sectors.keys()].map((id) => [id, dataOf.has(id) ? Number(dataOf.get(id).unlockedFrom) || 0 : 0]));
  const read = readOf(request.fcId);
  const states = routeFinder.sectorStates([...game.sectors.keys()], read, openerOf);
  const leaveOut = new Set((request.leaveOut || []).map(Number));
  const must = (request.must || []).map(Number).filter((id) => onMap.some((x) => x.id === id));
  const allowed = routeFinder.usableSectors({ onMap, rank, states, leaveOut: [...leaveOut] });

  // Prices: the market's when Live Market Prices is on and a place is given, else vendor prices.
  let prices = cache.prices;
  let pricing = { source: 'vendor' };
  if (request.place && cache.live) {
    const scope = ['world', 'dc', 'region'].includes(request.scope) ? request.scope : 'dc';
    const ids = [...new Set(onMap.flatMap((x) => (dataOf.get(x.id) ? Object.values(dataOf.get(x.id).pools).flatMap((p) => p.loot.map((l) => l[0])) : [])))];
    try {
      const market = await plannerMarket(client, request.place, scope, ids);
      if (market) { prices = market.prices; pricing = { source: 'market', scope, place: market.place, stale: market.stale }; }
    } catch (err) { pricing = { source: 'vendor', error: err.message }; }
  }
  const values = new Map(onMap.map((x) => [x.id, routeFinder.sectorValue(x, dataOf.get(x.id), stats, prices)]));
  const start = calc.startFor(onMap[0].id, game.startingPoints);
  const mustOk = must.every((id) => allowed.some((x) => x.id === id));
  const itemId = request.rankBy === 'item' && request.itemId ? Number(request.itemId) : null;
  const routes = mustOk ? routeFinder.findRoutes({ sectors: allowed, start, stats, maxStops: request.maxStops, maxHours: Number(request.maxHours) || null,
    must, values, rankBy: itemId ? 'item' : request.rankBy === 'gil' ? 'gil' : 'exp', itemId, opens: routeFinder.opensOf(openerOf), states,
    exploreFirst: !!request.exploreFirst }) : [];
  const limit = Math.max(1, Number(request.limit) || 100);
  return {
    success: true, stats, read: !!read, pricing,
    tiles: onMap.map((x) => ({ id: x.id, state: states.get(x.id), rankOk: x.rankReq <= rank, allowed: allowed.some((a) => a.id === x.id) })),
    total: routes.length, newOnes: routes.filter((r) => r.explores + r.chances > 0).length,
    routes: routes.slice(0, limit).map((r) => ({ ...r, stops: r.route.map((id) => ({ id, tier: values.get(id).tier, tierSure: values.get(id).tierSure })) })),
  };
}

// The Route Finder's Unlocks tab for one FC: each map's progress, what to explore next for sure, what could open by
// chance, and the way to the next map (subs/route-finder.js unlocks).
function unlocksFor(fcId) {
  if (!cache || !cache.game || cache.game.missing) return { success: false, error: 'The game data has no sub tables yet.' };
  const { game, data } = cache;
  const dataOf = new Map(data.sectors.map((d) => [d.id, d]));
  const openerOf = new Map([...game.sectors.keys()].map((id) => [id, dataOf.has(id) ? Number(dataOf.get(id).unlockedFrom) || 0 : 0]));
  const read = readOf(fcId);
  if (!read) return { success: true, read: false };
  const states = routeFinder.sectorStates([...game.sectors.keys()], read, openerOf);
  const u = routeFinder.unlocks({ sectors: [...game.sectors.values()].sort((a, b) => a.id - b.id), maps: game.maps.slice().sort((a, b) => a.id - b.id), states, openerOf });
  return { success: true, read: true, ...u, states: Object.fromEntries(states) };
}

// Every world, data center and region Universalis knows, for the Planner's "Market prices on" (loot from a voyage can
// be moved to a character elsewhere and sold there): { world: [{ name, dc, region }], dc: [{ name, region }],
// region: [{ name, label }] }, each in name order.
async function marketPlaces(client) {
  const universalis = await liveUniversalis(client);
  if (!universalis) return null;
  const places = [...(await universalis.placesOf()).values()];
  const byName = (a, b) => a.name.localeCompare(b.name);
  const dcs = new Map(places.map((p) => [p.dc, { name: p.dc, region: p.region }]));
  const regions = new Map(places.map((p) => [p.region, { name: p.region, label: REGION_LABELS[p.region] || p.region }]));
  return { world: places.map((p) => ({ name: p.name, dc: p.dc, region: p.region })).sort(byName), dc: [...dcs.values()].sort(byName), region: [...regions.values()].sort(byName) };
}

// Market prices for the Planner's loot on one world, data center or region (place: its name; characters/universalis.js
// marketPrice: a lone low listing skipped and checked against the last week's sales), kept a few minutes.
// { prices: Map itemId -> gil (vendor for the rest), notes: Map itemId -> note, place, stale }.
const MARKET_KEEP_MS = 5 * 60 * 1000;
async function plannerMarket(client, place, scope, ids) {
  const key = `${scope}|${place}`;
  const was = cache.market && cache.market.get(key);
  if (was && Date.now() - was.at < MARKET_KEEP_MS && ids.every((id) => was.asked.has(id))) return was;
  const universalis = await liveUniversalis(client);
  if (!universalis) return null;
  const { latestCharacter } = await snapshotFragments(client);
  const own = ownRetainerKeys((await client.query(
    `SELECT r.name, c.world FROM companion_retainer_lookup r JOIN ${latestCharacter} c ON c.cid = r.owner_cid`)).rows);
  const asked = new Set([...(was ? was.asked : []), ...ids]);
  const { listings, history, stale } = await universalis.listingsIn(place, [...asked]);
  // One place's listings and sales in the shape scopePrices reads (a world's listings don't name the world).
  const m = { names: { world: scope === 'world' ? place : undefined }, listings: { [scope]: listings }, history: { [scope]: history } };
  const notes = new Map();
  const prices = scopePrices(m, scope, cache.prices, own, { notes });
  const answer = { at: Date.now(), asked, prices, notes, place: scope === 'region' ? (REGION_LABELS[place] || place) : place, stale };
  if (!cache.market) cache.market = new Map();
  cache.market.set(key, answer);
  return answer;
}

// One plan: { rank, parts: [hull, stern, bow, bridge letters], route: [sector ids], bestOrder }. market: from
// plannerMarket (its prices and notes), or null for vendor prices.
function planFor({ rank, parts, route, bestOrder } = {}, market = null) {
  if (!cache) return { success: false, error: 'The calculator is still loading.' };
  const { game, data, names, repairKitCost } = cache;
  const prices = market && market.prices ? market.prices : cache.prices;
  const stats = buildStats(Number(rank), parts, game.stats.rankStatsById, game.stats.partStatsByClassSlot);
  if (!stats) return { success: true, stats: null };
  let sectors = (route || []).map((id) => game.sectors.get(Number(id))).filter(Boolean).slice(0, 5);
  if (bestOrder && sectors.length > 1) sectors = calc.bestOrder(sectors, calc.startFor(sectors[0].id, game.startingPoints), stats.speed, stats.range);
  const p = calc.plan({ route: sectors.map((s) => s.id), stats, partClasses: parts.map((l) => CLASS_OF[l]), game, data, prices, repairKitCost });
  if (!p) return { success: true, stats, route: [] };
  return {
    success: true, stats, route: sectors.map((s) => s.id),
    range: p.range, hours: p.hours, exp: p.exp, expSure: p.expSure, expBest: p.expBest, tanks: p.tanks, voyagesPerDay: p.voyagesPerDay,
    gilPerVoyage: p.gilPerVoyage, gilPerDay: p.gilPerDay, expPerDay: p.expPerDay,
    kitsPerVoyage: p.kitsPerVoyage, repairGilPerDay: p.repairGilPerDay, repairKitCost,
    wear: p.wear,
    sectors: p.sectors.map((x) => ({
      id: x.sector.id, letter: x.sector.letter, name: x.sector.name, rankReq: x.sector.rankReq, hasData: !!x.data,
      result: x.result || null, bonus: x.bonus || null, exp: x.sector.expReward,
      breakpoints: x.data ? [0, 1, 2, 3, 4].map((i) => calc.breakpoint(x.data, i)) : null,
    })),
    loot: p.loot.map((l) => ({ ...l, name: names.get(l.itemId) || `Item ${l.itemId}`, price: prices.get(l.itemId) || 0,
      note: market && market.notes ? market.notes.get(l.itemId) || null : null })),
  };
}

// A plan, priced on the market when Live Market Prices is on and a place is given ({ place, scope }: a world, data
// center or region by name), else at
// vendor prices. The answer's `pricing` says which, and why not when Universalis couldn't be asked.
async function planPriced(client, request = {}) {
  const vendorPlan = planFor(request);
  if (!vendorPlan.success || !vendorPlan.loot || !request.place || !cache.live) return { ...vendorPlan, pricing: { source: 'vendor' } };
  const scope = ['world', 'dc', 'region'].includes(request.scope) ? request.scope : 'dc';
  try {
    const market = await plannerMarket(client, request.place, scope, vendorPlan.loot.map((l) => l.itemId));
    if (!market) return { ...vendorPlan, pricing: { source: 'vendor' } };
    const plan = planFor(request, market);
    return { ...plan, pricing: { source: 'market', scope, place: market.place, stale: market.stale,
      adjusted: plan.loot ? plan.loot.filter((l) => l.note).length : 0 } };
  } catch (err) {
    return { ...vendorPlan, pricing: { source: 'vendor', error: err.message } };
  }
}

// The Compare page: { builds: [{ rank, parts }] (up to 3), mode: 'same' | 'best', route: [sector ids] (same), mapId,
// rankBy 'exp' | 'gil', maxHours, must, fcId (best: as the Route Finder), place, scope }. Per build: its stats, the
// route it flies (same: the one given, as given; best: its best on the map), whether it can, its plan, and the
// numbers for each row; then which build is best in each row (subs/compare.js).
async function compareFor(client, request = {}) {
  if (!cache) await loadCalculator(client);
  if (!cache || !cache.game || cache.game.missing) return { success: false, error: 'The game data has no sub tables yet.' };
  const { game } = cache;
  const mode = request.mode === 'best' ? 'best' : 'same';
  const builds = (request.builds || []).slice(0, compare.MAX_BUILDS);
  const columns = [];
  let pricing = { source: 'vendor' };
  for (const b of builds) {
    const rank = Number(b.rank);
    const stats = buildStats(rank, b.parts || [], game.stats.rankStatsById, game.stats.partStatsByClassSlot);
    if (!stats) { columns.push({ stats: null, route: [], values: compare.rowValues(null, null, false) }); continue; }
    let route = [];
    let found = null;
    if (mode === 'same') {
      route = (request.route || []).map(Number).filter((id) => game.sectors.has(id)).slice(0, 5);
    } else {
      const r = await routesFor(client, { rank, parts: b.parts, mapId: request.mapId, maxStops: 5, maxHours: Number(request.maxHours) || null,
        must: request.must || [], rankBy: request.rankBy === 'gil' ? 'gil' : 'exp', fcId: request.fcId, place: request.place, scope: request.scope, limit: 1 });
      found = r.success ? r.total : 0;
      route = r.success && r.routes && r.routes[0] ? r.routes[0].route : [];
    }
    const sectors = route.map((id) => game.sectors.get(id));
    const check = compare.routeCheck(sectors, sectors.length ? calc.startFor(sectors[0].id, game.startingPoints) : null, stats, rank);
    const flies = route.length > 0 && check.short === 0 && check.tooHigh.length === 0;
    const plan = route.length ? await planPriced(client, { rank, parts: b.parts, route, place: request.place, scope: request.scope }) : null;
    if (plan && plan.pricing) pricing = plan.pricing;
    columns.push({
      stats, route, found, used: check.used, short: check.short, tooHigh: check.tooHigh, flies,
      sectors: plan && plan.sectors ? plan.sectors.map((s) => ({ id: s.id, letter: s.letter, hasData: s.hasData, result: s.result })) : [],
      values: compare.rowValues(stats, plan && plan.success ? plan : null, flies),
    });
  }
  return { success: true, mode, columns, marks: compare.bestMarks(columns.map((c) => c.values)), pricing };
}

// The Levelling Plan: { subs: [{ key, rank, exp, target, parts, cid }], fcId, maxHours, suggest, standardOnly }. Each
// sub's plan from its rank to its target (subs/levelling.js), only through the sectors the FC has discovered; each
// stage also says when a sector not discovered yet would give a better route.
async function levellingFor(client, request = {}) {
  if (!cache) await loadCalculator(client);
  if (!cache || !cache.game || cache.game.missing) return { success: false, error: 'The game data has no sub tables yet.' };
  const { game } = cache;
  const maxHours = Number(request.maxHours) || null;
  // everySector: as if every sector were discovered (the full-map plan), whatever the FC has read.
  const read = request.everySector ? null : readOf(request.fcId);
  const asked = [];
  const bad = [];
  for (const s of (request.subs || []).slice(0, 8)) {
    const rank = Math.max(1, Number(s.rank) || 1);
    const target = Math.min(game.maxRank, Math.max(rank, Number(s.target) || game.maxRank));
    const parts = (s.parts || []).slice(0, 4);
    if (parts.length !== 4 || parts.some((l) => !CLASS_OF[l])) { bad.push({ key: s.key, error: 'This build has a part the calculator doesn\'t know.' }); continue; }
    const owned = request.suggest && s.cid ? await ownedParts(client, s.cid).catch(() => new Set()) : new Set();
    asked.push({ key: s.key, rank, exp: Number(s.exp) || 0, target, parts, owned: [...owned] });
  }
  const job = { game, data: cache.data, prices: cache.prices, repairKitCost: cache.repairKitCost, read, maxHours,
    suggest: !!request.suggest, standardOnly: !!request.standardOnly, subs: asked };
  const worked = await runLevelling(job);
  if (worked.stopped) return { success: false, stopped: true, error: 'A newer plan was asked for.' };
  if (worked.error) return { success: false, error: worked.error };
  const byKey = new Map([...worked.plans, ...bad].map((p) => [p.key, p]));
  return { success: true, read: !!read, plans: (request.subs || []).slice(0, 8).map((s) => byKey.get(s.key)).filter(Boolean) };
}

// The Levelling Plan is worked out in a worker thread (subs/levelling-worker.js), so the app's other pages aren't held
// up, and a newer request stops the one before it instead of waiting for it. If a worker can't be started, it's worked
// out here.
let levellingWorker = null;
function runLevelling(job) {
  if (levellingWorker) { levellingWorker.stop(); levellingWorker = null; }
  return new Promise((resolve) => {
    let worker;
    try {
      worker = new Worker(path.join(__dirname, '..', 'subs', 'levelling-worker.js'));
    } catch {
      resolve({ plans: levelling.plansFor(job) });
      return;
    }
    let done = false;
    const finish = (answer) => { if (done) return; done = true; if (levellingWorker && levellingWorker.worker === worker) levellingWorker = null; worker.terminate().catch(() => {}); resolve(answer); };
    levellingWorker = { worker, stop: () => finish({ stopped: true }) };
    worker.once('message', (m) => finish(m && m.error ? { error: m.error } : { plans: m.plans }));
    worker.once('error', () => { if (!done) finish({ plans: levelling.plansFor(job) }); });
    worker.postMessage(job);
  });
}

// A part class's letter (Syldra is Y, not S).
const LETTER_OF_CLASS = { Shark: 'S', Unkiu: 'U', Whale: 'W', Coelacanth: 'C', Syldra: 'Y' };

// The parts the player has, as "letter|slot": fitted on their subs or spare in a bag, a retainer or an FC chest.
// cid: only that character's (its subs, its bags and retainers, its Free Company's chest); null for the whole fleet.
async function ownedParts(client, cid = null) {
  const owned = new Set();
  const one = cid !== null && cid !== undefined && cid !== '';
  const subs = await client.query(`SELECT cid, part1, part2, part3, part4 FROM companion_submarine_snapshot WHERE level > 0${one ? ' AND cid = $1' : ''}`, one ? [String(cid)] : []);
  for (const r of subs.rows) [r.part1, r.part2, r.part3, r.part4].forEach((id, slot) => { const l = partLetter(Number(id)); if (CLASS_OF[l]) owned.add(`${l}|${slot}`); });
  const addSpare = (itemId) => {
    const p = sparePartLookup.get(Number(itemId));
    if (!p) return;
    const letter = `${LETTER_OF_CLASS[p.class]}${p.modified ? '+' : ''}`;
    owned.add(`${letter}|${SLOT_KEYS.indexOf(p.slot)}`);
  };
  const bags = await client.query(`SELECT item_id FROM companion_inventory_snapshot
    WHERE quantity > 0 AND (sorted_container BETWEEN 0 AND 3 OR sorted_container BETWEEN 10000 AND 10004)${one ? ' AND owner_cid = $1' : ''}`, one ? [String(cid)] : []);
  for (const r of bags.rows) addSpare(r.item_id);
  let fcFilter = '';
  const fcArgs = [];
  if (one) {
    const { latestCharacter } = await snapshotFragments(client);
    const fc = (await client.query(`SELECT fc_id FROM ${latestCharacter} c WHERE c.cid = $1`, [String(cid)])).rows[0];
    if (!fc || !fc.fc_id) return owned;
    fcFilter = ' AND fc_id = $1';
    fcArgs.push(String(fc.fc_id));
  }
  const chests = await client.query(`SELECT item_id FROM companion_fc_inventory_snapshot WHERE quantity > 0${fcFilter}`, fcArgs);
  for (const r of chests.rows) addSpare(r.item_id);
  return owned;
}

// The Build Finder: { goals: [{ sectorId, tier, optimal, doubleDip, items }], sureOnly, sortBy, forCid, limit }.
// The builds that reach the goals, sorted, the first `limit` of them, and what the goals need.
// slots: the part filter, per slot null (any), { own: true } or { letters: [...] } (subs/build-finder.js filterByParts).
async function findFor(client, { goals = [], sureOnly = false, sortBy = 'rank', forCid = null, slots = null, limit = 200 } = {}) {
  if (!cache) await loadCalculator(client);
  if (!cache || !cache.game || cache.game.missing) return { success: false, error: 'The game data has no sub tables yet.' };
  const { game, data } = cache;
  const sectors = goals.map((g) => game.sectors.get(Number(g.sectorId))).filter(Boolean).slice(0, 5);
  if (!sectors.length) return { success: true, rows: [], total: 0 };
  const dataOf = new Map(data.sectors.map((d) => [d.id, d]));
  const { need, why, missing } = finder.needsFor(goals, dataOf, (id) => (game.sectors.get(Number(id)) || {}).letter || String(id));
  const start = calc.startFor(sectors[0].id, game.startingPoints);
  const route = sectors.length > 1 ? calc.bestOrder(sectors, start, 100) : sectors;
  const minRank = Math.max(1, ...sectors.map((s) => s.rankReq));
  const owned = await ownedParts(client, forCid);
  const all = finder.findBuilds({ need, rankStatsById: game.stats.rankStatsById, partStatsByClassSlot: game.stats.partStatsByClassSlot,
    minRank, maxRank: game.maxRank, route, start, owned, sureOnly, partRank: levelling.partRanks(game.parts) });
  // The part filter applies before the list is cut, so the counts and rank groups follow it.
  const rows = finder.sortBuilds(finder.filterByParts(all, slots, owned), sortBy);
  return {
    unfiltered: all.length,
    success: true, need, why, missing, minRank, route: route.map((s) => s.id), rangeNeeded: calc.rangeUsed(route, start),
    total: rows.length, sure: rows.filter((r) => r.sure).length, outOfRange: rows.filter((r) => r.rangeShort > 0).length,
    // How many builds work from each rank (in range), for the page's group headings.
    byRank: rows.reduce((counts, r) => { if (!(r.rangeShort > 0)) counts[r.rank] = (counts[r.rank] || 0) + 1; return counts; }, {}),
    sectorLetters: sectors.map((s) => s.letter),
    rows: rows.slice(0, Math.max(1, Number(limit) || 200)),
  };
}

ipcMain.handle('get-sub-calculator', () => withClient((client) => loadCalculator(client), (err) => ({ success: false, error: err.message })));
ipcMain.handle('find-sub-builds', (event, request) => withClient((client) => findFor(client, request), (err) => ({ success: false, error: err.message })));
ipcMain.handle('find-sub-routes', (event, request) => withClient((client) => routesFor(client, request), (err) => ({ success: false, error: err.message })));
ipcMain.handle('get-fc-unlocks', (event, fcId) => withClient(async (client) => { if (!cache) await loadCalculator(client); return unlocksFor(fcId); }, (err) => ({ success: false, error: err.message })));
ipcMain.handle('compare-sub-builds', (event, request) => withClient((client) => compareFor(client, request), (err) => ({ success: false, error: err.message })));
ipcMain.handle('plan-sub-levelling', (event, request) => withClient((client) => levellingFor(client, request), (err) => ({ success: false, error: err.message })));
ipcMain.handle('plan-sub-voyage', (event, request) => withClient((client) => planPriced(client, request), (err) => ({ success: false, error: err.message })));

module.exports = { loadCalculator, planFor, planPriced, partLetter, findFor, ownedParts, routesFor, unlocksFor, fcSectors, compareFor, levellingFor };
