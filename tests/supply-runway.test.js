const test = require('node:test');
const assert = require('node:assert');
const { DAY, usageRate, runway, restockAmount, clampDays } = require('../subs/supply-runway');

const now = Date.UTC(2026, 9, 20);
const at = (daysAgo) => now - daysAgo * DAY;

test('every drop counts as use, restocks are ignored', () => {
  // 100 -> 80 -> 60, restocked to 200, -> 170 over 10 days: 70 used, 7 a day.
  const points = [
    { at: at(10), value: 100 }, { at: at(8), value: 80 }, { at: at(6), value: 60 },
    { at: at(5), value: 200 }, { at: at(1), value: 170 },
  ];
  const r = usageRate(points, at(14), now);
  assert.strictEqual(r.used, 70);
  assert.strictEqual(r.spanDays, 10, 'history starts 10 days ago, so the rate covers 10 days, not 14');
  assert.strictEqual(r.perDay, 7);
});

test('the value before the window is its starting point; older changes are not counted', () => {
  const points = [
    { at: at(30), value: 500 }, { at: at(20), value: 300 }, // before the window: not use in it
    { at: at(14), value: 280 }, // the last value at or before the window start
    { at: at(7), value: 210 }, { at: at(0), value: 140 },
  ];
  const r = usageRate(points, at(14), now);
  assert.strictEqual(r.used, 140);
  assert.strictEqual(r.spanDays, 14);
  assert.strictEqual(r.perDay, 10);
});

test('a value unchanged for the whole window means nothing used', () => {
  const r = usageRate([{ at: at(40), value: 50 }], at(14), now);
  assert.deepStrictEqual(r, { perDay: 0, spanDays: 14, used: 0 });
});

test('less than a day of history is not trusted', () => {
  const r = usageRate([{ at: now - DAY / 2, value: 50 }, { at: now, value: 40 }], at(14), now);
  assert.strictEqual(r.perDay, null);
  assert.strictEqual(usageRate([], at(14), now).perDay, null);
});

test('points after the last sync are left out', () => {
  const r = usageRate([{ at: at(4), value: 40 }, { at: at(2), value: 20 }, { at: at(1), value: 0 }], at(14), at(2));
  assert.strictEqual(r.used, 20);
  assert.strictEqual(r.perDay, 10);
});

test('runway and restock', () => {
  assert.deepStrictEqual(runway(60, 10, now), { days: 6, runsOutAt: now + 6 * DAY });
  assert.deepStrictEqual(runway(60, 0, now), { days: Infinity, runsOutAt: null });
  assert.deepStrictEqual(runway(60, null, now), { days: null, runsOutAt: null });
  assert.strictEqual(runway(-5, 10, now).days, 0);
  assert.strictEqual(restockAmount(60, 10, 14), 80);
  assert.strictEqual(restockAmount(60, 2.5, 14), 0);
  assert.strictEqual(restockAmount(10, 3.3, 14), 37, 'rounded up');
  assert.strictEqual(restockAmount(10, 0, 14), 0);
  assert.strictEqual(restockAmount(10, null, 14), 0);
});

test('day settings are kept within limits', () => {
  assert.strictEqual(clampDays('21', 14, 90), 21);
  assert.strictEqual(clampDays(0, 14, 90), 14);
  assert.strictEqual(clampDays(200, 14, 90), 14);
  assert.strictEqual(clampDays(null, 7, 90), 7);
});
