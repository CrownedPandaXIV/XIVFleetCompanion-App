// The Sub Calculator's answers (subs/calculator.js, the Planner page's working out, and subs/build-finder.js, the Build Finder's) for made-up game data and a set of
// builds and routes, for the plugin's own working out (its SubCalculator.cs) to be checked against. The loot and
// breakpoints are the shipped subs/calculator-data.json, as both sides ship the same file.
//
//   node tests/db/calculator-fixture.js ../XIVFleetCompanion/tests/FleetWriterTests/calculator-fixture.json
//
// Without a file it only checks that every case works out. No database is needed.
const fs = require('fs');
const calc = require('../../subs/calculator');
const { buildStats } = require('../../subs/submarine-builds');
const { load } = require('../../subs/calculator-data');

// A small repeatable random number source, so the made-up game data is the same every run.
let seed = 20261121;
const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

// Two maps: starting point 0 then sectors 1-30, starting point 31 then sectors 32-41 (the ids the data uses).
const sectors = [];
const add = (id, map, starting) => sectors.push({
  id, map, starting, location: starting ? '' : `S${id}`, name: starting ? '' : `Made-up sector ${id}`,
  x: starting ? 0 : int(-1200, 1200), y: starting ? 0 : int(-1200, 1200), z: starting ? 0 : int(-200, 200),
  expReward: starting ? 0 : int(5000, 40000), surveyMinutes: starting ? 0 : int(10, 120),
  rankReq: starting ? 0 : int(1, 120), surveyDistance: starting ? 0 : int(5, 20), tanks: starting ? 0 : int(1, 4),
});
add(0, 1, true);
for (let id = 1; id <= 30; id++) add(id, 1, false);
add(31, 2, true);
for (let id = 32; id <= 41; id++) add(id, 2, false);

const ranks = [];
for (let id = 1; id <= 125; id++) {
  ranks.push({ id, surveillance: 20 + id, retrieval: 25 + id, speed: 10 + Math.floor(id / 2), range: 15 + Math.floor(id / 3), favor: 10 + Math.floor(id * 0.8) });
}
const parts = [];
for (let cls = 1; cls <= 10; cls++) {
  for (let slot = 0; slot <= 3; slot++) {
    parts.push({ class: cls, slot, surveillance: int(0, 40), retrieval: int(0, 40), speed: int(0, 40), range: int(0, 40), favor: int(0, 40),
      rank: int(1, 120), repairKits: int(2, 6) });
  }
}

const rankStatsById = new Map(ranks.map((r) => [r.id, { surveillance: r.surveillance, retrieval: r.retrieval, speed: r.speed, range: r.range, favor: r.favor }]));
const partStatsByClassSlot = new Map(parts.map((p) => [`${p.class}|${p.slot}`, { surveillance: p.surveillance, retrieval: p.retrieval, speed: p.speed, range: p.range, favor: p.favor }]));
const game = {
  sectors: new Map(sectors.filter((s) => !s.starting).map((s) => [s.id, { ...s, letter: s.location }])),
  startingPoints: sectors.filter((s) => s.starting),
  parts: parts.map((p) => ({ class: p.class, slot: p.slot, rank: p.rank, repairKits: p.repairKits })),
};
const CLASS_OF = { W: 1, U: 2, S: 3, C: 4, Y: 5, 'W+': 6, 'U+': 7, 'S+': 8, 'C+': 9, 'Y+': 10 };
const data = load();
const price = (id) => (id % 97) * 10;
const itemIds = [...new Set(data.sectors.flatMap((s) => Object.values(s.pools).flatMap((p) => p.loot.map((l) => l[0]))))];
const prices = new Map(itemIds.map((id) => [id, price(id)]));
const repairKitCost = 1500;

const LETTERS = Object.keys(CLASS_OF);
const cases = [
  { rank: 100, parts: ['W+', 'C+', 'W+', 'C+'], route: [15, 18, 10, 26, 13], bestOrder: false },
  { rank: 100, parts: ['W+', 'C+', 'W+', 'C+'], route: [15, 18, 10, 26, 13], bestOrder: true },
  { rank: 1, parts: ['S', 'S', 'S', 'S'], route: [1], bestOrder: false },
  { rank: 125, parts: ['Y+', 'Y+', 'Y+', 'Y+'], route: [32, 35, 40], bestOrder: true },
  { rank: 60, parts: ['S', 'U', 'W', 'C'], route: [2, 30, 5, 9], bestOrder: false },
];
for (let i = 0; i < 25; i++) {
  const map = rand() < 0.75 ? 1 : 2;
  const pool = map === 1 ? Array.from({ length: 30 }, (_, k) => k + 1) : Array.from({ length: 10 }, (_, k) => k + 32);
  const route = [];
  const n = int(1, 5);
  while (route.length < n) { const id = pool[int(0, pool.length - 1)]; if (!route.includes(id)) route.push(id); }
  cases.push({ rank: int(1, 125), parts: [0, 1, 2, 3].map(() => LETTERS[int(0, LETTERS.length - 1)]), route, bestOrder: rand() < 0.5 });
}

const r6 = (v) => (v === null || v === undefined ? null : Math.round(v * 1e6) / 1e6);
const answers = cases.map((c) => {
  const stats = buildStats(c.rank, c.parts, rankStatsById, partStatsByClassSlot);
  let route = c.route.map((id) => game.sectors.get(id));
  if (c.bestOrder && route.length > 1) route = calc.bestOrder(route, calc.startFor(route[0].id, game.startingPoints), stats.speed, stats.range);
  const p = calc.plan({ route: route.map((s) => s.id), stats, partClasses: c.parts.map((l) => CLASS_OF[l]), game, data, prices, repairKitCost });
  if (!p) throw new Error(`no plan for ${JSON.stringify(c)}`);
  return {
    ...c, stats, order: route.map((s) => s.id),
    range: p.range, hours: r6(p.hours), exp: p.exp, expSure: r6(p.expSure), expBest: r6(p.expBest), tanks: p.tanks,
    gilPerVoyage: r6(p.gilPerVoyage), gilPerDay: r6(p.gilPerDay), voyagesPerDay: r6(p.voyagesPerDay),
    kitsPerVoyage: r6(p.kitsPerVoyage), repairGilPerDay: r6(p.repairGilPerDay),
    wear: p.wear.map((w) => (w ? { slot: w.slot, lost: w.lost, voyagesLasting: w.voyagesLasting, kitsPerVoyage: r6(w.kitsPerVoyage) } : null)),
    sectors: p.sectors.map((s) => ({ id: s.sector.id, result: s.result || null, bonus: s.bonus || null })),
    missingData: p.missingData.map((s) => s.id),
    loot: p.loot.map((l) => ({ itemId: l.itemId, tier: l.tier, sectors: l.sectors, perVoyage: r6(l.perVoyage), chance: r6(l.chance), low: l.low, high: l.high, gil: r6(l.gil) })),
  };
});

// The Build Finder's answers: goals on sectors (sector ids the data has), what they need, and the builds sorted each way
// (the first 25 of each), against the same made-up game.
const finder = require('../../subs/build-finder');
const dataOf = new Map(data.sectors.map((d) => [d.id, d]));
const someItem = (id, tier) => { const d = dataOf.get(id); return d && d.pools[tier] && d.pools[tier].loot.length ? d.pools[tier].loot[0][0] : null; };
const finderGoals = [
  [{ sectorId: 15, tier: 3, optimal: false, doubleDip: false, items: [] }],
  [{ sectorId: 15, tier: 2, optimal: true, doubleDip: false, items: [] }, { sectorId: 18, tier: 0, optimal: false, doubleDip: true, items: [] }],
  [{ sectorId: 10, tier: 0, optimal: false, doubleDip: false, items: [someItem(10, 3)].filter(Boolean) }, { sectorId: 26, tier: 0, optimal: true, doubleDip: true, items: [] }],
  [{ sectorId: 32, tier: 3, optimal: true, doubleDip: true, items: [] }, { sectorId: 35, tier: 2, optimal: false, doubleDip: false, items: [] }, { sectorId: 40, tier: 0, optimal: false, doubleDip: false, items: [] }],
  [{ sectorId: 1, tier: 0, optimal: false, doubleDip: false, items: [] }],
];
const owned = new Set(['W+|0', 'C+|1', 'W+|2', 'C+|3', 'S|0', 'Y|1', 'U+|2']);
const partFilter = [{ letters: ['S', 'S+', 'W+'] }, null, { own: true }, null];
const finderAnswers = [];
for (const goals of finderGoals) {
  for (const sureOnly of [false, true]) {
    const sectorsHere = goals.map((g) => game.sectors.get(g.sectorId));
    const start = calc.startFor(sectorsHere[0].id, game.startingPoints);
    const route = sectorsHere.length > 1 ? calc.bestOrder(sectorsHere, start, 100) : sectorsHere;
    const { need, why, missing } = finder.needsFor(goals, dataOf, (id) => game.sectors.get(id).letter);
    const minRank = Math.max(1, ...sectorsHere.map((s) => s.rankReq));
    const rows = finder.findBuilds({ need, rankStatsById, partStatsByClassSlot, minRank, maxRank: 125, route, start, owned, sureOnly });
    const sorted = {};
    for (const by of Object.keys(finder.SORTS)) {
      sorted[by] = finder.sortBuilds(rows, by).slice(0, 25).map((r) => ({ parts: r.parts, rank: r.rank, sure: r.sure, sureRank: r.sureRank, stats: r.stats, spare: r.spare,
        rangeShort: r.rangeShort, inRangeFrom: r.inRangeFrom, hours: r6(r.hours), missing: r.missingParts.map((m) => `${m.letter}|${m.slot}`) }));
    }
    // The part filter: hull Shark, Modified Shark or Modified Whale, and a bow the player owns.
    const kept = finder.sortBuilds(finder.filterByParts(rows, partFilter, owned), 'rank');
    finderAnswers.push({ goals, sureOnly, route: route.map((s) => s.id), need, why, missing, minRank, rangeNeeded: calc.rangeUsed(route, start),
      total: rows.length, sure: rows.filter((r) => r.sure).length, outOfRange: rows.filter((r) => r.rangeShort > 0).length, sorted,
      filtered: { total: kept.length, first: kept.slice(0, 25).map((r) => r.parts.join('|')) } });
  }
}

// The Route Finder's answers (subs/route-finder.js): routes for builds on each map, with an FC's reading, musts, a
// voyage limit, ranked each way; the unlocks of that reading; and Fight Club routes checked against it.
const rf = require('../../subs/route-finder');
const openerOf = new Map([...game.sectors.keys()].map((id) => [id, dataOf.has(id) ? Number(dataOf.get(id).unlockedFrom) || 0 : 0]));
// Explored 1-12 and 32-34, discovered 13, 14 and 35; the rest not.
const read = new Map([...game.sectors.keys()].map((id) => [id, { unlocked: id <= 14 || (id >= 32 && id <= 35), explored: id <= 12 || (id >= 32 && id <= 34) }]));
const states = rf.sectorStates([...game.sectors.keys()], read, openerOf);
const routeCases = [
  { rank: 125, parts: ['W+', 'C+', 'W+', 'C+'], mapId: 1, maxStops: 5, maxHours: null, must: [], leaveOut: [], rankBy: 'exp', itemId: null, read: false, exploreFirst: false },
  { rank: 125, parts: ['W+', 'C+', 'W+', 'C+'], mapId: 1, maxStops: 4, maxHours: 72, must: [], leaveOut: [3], rankBy: 'gil', itemId: null, read: true, exploreFirst: false },
  { rank: 90, parts: ['S+', 'U+', 'W+', 'C+'], mapId: 1, maxStops: 5, maxHours: 60, must: [8], leaveOut: [], rankBy: 'exp', itemId: null, read: true, exploreFirst: true },
  { rank: 110, parts: ['Y+', 'Y+', 'Y+', 'Y+'], mapId: 2, maxStops: 5, maxHours: null, must: [], leaveOut: [], rankBy: 'item', itemId: someItem(32, 1) || someItem(33, 1), read: false, exploreFirst: false },
  { rank: 60, parts: ['S', 'U', 'W', 'C'], mapId: 2, maxStops: 3, maxHours: 48, must: [], leaveOut: [], rankBy: 'gil', itemId: null, read: true, exploreFirst: true },
];
const routeAnswers = routeCases.map((c) => {
  const stats = buildStats(c.rank, c.parts, rankStatsById, partStatsByClassSlot);
  const onMap = [...game.sectors.values()].filter((x) => x.map === c.mapId).sort((a, b) => a.id - b.id);
  const st = c.read ? states : rf.sectorStates([...game.sectors.keys()], null, openerOf);
  const allowed = rf.usableSectors({ onMap, rank: c.rank, states: st, leaveOut: c.leaveOut });
  const values = new Map(onMap.map((x) => [x.id, rf.sectorValue(x, dataOf.get(x.id), stats, prices)]));
  const routes = rf.findRoutes({ sectors: allowed, start: calc.startFor(onMap[0].id, game.startingPoints), stats, maxStops: c.maxStops, maxHours: c.maxHours,
    must: c.must, values, rankBy: c.rankBy, itemId: c.itemId, opens: rf.opensOf(openerOf), states: st, exploreFirst: c.exploreFirst });
  return { ...c, allowed: allowed.map((x) => x.id), total: routes.length,
    first: routes.slice(0, 30).map((r) => ({ route: r.route, hours: r6(r.hours), range: r.range, exp: r6(r.exp), expPerHour: r6(r.expPerHour),
      gilPerVoyage: r6(r.gilPerVoyage), gilPerDay: r6(r.gilPerDay), itemPerDay: r6(r.itemPerDay), explores: r.explores, chances: r.chances })) };
});
const maps = [1, 2].map((id) => ({ id, name: `Map ${id}` }));
const unlocksAnswer = rf.unlocks({ sectors: [...game.sectors.values()].sort((a, b) => a.id - b.id), maps, states, openerOf });
// The same FC before the second map opened: the way there, from the first map.
const readEarly = new Map([...read.entries()].map(([id, r]) => [id, id >= 32 ? { unlocked: false, explored: false } : r]));
const unlocksEarly = rf.unlocks({ sectors: [...game.sectors.values()].sort((a, b) => a.id - b.id), maps,
  states: rf.sectorStates([...game.sectors.keys()], readEarly, openerOf), openerOf });
const { fightClubOptions, bestOf } = require('../../subs/submarine-builds');
// Fight Club writes routes as the game's letters (A-Z, then AA...): the made-up maps get them in id order.
const gameLetter = (i) => (i < 26 ? String.fromCharCode(65 + i) : `A${String.fromCharCode(65 + i - 26)}`);
const letterMaps = [1, 2].map((id) => ({ id, byLetter: new Map([...game.sectors.values()].filter((x) => x.map === id).sort((a, b) => a.id - b.id).map((x, i) => [gameLetter(i), x.id])) }));
// M (13) discovered; R, O and Z (18, 15, 26) not: MROJZ can't be run yet.
const fightClubRows = [
  { route: 'MROJZ', hours: 24, repair_times: '10', gil_sub_day: 320000, rec_build_notes: '90: WWWW' },
  { route: 'BCMN', hours: 24, repair_times: '', gil_sub_day: 260000, rec_build_notes: '86: W+C+W+C+' },
  { route: 'JEB', hours: 12, repair_times: '8', gil_sub_day: 200000, rec_build_notes: '85: SSSS' },
  { route: 'ZAAAB', hours: 24, repair_times: '', gil_sub_day: 400000, rec_build_notes: '95: UUUU' },
];
const fightClubAnswers = [85, 88, 90, 99].map((rank) => {
  const check = rf.fightClubCheck({ options: fightClubOptions(fightClubRows, repairKitCost), rank, maps: letterMaps, read, bestOf });
  return { rank, best: check.best ? check.best.row.route : null, missing: check.missing, alt: check.alt ? check.alt.row.route : null };
});

// Compare's answers (subs/compare.js): builds on one route as given, and each on its own best route on a map (through
// the FC's reading above), with the numbers for each row and the best in each.
const cmp = require('../../subs/compare');
const compareCases = [
  { mode: 'same', route: [1, 9], builds: [{ rank: 125, parts: ['W+', 'C+', 'W+', 'C+'] }, { rank: 60, parts: ['S', 'U', 'W', 'C'] }, { rank: 1, parts: ['S', 'S', 'S', 'S'] }] },
  { mode: 'same', route: [32, 35, 40], builds: [{ rank: 90, parts: ['S+', 'U+', 'W+', 'C+'] }, { rank: 125, parts: ['Y+', 'Y+', 'Y+', 'Y+'] }] },
  { mode: 'best', mapId: 1, rankBy: 'exp', maxHours: 48, must: [], builds: [{ rank: 125, parts: ['W+', 'C+', 'W+', 'C+'] }, { rank: 90, parts: ['S+', 'U+', 'W+', 'C+'] }, { rank: 40, parts: ['S', 'U', 'W', 'C'] }] },
  { mode: 'best', mapId: 2, rankBy: 'gil', maxHours: null, must: [35], builds: [{ rank: 110, parts: ['Y+', 'Y+', 'Y+', 'Y+'] }, { rank: 125, parts: ['W+', 'C+', 'W+', 'C+'] }] },
];
const compareAnswers = compareCases.map((c) => {
  const columns = c.builds.map((b) => {
    const stats = buildStats(b.rank, b.parts, rankStatsById, partStatsByClassSlot);
    let route = c.route || [];
    if (c.mode === 'best') {
      const onMap = [...game.sectors.values()].filter((x) => x.map === c.mapId).sort((x, y) => x.id - y.id);
      const allowed = rf.usableSectors({ onMap, rank: b.rank, states, leaveOut: [] });
      const values = new Map(onMap.map((x) => [x.id, rf.sectorValue(x, dataOf.get(x.id), stats, prices)]));
      const routes = c.must.every((id) => allowed.some((x) => x.id === id)) ? rf.findRoutes({ sectors: allowed, start: calc.startFor(onMap[0].id, game.startingPoints), stats,
        maxStops: 5, maxHours: c.maxHours, must: c.must, values, rankBy: c.rankBy, opens: rf.opensOf(openerOf), states }) : [];
      route = routes.length ? routes[0].route : [];
    }
    const sectorsHere = route.map((id) => game.sectors.get(id));
    const check = cmp.routeCheck(sectorsHere, sectorsHere.length ? calc.startFor(sectorsHere[0].id, game.startingPoints) : null, stats, b.rank);
    const flies = route.length > 0 && check.short === 0 && check.tooHigh.length === 0;
    const p = route.length ? calc.plan({ route, stats, partClasses: b.parts.map((l) => CLASS_OF[l]), game, data, prices, repairKitCost }) : null;
    const values = cmp.rowValues(stats, p, flies);
    return { route, used: check.used, short: check.short, tooHigh: check.tooHigh, flies, values: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, r6(v)])) };
  });
  return { ...c, columns, marks: cmp.bestMarks(columns.map((col) => col.values)) };
});

// The Levelling Plan's answers (subs/levelling.js): subs from a rank to a target, with and without the FC's reading,
// keeping the build or with swaps suggested (Standard parts only in one), on made-up experience a rank.
const lv = require('../../subs/levelling');
const expToNext = new Map(ranks.map((r) => [r.id, r.id < 125 ? 30000 + r.id * 2500 : 0]));
const lvGame = { ...game, maps: [1, 2].map((id) => ({ id, name: `Map ${id}` })), stats: { rankStatsById, partStatsByClassSlot } };
const lvOwned = ['W+|0', 'C|1', 'U+|2'];
const levellingCases = [
  { rank: 20, exp: 500, target: 45, parts: ['S', 'U', 'W', 'C'], read: false, maxHours: 24, suggest: false, standardOnly: false },
  { rank: 40, exp: 0, target: 80, parts: ['W+', 'C+', 'W+', 'C+'], read: true, maxHours: 36, suggest: true, standardOnly: false },
  { rank: 70, exp: 1200, target: 100, parts: ['S', 'S', 'S', 'S'], read: true, maxHours: 24, suggest: true, standardOnly: true },
  { rank: 100, exp: 0, target: 125, parts: ['Y+', 'Y+', 'Y+', 'Y+'], read: false, maxHours: 48, suggest: true, standardOnly: false },
];
const lvSearch = new Map();
const lvSearchFor = (withRead, maxHours) => {
  const k = `${withRead}|${maxHours}`;
  if (!lvSearch.has(k)) lvSearch.set(k, lv.searches({ game: lvGame, data, prices, repairKitCost, read: withRead ? read : null, maxHours }));
  return lvSearch.get(k);
};
const levellingAnswers = levellingCases.map((c) => {
  const search = lvSearchFor(c.read, c.maxHours);
  const plan = lv.levellingPlan({ rank: c.rank, exp: c.exp, target: c.target, expToNext, parts: c.parts, bestAt: search.bestAt, score: search.score,
    suggest: c.suggest, standardOnly: c.standardOnly, owned: new Set(lvOwned) });
  if (c.read) lv.markBetter(plan, lvSearchFor(false, c.maxHours), read);
  return { ...c, voyages: plan.voyages, hours: r6(plan.hours), tanks: plan.tanks, kits: r6(plan.kits), expNeeded: plan.expNeeded, reached: plan.reached, stuckAt: plan.stuckAt,
    keepHours: r6(plan.keepHours), swaps: plan.swaps.map((x) => ({ atRank: x.atRank, slot: x.slot, from: x.from, to: x.to, owned: x.owned, gain: r6(x.gain), savedHours: r6(x.savedHours) })),
    stages: plan.stages.map((st) => ({ fromRank: st.fromRank, toRank: st.toRank, route: st.route, parts: st.parts, voyages: st.voyages, hours: r6(st.hours),
      expPerVoyage: r6(st.expPerVoyage), expPerHour: r6(st.expPerHour), tanks: st.tanks, kits: r6(st.kits),
      better: st.better ? { route: st.better.route, expPerHour: r6(st.better.expPerHour), missing: st.better.missing } : null })) };
});

console.log(`${answers.length} cases worked out (${answers.reduce((n, a) => n + a.loot.length, 0)} loot lines); Build Finder: ${finderAnswers.map((f) => f.total).join(', ')} builds; Route Finder: ${routeAnswers.map((r) => r.total).join(', ')} routes; Fight Club: ${JSON.stringify(fightClubAnswers)}; Levelling: ${levellingAnswers.map((a) => `${a.voyages} voyages, ${a.stages.length} stages, ${a.swaps.length} swaps${a.reached ? '' : ` (stuck at ${a.stuckAt})`}`).join(' | ')}; Compare: ${compareAnswers.map((a) => a.columns.map((col) => (col.flies ? col.route.join('-') : `x${col.short}`)).join(' / ')).join(' | ')}`);
const file = process.argv[2];
if (file) {
  fs.writeFileSync(file, JSON.stringify({
    about: 'Written by XIVFleetCompanion-App tests/db/calculator-fixture.js: made-up game data and the app\'s Sub Calculator answers (subs/calculator.js).',
    game: { sectors, ranks, parts }, repairKitCost, priceRule: '(itemId % 97) * 10', cases: answers,
    finder: { owned: [...owned], partFilter, cases: finderAnswers },
    routeFinder: { read: [...read.entries()].map(([id, r]) => ({ id, unlocked: r.unlocked, explored: r.explored })), openerOf: [...openerOf.entries()],
      cases: routeAnswers, unlocks: [{ read: 'all', maps, ...unlocksAnswer }, { read: 'early', maps, ...unlocksEarly }],
      fightClub: { rows: fightClubRows, maps: letterMaps.map((m) => ({ id: m.id, letters: [...m.byLetter.entries()] })), cases: fightClubAnswers } },
    compare: { cases: compareAnswers },
    levelling: { expToNext: [...expToNext.entries()], owned: lvOwned, cases: levellingAnswers },
  }));
  console.log(`wrote ${file}`);
}
