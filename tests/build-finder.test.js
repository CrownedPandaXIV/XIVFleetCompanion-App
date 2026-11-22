// The Build Finder (subs/build-finder.js), with figures worked out by hand.
const test = require('node:test');
const assert = require('node:assert');
const finder = require('../subs/build-finder');

// A sector whose XIVStats and Pepper figures differ on T3 (150 / 154), and agree on optimal (160) and favor (90).
const sector = {
  id: 11, xivstats: [100, 150, 120, 160, 90], pepper: [100, 154, 120, 160, 90],
  pools: {
    1: { records: 10, stats: {}, loot: [[1, 5, 0, 0, 1, 1, 1, 1, 1, 1]] },
    2: { records: 10, stats: {}, loot: [[2, 5, 0, 0, 1, 1, 1, 1, 1, 1]] },
    3: { records: 10, stats: {}, loot: [[3, 5, 0, 0, 1, 1, 1, 1, 1, 1], [2, 1, 0, 0, 1, 1, 1, 1, 1, 1]] },
  },
};
const dataOf = new Map([[11, sector]]);

test("an item asks for the lowest tier that drops it", () => {
  assert.strictEqual(finder.itemTier(sector, 1), 1);
  assert.strictEqual(finder.itemTier(sector, 2), 2);
  assert.strictEqual(finder.itemTier(sector, 3), 3);
  assert.strictEqual(finder.itemTier(sector, 99), null);
});

test('goals come down to surveillance, retrieval and favor, as ranges where the sources differ', () => {
  const { need, why } = finder.needsFor([{ sectorId: 11, tier: 0, optimal: true, doubleDip: false, items: [3] }], dataOf, () => 'K');
  assert.deepStrictEqual(need, { surveillance: { low: 150, high: 154 }, retrieval: { low: 160, high: 160 }, favor: null });
  assert.deepStrictEqual(why.surveillance, ['T3 on K']);
  const none = finder.needsFor([{ sectorId: 11, tier: 0, items: [1] }], dataOf);
  assert.deepStrictEqual(none.need, { surveillance: null, retrieval: null, favor: null });
  const unknown = finder.needsFor([{ sectorId: 99, tier: 2 }], dataOf, () => 'Z');
  assert.deepStrictEqual(unknown.missing, ['Z']);
});

// Ranks 1-10 add 10 a rank to everything; every part adds 0 except a hull Y+ (class 10, slot 0), +30 surveillance.
const rankStatsById = new Map();
for (let r = 1; r <= 10; r++) rankStatsById.set(r, { surveillance: 100 + 10 * r, retrieval: 100 + 10 * r, speed: 10 * r, range: 10 * r, favor: 50 + r });
const partStatsByClassSlot = new Map();
for (let cls = 1; cls <= 10; cls++) for (let slot = 0; slot < 4; slot++) {
  partStatsByClassSlot.set(`${cls}|${slot}`, { surveillance: cls === 10 && slot === 0 ? 30 : 0, retrieval: 0, speed: 0, range: 0, favor: 0 });
}

test('each build at the lowest rank reaching the goals; amber where only the lower figure is met', () => {
  const need = { surveillance: { low: 150, high: 154 }, retrieval: null, favor: null };
  const rows = finder.findBuilds({ need, rankStatsById, partStatsByClassSlot, maxRank: 10 });
  assert.strictEqual(rows.length, 10000);
  const plain = rows.find((r) => r.parts.join() === 'S,S,S,S');
  // 100 + 10r ≥ 150 at rank 5 (150: only the lower figure), ≥ 154 at rank 6.
  assert.deepStrictEqual([plain.rank, plain.sure, plain.sureRank, plain.spare.surveillance], [5, false, 6, 0]);
  const strong = rows.find((r) => r.parts.join() === 'Y+,S,S,S');
  // 130 + 10r: 150 at rank 2 (only the lower figure), 160 at rank 3 (sure).
  assert.deepStrictEqual([strong.rank, strong.sure, strong.sureRank, strong.stats.surveillance], [2, false, 3, 150]);
  const sureOnly = finder.findBuilds({ need, rankStatsById, partStatsByClassSlot, maxRank: 10, sureOnly: true });
  assert.strictEqual(sureOnly.find((r) => r.parts.join() === 'S,S,S,S').rank, 6);
});

test('out of range builds are listed with how much range they need and the rank they are in range from', () => {
  const start = { x: 0, y: 0, z: 0, surveyDistance: 0 };
  const far = { x: 1000, y: 0, z: 0, surveyMinutes: 60, surveyDistance: 10 }; // 35 + 10 = 45 range
  const rows = finder.findBuilds({ need: { surveillance: null, retrieval: null, favor: null }, rankStatsById, partStatsByClassSlot,
    minRank: 2, maxRank: 10, route: [far], start, owned: new Set(['S|0', 'S|1']) });
  const r = rows.find((x) => x.parts.join() === 'S,S,S,S');
  assert.deepStrictEqual([r.rank, r.rangeNeeded, r.rangeShort, r.inRangeFrom], [2, 45, 25, 5]);
  assert.ok(r.hours > 0);
  assert.deepStrictEqual(r.missingParts, [{ letter: 'S', slot: 2 }, { letter: 'S', slot: 3 }]);
});

test('sorting: in range first, then by the chosen order', () => {
  const row = (rank, hours, missing, range, short) => ({ rank, hours, missingParts: Array(missing).fill({}), stats: { range }, rangeNeeded: 40, rangeShort: short });
  const rows = [row(5, 10, 0, 50, 0), row(3, 20, 2, 60, 0), row(1, 5, 0, 30, 10), row(4, 8, 1, 45, 0)];
  assert.deepStrictEqual(finder.sortBuilds(rows, 'rank').map((r) => r.rank), [3, 4, 5, 1]);
  assert.deepStrictEqual(finder.sortBuilds(rows, 'speed').map((r) => r.rank), [4, 5, 3, 1]);
  assert.deepStrictEqual(finder.sortBuilds(rows, 'parts').map((r) => r.rank), [5, 4, 3, 1]);
  assert.deepStrictEqual(finder.sortBuilds(rows, 'range').map((r) => r.rank), [3, 5, 4, 1]);
});
