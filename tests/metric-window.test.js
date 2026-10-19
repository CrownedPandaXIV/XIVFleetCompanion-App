// The history window without the plugin's unchanged hourly reminders (db/metric-window.js): every
// calculation that reads it gives the same result with or without them.
const test = require('node:test');
const assert = require('node:assert');
const { withoutRepeats } = require('../db/metric-window');
const { usageRate, changesInWindow } = require('../subs/supply-runway');
const rankUp = require('../subs/rank-up');
const { characterIncome, chestDrops } = require('../subs/income');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const START = Date.UTC(2026, 9, 1);
const WINDOW_START = START + 3 * DAY;
const END = START + 17 * DAY + 5 * HOUR;

// A series recorded as the plugin does: a value whenever it changes, and the same value again every hour.
// changes: [[hoursFromStart, value]]. Starts before the window so the "value before it" is there too.
function recorded(changes) {
  const points = [];
  let value = changes[0][1];
  let next = 0;
  for (let h = 0; START + h * HOUR <= END; h++) {
    while (next < changes.length && changes[next][0] <= h) value = changes[next++][1];
    points.push({ at: START + h * HOUR, value });
  }
  return points;
}
// What the database sends: the last value at or before the window start, then everything in the window.
const sent = (points) => [...points.filter((p) => p.at <= WINDOW_START).slice(-1), ...points.filter((p) => p.at > WINDOW_START)];
const both = (changes) => {
  const all = sent(recorded(changes));
  return [all, withoutRepeats(all, WINDOW_START)];
};

const ceruleum = [[0, 900], [80, 860], [81, 860], [150, 820], [200, 1500], [260, 1460], [330, 1400], [400, 1390]];
const kits = [[0, 300], [90, 296], [190, 290], [300, 500], [380, 494]];

test('far fewer values, and the first, the newest and every change are kept', () => {
  const [all, few] = both(ceruleum);
  assert.ok(few.length < all.length / 20, `${few.length} of ${all.length}`);
  assert.deepStrictEqual(few[0], all[0]);
  assert.deepStrictEqual(few[few.length - 1], all[all.length - 1]);
  for (let i = 1; i < all.length; i++) {
    if (all[i].value !== all[i - 1].value && all[i].at > WINDOW_START) assert.ok(few.some((p) => p.at === all[i].at), `change at ${i} kept`);
  }
});

test('Supplies: the same use per day', () => {
  for (const series of [ceruleum, kits, [[0, 5]], [[0, 5], [100, 5]]]) {
    const [all, few] = both(series);
    assert.deepStrictEqual(usageRate(few, WINDOW_START, END), usageRate(all, WINDOW_START, END));
    assert.deepStrictEqual(changesInWindow(few, WINDOW_START + 2 * DAY, END), changesInWindow(all, WINDOW_START + 2 * DAY, END));
  }
});

test('Subs: the same experience per day, and the same newest time', () => {
  const expToNext = new Map([[1, 1000], [2, 1500], [3, 2000], [4, 2500]]);
  const rankChanges = [[0, 1], [120, 2], [250, 3]];
  const expChanges = [[0, 100], [40, 600], [100, 900], [120, 50], [180, 700], [250, 10], [300, 900], [350, 1400]];
  const [rankAll, rankFew] = both(rankChanges);
  const [expAll, expFew] = both(expChanges);
  const seriesAll = rankUp.totalExpSeries(rankAll, expAll, expToNext);
  const seriesFew = rankUp.totalExpSeries(rankFew, expFew, expToNext);
  assert.strictEqual(seriesFew[seriesFew.length - 1].at, seriesAll[seriesAll.length - 1].at);
  assert.deepStrictEqual(rankUp.measuredRate(seriesFew, WINDOW_START, END), rankUp.measuredRate(seriesAll, WINDOW_START, END));
  // A sub replaced in the slot (experience drops): only what comes after counts, both ways.
  const [replacedAll, replacedFew] = both([[0, 5000], [200, 100], [300, 900]]);
  assert.deepStrictEqual(rankUp.measuredRate(replacedFew, WINDOW_START, END), rankUp.measuredRate(replacedAll, WINDOW_START, END));
});

test('Income: the same salvage, chest moves, first-stored items and repair kits', () => {
  const prices = { 22500: 8000, 22501: 9000 };
  const salvageChanges = {
    22500: [[0, 3], [100, 7], [101, 7], [180, 12], [240, 4], [300, 9]],
    22501: [[0, 0], [150, 2], [260, 5]],
  };
  const chestChanges = { 22500: [[0, 10], [180, 7]], 22501: [[0, 1], [260, 0]] };
  const sourcesChanges = [[0, 3], [300, 4]];
  const run = (pick) => {
    const salvage = new Map(Object.entries(salvageChanges).map(([id, c]) => [id, pick(c)]));
    const drops = chestDrops(new Map(Object.entries(chestChanges).map(([id, c]) => [id, pick(c)])));
    return characterIncome({
      salvage, kits: pick(kits), prices, kitCost: 1200, expectedPerDay: 50000, windowStart: WINDOW_START, end: END,
      drops, sources: pick(sourcesChanges), kitsTotal: pick(kits),
    });
  };
  const all = run((c) => both(c)[0]);
  const few = run((c) => both(c)[1]);
  assert.ok(all.enough && all.pieces > 0 && all.fromChest > 0 && all.firstStored > 0 && all.kitsUsed > 0, JSON.stringify(all));
  assert.deepStrictEqual(few, all);
});
