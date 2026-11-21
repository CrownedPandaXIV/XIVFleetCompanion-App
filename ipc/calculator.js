// The Sub Calculator's Planner page: the game's sectors, parts and ranks, the shipped loot and breakpoints
// (subs/calculator-data.json), the player's own subs to start from, and the plan for a build and route
// (subs/calculator.js). The game data is read once per page load and kept for the plans asked for after it.
const { ipcMain } = require('electron');
const { withClient } = require('../db');
const { columnsByKey } = require('./shopping');
const { loadSubmarines, loadStatTables, loadRankUpGameData } = require('./subs');
const { itemNames, itemPrices } = require('./details');
const { repairKitCostFrom } = require('./parts');
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

  let subs = [];
  try {
    subs = (await loadSubmarines(client)).map((s) => ({
      label: `${s.sub_name} (${s.character_name || 'unknown'})`, rank: s.rank, parts: s.part_letters,
      route: Array.from(s.points || []).filter((b) => b > 0),
    })).filter((s) => s.parts.every((p) => CLASS_OF[p]));
  } catch { /* no subs yet: the page still works from scratch */ }

  return {
    success: true,
    maps: game.maps,
    sectors: [...game.sectors.values()].map((s) => ({ id: s.id, map: s.map, letter: s.letter, name: s.name, rankReq: s.rankReq,
      hasData: data.sectors.some((d) => d.id === s.id) })),
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
    range: p.range, hours: p.hours, exp: p.exp, tanks: p.tanks, voyagesPerDay: p.voyagesPerDay,
    gilPerVoyage: p.gilPerVoyage, gilPerDay: p.gilPerDay, expPerDay: p.expPerDay,
    kitsPerVoyage: p.kitsPerVoyage, repairGilPerDay: p.repairGilPerDay, repairKitCost,
    wear: p.wear,
    sectors: p.sectors.map((x) => ({
      id: x.sector.id, letter: x.sector.letter, name: x.sector.name, rankReq: x.sector.rankReq, hasData: !!x.data,
      result: x.result || null,
      breakpoints: x.data ? [0, 1, 2, 3, 4].map((i) => calc.breakpoint(x.data, i)) : null,
    })),
    loot: p.loot.map((l) => ({ ...l, name: names.get(l.itemId) || `Item ${l.itemId}`, price: prices.get(l.itemId) || 0 })),
  };
}

ipcMain.handle('get-sub-calculator', () => withClient((client) => loadCalculator(client), (err) => ({ success: false, error: err.message })));
ipcMain.handle('plan-sub-voyage', (event, request) => {
  try {
    return planFor(request);
  } catch (err) {
    return { success: false, error: err.message };
  }
});

module.exports = { loadCalculator, planFor, partLetter };
