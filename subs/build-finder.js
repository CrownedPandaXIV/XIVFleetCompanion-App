// The Sub Calculator's Build Finder: goals on chosen sectors in, the builds that reach them out. No Electron or
// database here, so it can be tested on its own (tests/build-finder.test.js), and the plugin's BuildFinder.cs does the
// same (checked against the app's answers, tests/db/build-finder-fixture.js).
//
// Goals per sector: a loot tier (2 or 3), optimal retrieval, a double dip, and items (an item asks for the lowest tier
// that drops it there). They come down to three stats: surveillance, retrieval and favor, each needed at the highest
// breakpoint over the sectors. Every build (10 part kinds in each of 4 slots: 10,000) is checked at every rank from
// the highest the sectors need, and listed at the lowest rank that reaches the goals.
//
// Where XIVStats and Pepper's guide disagree a breakpoint is a range (subs/calculator.js breakpoint): a build past
// the lower figure but not the higher is listed in amber ("might not"), with the rank it is sure from.

const calc = require('./calculator');
const { voyage } = require('./rank-up');

const LETTERS = ['S', 'U', 'W', 'C', 'Y', 'S+', 'U+', 'W+', 'C+', 'Y+'];
const CLASS_OF = { W: 1, U: 2, S: 3, C: 4, Y: 5, 'W+': 6, 'U+': 7, 'S+': 8, 'C+': 9, 'Y+': 10 };
const NEEDED = ['surveillance', 'retrieval', 'favor'];
const STAT_KEYS = ['surveillance', 'retrieval', 'speed', 'range', 'favor'];

// The lowest loot tier that drops an item on a sector (1-3), or null when it doesn't drop there.
function itemTier(dataSector, itemId) {
  for (const tier of Object.keys(dataSector.pools || {}).map(Number).sort((a, b) => a - b)) {
    if (dataSector.pools[tier].loot.some((l) => l[0] === Number(itemId))) return tier;
  }
  return null;
}

// What the goals need: for each of surveillance, retrieval and favor, { low, high } (null when nothing asks for it),
// and what asks for it ("T3 on O", "optimal on J"...) to say on the page.
// goals: [{ sectorId, tier (0, 2 or 3), optimal, doubleDip, items: [itemId] }]; dataOf: Map sector id -> data.
function needsFor(goals, dataOf, letterOf = (id) => String(id)) {
  const need = { surveillance: null, retrieval: null, favor: null };
  const why = { surveillance: [], retrieval: [], favor: [] };
  const missing = [];
  const raise = (stat, bp, reason) => {
    const was = need[stat];
    need[stat] = was ? { low: Math.max(was.low, bp.low), high: Math.max(was.high, bp.high) } : { ...bp };
    why[stat].push(reason);
  };
  for (const g of goals) {
    const d = dataOf.get(Number(g.sectorId));
    const letter = letterOf(g.sectorId);
    if (!d) { if (g.tier || g.optimal || g.doubleDip || (g.items || []).length) missing.push(letter); continue; }
    let tier = Number(g.tier) || 0;
    for (const id of g.items || []) tier = Math.max(tier, itemTier(d, id) || 0);
    if (tier >= 3) raise('surveillance', calc.breakpoint(d, 1), `T3 on ${letter}`);
    else if (tier === 2) raise('surveillance', calc.breakpoint(d, 0), `T2 on ${letter}`);
    if (g.optimal) raise('retrieval', calc.breakpoint(d, 3), `optimal on ${letter}`);
    if (g.doubleDip) raise('favor', calc.breakpoint(d, 4), `double dip on ${letter}`);
  }
  return { need, why, missing };
}

// Every build that reaches the needs, each at the lowest rank it does, from minRank (the highest rank the sectors
// need) up to maxRank. route: the sectors in the order using the least range ({ x, y, z, surveyMinutes,
// surveyDistance }); start: its map's starting point; owned: Set of "letter|slot" the player has; sureOnly: list only
// builds sure to reach them (past both sources' figures), at the rank they are sure from.
// Rows: { parts, rank, sure, sureRank, stats, spare, rangeNeeded, rangeShort, inRangeFrom, hours, missingParts }.
function findBuilds({ need, rankStatsById, partStatsByClassSlot, minRank = 1, maxRank, route = [], start = null, owned = null, sureOnly = false }) {
  const ranks = [];
  for (let r = Math.max(1, minRank); r <= maxRank; r++) {
    const s = rankStatsById.get(r);
    if (s && STAT_KEYS.every((k) => s[k] !== null && s[k] !== undefined)) ranks.push([r, s]);
  }
  const rangeNeeded = route.length && start ? calc.rangeUsed(route, start) : null;
  const meets = (stats, which) => NEEDED.every((k) => !need[k] || stats[k] >= need[k][which]);
  const rows = [];
  for (const a of LETTERS) for (const b of LETTERS) for (const c of LETTERS) for (const d of LETTERS) {
    const parts = [a, b, c, d];
    const sum = {};
    let known = true;
    for (const k of STAT_KEYS) sum[k] = 0;
    for (let slot = 0; slot < 4 && known; slot++) {
      const p = partStatsByClassSlot.get(`${CLASS_OF[parts[slot]]}|${slot}`);
      if (!p) { known = false; break; }
      for (const k of STAT_KEYS) {
        if (p[k] === undefined || p[k] === null) { known = false; break; }
        sum[k] += p[k];
      }
    }
    if (!known) continue;
    const statsAt = (s) => {
      // The rank's figure first, then the parts' in slot order, as buildStats adds them.
      const out = {};
      for (const k of STAT_KEYS) out[k] = s[k] + sum[k];
      return out;
    };
    let found = null;
    let sureRank = null;
    for (const [r, s] of ranks) {
      const stats = statsAt(s);
      if (!found && meets(stats, 'low')) found = { rank: r, stats };
      if (meets(stats, 'high')) { sureRank = r; if (!found) found = { rank: r, stats }; break; }
    }
    if (!found) continue;
    if (sureOnly) {
      if (sureRank === null) continue;
      found = { rank: sureRank, stats: statsAt(rankStatsById.get(sureRank)) };
    }
    const { rank, stats } = found;
    const spare = {};
    for (const k of NEEDED) spare[k] = need[k] ? stats[k] - need[k].low : null;
    const rangeShort = rangeNeeded !== null && stats.range < rangeNeeded ? rangeNeeded - stats.range : 0;
    let inRangeFrom = rangeShort ? null : rank;
    if (rangeShort) {
      for (const [r, s] of ranks) if (r > rank && statsAt(s).range >= rangeNeeded) { inRangeFrom = r; break; }
    }
    const v = route.length && start ? voyage(route, start, stats.speed) : null;
    rows.push({
      parts, rank, sure: sureRank !== null && sureRank <= rank, sureRank, stats, spare,
      rangeNeeded, rangeShort, inRangeFrom, hours: v ? v.hours : null,
      missingParts: owned ? parts.map((l, slot) => (owned.has(`${l}|${slot}`) ? null : { letter: l, slot })).filter(Boolean) : null,
    });
  }
  return rows;
}

// The orders the page offers: lowest rank, fastest voyage, fewest parts still needed, most range to spare.
const SORTS = {
  rank: (a, b) => a.rank - b.rank || (a.hours ?? Infinity) - (b.hours ?? Infinity),
  speed: (a, b) => (a.hours ?? Infinity) - (b.hours ?? Infinity) || a.rank - b.rank,
  parts: (a, b) => (a.missingParts ? a.missingParts.length : 0) - (b.missingParts ? b.missingParts.length : 0) || a.rank - b.rank || (a.hours ?? Infinity) - (b.hours ?? Infinity),
  range: (a, b) => (b.stats.range - (b.rangeNeeded || 0)) - (a.stats.range - (a.rangeNeeded || 0)) || a.rank - b.rank,
};

// Sorted (ties kept in build order: S before U ... Y+, hull first), in range before out of range for every order.
function sortBuilds(rows, by = 'rank') {
  const order = SORTS[by] || SORTS.rank;
  return rows.map((r, i) => [r, i]).sort(([a, ai], [b, bi]) => (a.rangeShort > 0) - (b.rangeShort > 0) || order(a, b) || ai - bi).map(([r]) => r);
}

// Keeps the builds whose parts pass the part filter. slots: per slot (hull, stern, bow, bridge) null for any part,
// { own: true } for a part the player has (owned: Set of "letter|slot"), or { letters: [...] } for those parts.
function filterByParts(rows, slots, owned) {
  if (!slots || !slots.some(Boolean)) return rows;
  return rows.filter((r) => r.parts.every((letter, slot) => {
    const f = slots[slot];
    if (!f) return true;
    if (f.own) return !!owned && owned.has(`${letter}|${slot}`);
    return (f.letters || []).includes(letter);
  }));
}

module.exports = { LETTERS, itemTier, needsFor, findBuilds, sortBuilds, filterByParts, SORTS };
