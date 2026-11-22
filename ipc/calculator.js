// The Sub Calculator's Planner page: the game's sectors, parts and ranks, the shipped loot and breakpoints
// (subs/calculator-data.json), the player's own subs to start from, and the plan for a build and route
// (subs/calculator.js). The game data is read once per page load and kept for the plans asked for after it.
const { ipcMain } = require('electron');
const { withClient } = require('../db');
const { columnsByKey } = require('./shopping');
const { loadSubmarines, loadStatTables, loadRankUpGameData } = require('./subs');
const { itemNames, itemPrices } = require('./details');
const { repairKitCostFrom, sparePartLookup, SLOT_KEYS } = require('./parts');
const { snapshotFragments } = require('../db');
const finder = require('../subs/build-finder');
const { buildStats, partLetter } = require('../subs/submarine-builds');
const calculatorData = require('../subs/calculator-data');
const calc = require('../subs/calculator');

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
    const s = { id: Number(r.id), letter: r.letter || '', name: r.name || '', map: Number(r.map) || 0, rankReq: Number(r.rankReq) || 0,
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
  const maxRank = Math.max(1, ...[...expToNext.entries()].filter(([, e]) => e > 0).map(([r]) => r + 1));
  return { sectors, startingPoints, maps, parts, stats, maxRank };
}

// The page's starting data: maps, sectors, part classes, the player's subs, and where the loot data is from.
async function loadCalculator(client) {
  const game = await loadGame(client);
  if (game.missing) return { success: true, missingGameData: game.missing };
  const data = calculatorData.load();
  const itemIds = [...new Set(data.sectors.flatMap((s) => Object.values(s.pools).flatMap((p) => p.loot.map((l) => l[0]))))];
  const [names, prices, repairKitCost] = await Promise.all([itemNames(client, itemIds), itemPrices(client, itemIds), repairKitCostFrom(client)]);
  cache = { game, data, names, prices, repairKitCost };

  // The player's subs for the sub picker: who has them (account, character, world, Free Company), their build,
  // route and whether they are out (return_time), in the roster's order.
  let subs = [];
  try {
    const fcNames = new Map();
    try {
      for (const r of (await client.query('SELECT cid, fc_name FROM companion_character_housing')).rows) if (r.fc_name) fcNames.set(String(r.cid), r.fc_name);
    } catch { /* no Free Company names: the picker searches without them */ }
    subs = (await loadSubmarines(client)).map((s) => ({
      cid: String(s.cid), subName: s.sub_name, character: s.character_name || 'Unknown character', world: s.world || '',
      account: s.account_label || '', fc: fcNames.get(String(s.cid)) || '', sortIndex: s.sort_index ?? null,
      rank: s.rank, parts: s.part_letters, routeText: s.current_route || '', returnTime: Number(s.return_time) || 0,
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
        .map((id) => ({ itemId: id, name: names.get(id) || `Item ${id}`, tier: finder.itemTier(d, id) }))
        .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name)) : [];
      return { id: s.id, map: s.map, letter: s.letter, name: s.name, rankReq: s.rankReq, hasData: !!d, items };
    }),
    partLetters: PART_LETTERS.map((letter) => ({ letter, name: partName(letter) })),
    maxRank: game.maxRank,
    subs,
    repairKitCost,
    about: data.about,
  };
}

// One plan: { rank, parts: [hull, stern, bow, bridge letters], route: [sector ids], bestOrder }.
function planFor({ rank, parts, route, bestOrder } = {}) {
  if (!cache) return { success: false, error: 'The calculator is still loading.' };
  const { game, data, names, prices, repairKitCost } = cache;
  const stats = buildStats(Number(rank), parts, game.stats.rankStatsById, game.stats.partStatsByClassSlot);
  if (!stats) return { success: true, stats: null };
  let sectors = (route || []).map((id) => game.sectors.get(Number(id))).filter(Boolean).slice(0, 5);
  if (bestOrder && sectors.length > 1) sectors = calc.bestOrder(sectors, calc.startFor(sectors[0].id, game.startingPoints), stats.speed);
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
    loot: p.loot.map((l) => ({ ...l, name: names.get(l.itemId) || `Item ${l.itemId}`, price: prices.get(l.itemId) || 0 })),
  };
}

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
    const letter = `${p.class[0]}${p.modified ? '+' : ''}`;
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
async function findFor(client, { goals = [], sureOnly = false, sortBy = 'rank', forCid = null, limit = 200 } = {}) {
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
  const rows = finder.sortBuilds(finder.findBuilds({ need, rankStatsById: game.stats.rankStatsById, partStatsByClassSlot: game.stats.partStatsByClassSlot,
    minRank, maxRank: game.maxRank, route, start, owned, sureOnly }), sortBy);
  return {
    success: true, need, why, missing, minRank, route: route.map((s) => s.id), rangeNeeded: calc.rangeUsed(route, start),
    total: rows.length, sure: rows.filter((r) => r.sure).length, outOfRange: rows.filter((r) => r.rangeShort > 0).length,
    rows: rows.slice(0, Math.max(1, Number(limit) || 200)),
  };
}

ipcMain.handle('get-sub-calculator', () => withClient((client) => loadCalculator(client), (err) => ({ success: false, error: err.message })));
ipcMain.handle('find-sub-builds', (event, request) => withClient((client) => findFor(client, request), (err) => ({ success: false, error: err.message })));
ipcMain.handle('plan-sub-voyage', (event, request) => {
  try {
    return planFor(request);
  } catch (err) {
    return { success: false, error: err.message };
  }
});

module.exports = { loadCalculator, planFor, partLetter, findFor, ownedParts };
