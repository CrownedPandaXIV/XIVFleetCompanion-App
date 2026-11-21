// The Sub Calculator's working out (subs/calculator.js), with figures worked out by hand.
const test = require('node:test');
const assert = require('node:assert');
const calc = require('../subs/calculator');
const { load } = require('../subs/calculator-data');

const start = { id: 10, x: 0, y: 0, z: 0, surveyDistance: 0 };
const a = { id: 11, letter: 'A', name: 'Alpha', rankReq: 90, x: 300, y: 400, z: 0, expReward: 1000, surveyMinutes: 60, surveyDistance: 10, tanks: 2 };
const b = { id: 12, letter: 'B', name: 'Bravo', rankReq: 100, x: 300, y: 1400, z: 0, expReward: 2000, surveyMinutes: 120, surveyDistance: 12, tanks: 3 };

test('range used: each leg × 0.035 rounded down, plus each survey distance; not the way back', () => {
  // start→A is 500 (17.5 → 17) + 10; A→B is 1000 (35) + 12.
  assert.strictEqual(calc.rangeUsed([a, b], start), 17 + 10 + 35 + 12);
  assert.strictEqual(calc.rangeUsed([], start), null);
});

test('best order: the one using the least range', () => {
  // B first: start→B is hypot(300, 1400) = 1431.8 (50) + 12, B→A 1000 (35) + 10 = 107, against 74 A first.
  assert.deepStrictEqual(calc.bestOrder([b, a], start, 100).map((s) => s.letter), ['A', 'B']);
});

test('damage per sector, as SubmarineTracker predicts it', () => {
  assert.strictEqual(calc.sectorDamage(100, 50), (335 + 100 - 50) * 7);
  assert.strictEqual(calc.sectorDamage(1, 1000), 0);
});

// A sector with XIVStats' breakpoints and Pepper's a little different on T3 and favor.
const dataSector = {
  id: 11, xivstats: [100, 150, 120, 160, 90], pepper: [100, 154, 120, 160, 85], seen: null,
  pools: {
    1: { records: 100, stats: { Min: 60, Mid: 20, High: 20, Favor: 50, DoubleDips: 25 }, loot: [[1, 75, 0, 0, 1, 3, 3, 5, 5, 7], [2, 25, 0, 0, 10, 10, 20, 20, 30, 30]] },
    2: { records: 30, stats: { Min: 0, Mid: 20, High: 10, Favor: 20, DoubleDips: 10 }, loot: [[3, 30, 0, 0, 1, 1, 2, 2, 3, 3]] },
    3: { records: 20, stats: { Min: 0, Mid: 0, High: 20, Favor: 10, DoubleDips: 5 }, loot: [[4, 20, 0, 0, 1, 1, 1, 1, 1, 1]] },
  },
};

test('breakpoints where the sources differ are a range, and a stat between them is a maybe', () => {
  assert.deepStrictEqual(calc.breakpoint(dataSector, 1), { low: 150, high: 154 });
  const r = calc.sectorResult(dataSector, { surveillance: 152, retrieval: 130, favor: 87 });
  assert.strictEqual(r.tier, 3);
  assert.strictEqual(r.tierSure, 'maybe');
  assert.strictEqual(r.sureTier, 2);
  assert.strictEqual(r.retrieval, 'normal');
  assert.strictEqual(r.retrievalSure, 'yes');
  assert.strictEqual(r.doubleDip, 'maybe');
  assert.deepStrictEqual(r.need, { t2: 0, t3: 2, normal: 0, optimal: 30, favor: 3 });
});

test('expected loot from the records of voyages in the same surveillance band', () => {
  // Surveillance 152 counts as T2 (Mid band: 20 + 20 + 0 voyages): tier 1 half the time, tier 2 half. No double dip
  // (favor is only a maybe). Normal retrieval: item 1 gives 3-5, item 2 20, item 3 2.
  const loot = calc.sectorLoot(dataSector, calc.sectorResult(dataSector, { surveillance: 152, retrieval: 130, favor: 87 }));
  const of = (id) => loot.find((l) => l.itemId === id);
  assert.ok(Math.abs(of(1).chance - 0.5 * 0.75) < 1e-9 && Math.abs(of(1).perVoyage - 0.375 * 4) < 1e-9);
  assert.ok(Math.abs(of(2).perVoyage - 0.5 * 0.25 * 20) < 1e-9);
  assert.ok(Math.abs(of(3).perVoyage - 0.5 * 1 * 2) < 1e-9);
  assert.strictEqual(of(4).perVoyage, 0);
  // With favor met: a second roll half as often again (40 double dips out of 80 voyages meeting favor).
  const dipped = calc.sectorLoot(dataSector, calc.sectorResult(dataSector, { surveillance: 152, retrieval: 130, favor: 90 }));
  assert.ok(Math.abs(dipped.find((l) => l.itemId === 1).perVoyage - 0.375 * 4 * 1.5) < 1e-9);
});

test('a whole plan: range, ceruleum, gil, wear and repair cost', () => {
  const game = {
    sectors: new Map([[11, a], [12, b]]), startingPoints: [start],
    parts: [0, 1, 2, 3].map((slot) => ({ class: 1, slot, rank: 80, repairKits: 3 })),
  };
  const data = { sectors: [dataSector] };
  const p = calc.plan({ route: [11, 12], stats: { surveillance: 152, retrieval: 130, speed: 100, range: 80, favor: 87 },
    partClasses: [1, 1, 1, 1], game, data, prices: new Map([[1, 100], [2, 10]]), repairKitCost: 2000 });
  assert.strictEqual(p.range, 74);
  assert.strictEqual(p.tanks, 5);
  assert.strictEqual(p.exp, 3000);
  assert.deepStrictEqual(p.missingData.map((s) => s.letter), ['B']);
  assert.ok(Math.abs(p.gilPerVoyage - (0.375 * 4 * 100 + 0.125 * 20 * 10)) < 1e-9);
  // Each part: (335 + 90 - 80) × 7 + (335 + 100 - 80) × 7 = 2415 + 2485 = 4900 a voyage; lasts 6 voyages.
  assert.deepStrictEqual(p.wear.map((w) => [w.lost, w.voyagesLasting]), [[4900, 6], [4900, 6], [4900, 6], [4900, 6]]);
  assert.ok(Math.abs(p.kitsPerVoyage - 4 * 3 * 4900 / 30000) < 1e-9);
  assert.ok(Math.abs(p.repairGilPerDay - p.kitsPerVoyage * 2000 * 24 / p.hours) < 1e-6);
});

test("on the real data, a sector's tier chances add up and a T3 build sees T3 loot", () => {
  const bottom = load().sectors.find((s) => s.id === 28);
  const low = calc.sectorLoot(bottom, calc.sectorResult(bottom, { surveillance: 100, retrieval: 100, favor: 0 }));
  const high = calc.sectorLoot(bottom, calc.sectorResult(bottom, { surveillance: 200, retrieval: 250, favor: 200 }));
  const byTier = (loot, t) => loot.filter((l) => l.tier === t).reduce((s, l) => s + l.chance, 0);
  assert.ok(Math.abs(byTier(low, 1) + byTier(low, 2) + byTier(low, 3) - 1) < 1e-9);
  assert.ok(byTier(high, 3) > 0 && byTier(low, 3) < byTier(high, 3));
});
