// Sub Calculator → Compare (subs/compare.js): whether a build can fly a route, the numbers each row shows, and which
// build is best in each row.
const test = require('node:test');
const assert = require('node:assert');
const cmp = require('../subs/compare');

const stats = (range, extra = {}) => ({ surveillance: 100, retrieval: 90, speed: 80, range, favor: 70, ...extra });
const plan = (over = {}) => ({ range: 40, hours: 20, expSure: 1000, voyagesPerDay: 1.2, gilPerVoyage: 50000, gilPerDay: 60000,
  kitsPerVoyage: 2, repairGilPerDay: 6000, ...over });

test('a route out of range or above the rank says by how much', () => {
  const start = { x: 0, y: 0, z: 0 };
  const sectors = [{ id: 1, rankReq: 10, x: 1000, y: 0, z: 0, surveyDistance: 5 }, { id: 2, rankReq: 50, x: 2000, y: 0, z: 0, surveyDistance: 5 }];
  // 35 + 5, then 35 + 5: 80 range.
  assert.deepStrictEqual(cmp.routeCheck(sectors, start, stats(100), 60), { used: 80, short: 0, tooHigh: [], partsNeed: 0 });
  assert.deepStrictEqual(cmp.routeCheck(sectors, start, stats(70), 40), { used: 80, short: 10, tooHigh: [2], partsNeed: 0 });
  assert.deepStrictEqual(cmp.routeCheck([], null, stats(70), 40), { used: null, short: 0, tooHigh: [], partsNeed: 0 });
  // Parts that need a higher rank than the build's.
  const needs = (l) => (l.endsWith('+') ? 50 : 1);
  assert.strictEqual(cmp.routeCheck(sectors, start, stats(100), 20, ['W+', 'S', 'S', 'S'], needs).partsNeed, 50);
  assert.strictEqual(cmp.routeCheck(sectors, start, stats(100), 60, ['W+', 'S', 'S', 'S'], needs).partsNeed, 0);
});

test('the rows: stats always, the voyage only when the build can fly it', () => {
  const v = cmp.rowValues(stats(100), plan(), true);
  assert.strictEqual(v.range, 100);
  assert.strictEqual(v.spare, 60);
  assert.strictEqual(v.hours, 20);
  assert.strictEqual(v.expPerDay, 1200);
  assert.ok(Math.abs(v.kitsPerDay - 2.4) < 1e-9);
  assert.strictEqual(v.netPerDay, 54000);
  const out = cmp.rowValues(stats(30), plan(), false);
  assert.strictEqual(out.range, 30);
  assert.strictEqual(out.gilPerDay, null);
  assert.strictEqual(out.spare, null);
  // No kit price set: no gil after repairs.
  assert.strictEqual(cmp.rowValues(stats(100), plan({ repairGilPerDay: null }), true).netPerDay, null);
  assert.strictEqual(cmp.rowValues(null, null, false).surveillance, null);
});

test('the best in each row: higher or lower as the row goes, ties all marked, all equal or alone not marked', () => {
  const a = cmp.rowValues(stats(100), plan(), true);
  const b = cmp.rowValues(stats(120, { speed: 80 }), plan({ hours: 18, gilPerDay: 60000, kitsPerVoyage: 3 }), true);
  const c = cmp.rowValues(stats(30), plan(), false);
  const m = cmp.bestMarks([a, b, c]);
  assert.deepStrictEqual(m.range, [1]);
  assert.deepStrictEqual(m.hours, [1]);
  assert.deepStrictEqual(m.spare, [1]);
  assert.strictEqual(m.speed, undefined, 'all three the same speed');
  assert.strictEqual(m.gilPerDay, undefined, 'the two that fly make the same gil');
  assert.deepStrictEqual(m.kitsPerDay, [0], 'fewer kits is better');
  assert.deepStrictEqual(cmp.bestMarks([a]), {});
  // The same figure worked out two ways still ties.
  const d = { ...a, gilPerDay: 0.1 + 0.2 };
  const e = { ...a, gilPerDay: 0.3 };
  assert.strictEqual(cmp.bestMarks([d, e]).gilPerDay, undefined);
});
