// subs/submarine-builds.js computeCurrentGilPerDay: which Fight Club row a sub's current route counts as, when the
// same route is listed at several durations (builds).
const test = require('node:test');
const assert = require('node:assert');
const { computeCurrentGilPerDay } = require('../subs/submarine-builds');

const rows = [
  { route: 'MROJZ', hours: 36, gil_sub_day: 50000, unmod_min_rank: '95: SSUC', min_rank_build: null, repair_times: '' },
  { route: 'MROJZ', hours: 24, gil_sub_day: 80000, unmod_min_rank: '110: WSUC', min_rank_build: null, repair_times: '' },
];

test("the row of the sub's own build, else the highest rank it clears, not the first in the sheet", () => {
  assert.strictEqual(computeCurrentGilPerDay(115, 'M-R-O-J-Z', ['W', 'S', 'U', 'C'], rows, 0), 80000, 'its own (fast) build');
  assert.strictEqual(computeCurrentGilPerDay(115, 'M-R-O-J-Z', ['S', 'S', 'U', 'C'], rows, 0), 50000, 'its own (slow) build');
  assert.strictEqual(computeCurrentGilPerDay(115, 'M-R-O-J-Z', ['Y', 'Y', 'Y', 'Y'], rows, 0), 80000, 'no build matches: the highest rank it clears');
  assert.strictEqual(computeCurrentGilPerDay(100, 'M-R-O-J-Z', ['W', 'S', 'U', 'C'], rows, 0), 50000, 'only the rank it clears');
  assert.strictEqual(computeCurrentGilPerDay(90, 'M-R-O-J-Z', ['W', 'S', 'U', 'C'], rows, 0), '', 'none it clears');
});
