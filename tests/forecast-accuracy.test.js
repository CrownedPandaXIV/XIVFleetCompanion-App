// How close the Next Rank dates came (subs/forecast-accuracy.js): rank-ups from the recorded rank and the
// voyages' return times, the saved date worked out about a day before each, and the average on the Subs tab.
const test = require('node:test');
const assert = require('node:assert');
const { rankUps, checkSub, summarize } = require('../subs/forecast-accuracy');

const HOUR = 60 * 60 * 1000;
const t0 = Date.UTC(2026, 9, 1);
const at = (hours) => t0 + hours * HOUR;

test('rank-ups: from the return of the voyage collected just before the new rank was recorded', () => {
  const points = [{ at: at(0), value: 50 }, { at: at(30), value: 51 }, { at: at(80), value: 53 }];
  // Voyages back at 10h and 28h (collected, then recorded at 30h); one back at 79h brought two ranks.
  assert.deepStrictEqual(rankUps(points, [at(10), at(28), at(79)]),
    [{ rank: 51, at: at(28) }, { rank: 52, at: at(79) }, { rank: 53, at: at(79) }]);
  // Without SubmarineTracker's loot: when it was recorded.
  assert.deepStrictEqual(rankUps(points.slice(0, 2)), [{ rank: 51, at: at(30) }]);
  // A drop is another sub in the slot: only what comes after counts.
  assert.deepStrictEqual(rankUps([{ at: at(0), value: 80 }, { at: at(5), value: 81 }, { at: at(6), value: 1 }, { at: at(9), value: 2 }]),
    [{ rank: 2, at: at(9) }]);
});

test('each rank-up is checked against the date worked out closest to a day before it', () => {
  const ups = [{ rank: 51, at: at(48) }];
  const predictions = [
    { rank: 51, madeAt: at(0), predictedAt: at(40) },
    { rank: 51, madeAt: at(20), predictedAt: at(45) },  // 28h before: the one used
    { rank: 51, madeAt: at(30), predictedAt: at(48) },  // 18h before: not a day ahead
    { rank: 52, madeAt: at(20), predictedAt: at(47) },  // another rank
  ];
  assert.deepStrictEqual(checkSub(predictions, ups), [{ rank: 51, at: at(48), predictedAt: at(45), madeAt: at(20), off: 3 * HOUR }]);
  // Only dates from less than a day before: the earliest of them.
  assert.deepStrictEqual(checkSub(predictions.slice(2), ups).map((c) => c.madeAt), [at(30)]);
  // None saved before it (the app wasn't open): left out.
  assert.deepStrictEqual(checkSub([{ rank: 51, madeAt: at(50), predictedAt: at(60) }], ups), []);
});

test('the average counts dates from a day or more before, early or late, newest 20', () => {
  const day = (n, off, ahead = 30) => ({ rank: 50 + n, at: at(n * 100), predictedAt: at(n * 100) - off, madeAt: at(n * 100) - ahead * HOUR, off });
  const s = summarize([day(1, 2 * HOUR), day(2, -4 * HOUR), day(3, 0, 5)]);
  assert.strictEqual(s.count, 2);
  assert.strictEqual(s.averageOff, 3 * HOUR);
  assert.deepStrictEqual(s.checks.map((c) => c.rank), [53, 52, 51], 'newest first, the same-day one listed too');
  assert.deepStrictEqual(summarize([]), { count: 0, averageOff: null, checks: [] });
  const many = summarize(Array.from({ length: 25 }, (_, i) => day(i + 1, i < 5 ? 100 * HOUR : HOUR)));
  assert.deepStrictEqual([many.count, many.averageOff, many.checks.length], [20, HOUR, 20]);
});
