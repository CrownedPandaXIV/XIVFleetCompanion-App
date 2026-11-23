// The Sub Calculator's working out: a build and a route in, what the voyage gives out. No Electron or database here,
// so it can be tested on its own (tests/sub-calculator.test.js), and the plugin's SubCalculator.cs does the same.
//
// From the game's files (ffxiv_submarine*): sectors (position, survey time and distance, experience, ceruleum, rank
// needed), ranks and parts (stats, part rank). From subs/calculator-data.json: breakpoints and loot (XIVStats, with
// Pepper's breakpoints beside them). Range, damage and the voyage length are worked out as the SubmarineTracker plugin
// does (MIT licence, by Infi); its damage formula is credited there to a community spreadsheet.

const { voyage } = require('./rank-up');

const FULL_CONDITION = 30000;

// Range a route uses: each leg's straight-line distance × 0.035, rounded down, plus each sector's survey distance.
// The way back doesn't count. sectors: in route order ({ x, y, z, surveyDistance }); start: the map's starting point.
function rangeUsed(sectors, start) {
  if (!sectors.length || !start) return null;
  let total = 0;
  let previous = start;
  for (const s of sectors) {
    total += Math.floor(Math.hypot(previous.x - s.x, previous.y - s.y, previous.z - s.z) * 0.035) + (Number(s.surveyDistance) || 0);
    previous = s;
  }
  return total;
}

function permutations(list) {
  if (list.length <= 1) return [list];
  return list.flatMap((item, i) => permutations([...list.slice(0, i), ...list.slice(i + 1)]).map((rest) => [item, ...rest]));
}

// The order of these sectors that uses the least range (then the shortest voyage), as SubmarineTracker picks it.
function bestOrder(sectors, start, speed, range = null) {
  if (sectors.length <= 1) return sectors;
  let best = null;
  for (const order of permutations(sectors)) {
    const used = rangeUsed(order, start);
    const hours = (voyage(order, start, speed) || {}).hours || 0;
    const fits = range !== null && range !== undefined && used <= range;
    // With the sub's range: the fastest order it can fly (least range on a tie); none fits, or no range given: least range.
    const better = !best || (fits !== best.fits ? fits
      : fits ? hours < best.hours || (hours === best.hours && used < best.used)
        : used < best.used || (used === best.used && hours < best.hours));
    if (better) best = { order, used, hours, fits };
  }
  return best.order;
}

// A breakpoint as a range: the lower and higher of XIVStats' and Pepper's figures (the same when they agree).
// index: 0 T2, 1 T3, 2 normal, 3 optimal, 4 favor.
function breakpoint(dataSector, index) {
  const a = dataSector.xivstats[index];
  const b = dataSector.pepper ? dataSector.pepper[index] : a;
  return { low: Math.min(a, b), high: Math.max(a, b) };
}

// 'yes' at or past both sources' figure, 'maybe' between them, 'no' below both.
function meets(value, bp) {
  if (value >= bp.high) return 'yes';
  if (value >= bp.low) return 'maybe';
  return 'no';
}

// What a build reaches on one sector: the loot tier (1-3), the retrieval ('poor' | 'normal' | 'optimal') and the
// double dip, each with how sure ('yes' | 'maybe'), and how much more of each stat makes it sure.
// For the expected loot a 'maybe' counts as not reached, so the gil is never more than the build can count on.
function sectorResult(dataSector, stats) {
  const t2 = meets(stats.surveillance, breakpoint(dataSector, 0));
  const t3 = meets(stats.surveillance, breakpoint(dataSector, 1));
  const normal = meets(stats.retrieval, breakpoint(dataSector, 2));
  const optimal = meets(stats.retrieval, breakpoint(dataSector, 3));
  const favor = meets(stats.favor, breakpoint(dataSector, 4));
  const tier = t3 !== 'no' ? 3 : t2 !== 'no' ? 2 : 1;
  const retrieval = optimal !== 'no' ? 'optimal' : normal !== 'no' ? 'normal' : 'poor';
  return {
    tier, tierSure: tier === 3 ? t3 : tier === 2 ? t2 : 'yes',
    retrieval, retrievalSure: retrieval === 'optimal' ? optimal : retrieval === 'normal' ? normal : 'yes',
    doubleDip: favor,
    // The tier and retrieval the gil counts on.
    sureTier: t3 === 'yes' ? 3 : t2 === 'yes' ? 2 : 1,
    sureRetrieval: optimal === 'yes' ? 'optimal' : normal === 'yes' ? 'normal' : 'poor',
    need: {
      t2: Math.max(0, breakpoint(dataSector, 0).high - stats.surveillance),
      t3: Math.max(0, breakpoint(dataSector, 1).high - stats.surveillance),
      normal: Math.max(0, breakpoint(dataSector, 2).high - stats.retrieval),
      optimal: Math.max(0, breakpoint(dataSector, 3).high - stats.retrieval),
      favor: Math.max(0, breakpoint(dataSector, 4).high - stats.favor),
    },
  };
}

// Bonus experience on a sector, as Pepper's FFXIV Ship Guide gives it for submarines: optimal retrieval +25% (the
// only one a build is sure of), T2 loot +25%, T3 loot +50%, HQ materials +25% and a double dip +25% (luck), the
// double dip's second roll able to earn the tier's bonus again; at most +100% of the sector's experience.
// { sure, best } in percent: sure counts only what the build is sure to get; best everything it could reach.
function bonusExp(result) {
  const reached = (s) => s === 'yes' || s === 'maybe';
  const tierBonus = result.tier === 3 ? 50 : result.tier === 2 ? 25 : 0;
  const optimal = result.retrieval === 'optimal';
  const best = (optimal ? 25 : 0) + tierBonus + 25 + (reached(result.doubleDip) ? 25 + tierBonus : 0);
  return { sure: optimal && result.retrievalSure === 'yes' ? 25 : 0, best: Math.min(100, best) };
}

const BAND_OF_TIER = { 1: 'Min', 2: 'Mid', 3: 'High' };
const AMOUNT_AT = { poor: [4, 5], normal: [6, 7], optimal: [8, 9] }; // places in a loot entry: low, high

// What one voyage brings back from a sector, on average, from XIVStats' records: of the voyages whose surveillance
// was in the same band, how often each tier came up; within a tier, how often each item; how many at this
// retrieval (the middle of its range); and a second roll as often as voyages meeting the favor breakpoint got one.
// [{ itemId, tier, perVoyage (how many on average), chance (of getting it at all, roughly), low, high }].
function sectorLoot(dataSector, result) {
  const band = BAND_OF_TIER[result.sureTier];
  const pools = Object.entries(dataSector.pools || {});
  const inBand = pools.reduce((sum, [, p]) => sum + (Number(p.stats && p.stats[band]) || 0), 0);
  const favorCount = pools.reduce((sum, [, p]) => sum + (Number(p.stats && p.stats.Favor) || 0), 0);
  const dips = pools.reduce((sum, [, p]) => sum + (Number(p.stats && p.stats.DoubleDips) || 0), 0);
  const rolls = 1 + (result.doubleDip === 'yes' && favorCount > 0 ? dips / favorCount : 0);
  const out = [];
  for (const [tier, pool] of pools) {
    const tierChance = inBand > 0 ? (Number(pool.stats && pool.stats[band]) || 0) / inBand : (tier === '1' ? 1 : 0);
    const [lowAt, highAt] = AMOUNT_AT[result.sureRetrieval];
    for (const item of pool.loot) {
      const itemChance = pool.records > 0 ? item[1] / pool.records : 0;
      const chance = tierChance * itemChance * rolls;
      out.push({ itemId: item[0], tier: Number(tier), chance, low: item[lowAt], high: item[highAt], perVoyage: chance * (item[lowAt] + item[highAt]) / 2 });
    }
  }
  return out;
}

// Condition one sector takes off one part (out of 30,000), as SubmarineTracker predicts it.
function sectorDamage(sectorRankReq, partRank) {
  return Math.max(0, (335 + Number(sectorRankReq) - Number(partRank)) * 7);
}

// The whole plan for a build on a route.
// game: { sectors: Map id -> { id, map, letter, name, rankReq, x, y, z, expReward, surveyMinutes, surveyDistance,
//   tanks }, startingPoints: [sector], parts: [{ class, slot, rank, repairKits }] }
// data: subs/calculator-data.json; stats: buildStats(); partClasses: [class id per slot 0-3];
// prices: Map itemId -> gil; repairKitCost: gil per Magitek repair material.
function plan({ route, stats, partClasses, game, data, prices = new Map(), repairKitCost = 0 }) {
  const sectors = route.map((id) => game.sectors.get(id)).filter(Boolean);
  if (!sectors.length || !stats) return null;
  const start = startFor(sectors[0].id, game.startingPoints);
  const v = voyage(sectors, start, stats.speed) || { exp: 0, hours: 0 };
  const range = rangeUsed(sectors, start);
  const dataOf = new Map((data.sectors || []).map((s) => [s.id, s]));

  const perSector = sectors.map((s) => {
    const d = dataOf.get(s.id);
    if (!d) return { sector: s, data: null };
    const result = sectorResult(d, stats);
    return { sector: s, data: d, result, loot: sectorLoot(d, result), bonus: bonusExp(result) };
  });

  // Loot added up over the route, item by item. chance: of getting it at all on a voyage (any of its sectors; each
  // sector's chance taken as at most 1).
  const byItem = new Map();
  for (const p of perSector) {
    for (const l of p.loot || []) {
      const was = byItem.get(l.itemId) || { itemId: l.itemId, tier: l.tier, sectors: [], perVoyage: 0, low: l.low, high: l.high, miss: 1 };
      was.miss *= 1 - Math.min(1, l.chance);
      if (l.perVoyage > 0 && !was.sectors.includes(p.sector.letter)) was.sectors.push(p.sector.letter);
      was.perVoyage += l.perVoyage;
      was.low = Math.min(was.low, l.low);
      was.high = Math.max(was.high, l.high);
      was.tier = Math.min(was.tier, l.tier);
      byItem.set(l.itemId, was);
    }
  }
  const loot = [...byItem.values()].map(({ miss, ...l }) => ({ ...l, chance: 1 - miss, gil: l.perVoyage * (prices.get(l.itemId) || 0) }))
    .sort((a, b) => b.gil - a.gil || b.perVoyage - a.perVoyage);
  const gilPerVoyage = loot.reduce((sum, l) => sum + l.gil, 0);

  // Wear: each part's condition lost on this voyage, and the repair materials that comes to (a part's repair, spread
  // over the voyages it lasts).
  const partRows = partClasses.map((cls, slot) => game.parts.find((p) => p.class === cls && p.slot === slot) || null);
  const wear = partRows.map((p) => {
    if (!p) return null;
    const lost = sectors.reduce((sum, s) => sum + sectorDamage(s.rankReq, p.rank), 0);
    return { slot: p.slot, lost, voyagesLasting: lost > 0 ? Math.floor(FULL_CONDITION / lost) : null, kitsPerVoyage: (p.repairKits || 0) * lost / FULL_CONDITION };
  });
  const kitsPerVoyage = wear.every(Boolean) ? wear.reduce((sum, w) => sum + w.kitsPerVoyage, 0) : null;
  const perDay = v.hours > 0 ? 24 / v.hours : 0;
  // Experience with bonuses: what the build is sure of, and the most it could get (a sector without data: none).
  const withBonus = (key) => perSector.reduce((sum, p) => sum + p.sector.expReward * (1 + (p.bonus ? p.bonus[key] : 0) / 100), 0);

  return {
    sectors: perSector, start, range, hours: v.hours, exp: v.exp, expSure: withBonus('sure'), expBest: withBonus('best'),
    tanks: sectors.reduce((sum, s) => sum + (Number(s.tanks) || 0), 0),
    loot, gilPerVoyage, gilPerDay: gilPerVoyage * perDay, expPerDay: v.exp * perDay, voyagesPerDay: perDay,
    wear, kitsPerVoyage, repairGilPerDay: kitsPerVoyage === null ? null : kitsPerVoyage * repairKitCost * perDay,
    missingData: perSector.filter((p) => !p.data).map((p) => p.sector),
  };
}

// The starting point of the map a sector is on: the starting point with the highest id at or below it.
function startFor(sectorId, startingPoints) {
  let found = null;
  for (const p of startingPoints) if (p.id <= sectorId && (!found || p.id > found.id)) found = p;
  return found;
}

module.exports = { FULL_CONDITION, rangeUsed, bestOrder, breakpoint, meets, sectorResult, bonusExp, sectorLoot, sectorDamage, plan, startFor };
