// The Sub Calculator's answers (subs/calculator.js, the Planner page's working out) for made-up game data and a set of
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
  if (c.bestOrder && route.length > 1) route = calc.bestOrder(route, calc.startFor(route[0].id, game.startingPoints), stats.speed);
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
    loot: p.loot.map((l) => ({ itemId: l.itemId, tier: l.tier, sectors: l.sectors, perVoyage: r6(l.perVoyage), low: l.low, high: l.high, gil: r6(l.gil) })),
  };
});

console.log(`${answers.length} cases worked out (${answers.reduce((n, a) => n + a.loot.length, 0)} loot lines)`);
const file = process.argv[2];
if (file) {
  fs.writeFileSync(file, JSON.stringify({
    about: 'Written by XIVFleetCompanion-App tests/db/calculator-fixture.js: made-up game data and the app\'s Sub Calculator answers (subs/calculator.js).',
    game: { sectors, ranks, parts }, repairKitCost, priceRule: '(itemId % 97) * 10', cases: answers,
  }));
  console.log(`wrote ${file}`);
}
