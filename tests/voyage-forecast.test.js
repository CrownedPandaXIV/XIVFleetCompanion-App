// Rank-up dates worked out voyage by voyage (subs/voyage-forecast.js): the experience gained at each
// collection, the sub's own bonus, voyages that get shorter, and a check against made-up history that this
// lands on the right return where the 7-day average lands late after a route change.
const test = require('node:test');
const assert = require('node:assert');
const { collections, bonusFactor, forecast } = require('../subs/voyage-forecast');
const { measuredRate, rankDate } = require('../subs/rank-up');
const { DAY } = require('../subs/supply-runway');

const HOUR = 60 * 60 * 1000;
const now = Date.UTC(2026, 9, 20);
// 10,000 experience from each rank to the next, up to rank 100.
const expToNext = new Map(Array.from({ length: 100 }, (_, i) => [i + 1, i + 1 < 100 ? 10000 : 0]));

test('collections: the experience gained each time, from one collection to the next', () => {
  const points = [{ at: 0, value: 100 }, { at: 5, value: 100 }, { at: 10, value: 400 }, { at: 20, value: 900 }];
  assert.deepStrictEqual(collections(points), [{ from: 0, at: 10, gained: 300 }, { from: 10, at: 20, gained: 900 - 400 }]);
  // A drop is another sub in the slot: only what comes after counts.
  assert.deepStrictEqual(collections([{ at: 0, value: 5000 }, { at: 1, value: 6000 }, { at: 2, value: 10 }, { at: 3, value: 60 }]),
    [{ from: 2, at: 3, gained: 50 }]);
});

test('bonus: the middle of its recent voyages against their routes, leaving out ones that are not one voyage', () => {
  const samples = [{ gained: 1500, base: 1000 }, { gained: 1400, base: 1000 }, { gained: 9000, base: 1000 }, { gained: 1600, base: 1000 }, { gained: 300, base: 1000 }];
  assert.deepStrictEqual(bonusFactor(samples), { factor: 1.5, voyages: 3 });
  assert.strictEqual(bonusFactor([{ gained: 1500, base: 1000 }]), null, 'one voyage is not enough');
  assert.strictEqual(bonusFactor([{ gained: 1500, base: null }, { gained: 1500, base: 0 }]), null);
});

test('forecast: each voyage\'s experience arrives at its return, and voyages get shorter as it ranks up', () => {
  // Rank 10 with 1,000 in; 3,000 a voyage; voyages of 24h, 20h from rank 11. Back in 5 hours.
  const voyageAt = (rank) => ({ exp: 3000, hours: rank >= 11 ? 20 : 24 });
  const reached = forecast({ rank: 10, exp: 1000, untilRank: 12, expToNext, voyageAt, returnAt: now + 5 * HOUR, now });
  // 9,000 more for rank 11: 3 voyages (back at 5h, then +24h, +24h), exactly; 10,000 more for rank 12: 4 more
  // voyages of 20h.
  assert.deepStrictEqual(reached.get(11), { at: now + 53 * HOUR, voyages: 3 });
  assert.deepStrictEqual(reached.get(12), { at: now + 133 * HOUR, voyages: 7 });
  // In port: the first comes after a whole voyage; back already: straight away.
  assert.strictEqual(forecast({ rank: 10, exp: 9000, untilRank: 11, expToNext, voyageAt, returnAt: null, now }).get(11).at, now + 24 * HOUR);
  assert.strictEqual(forecast({ rank: 10, exp: 9000, untilRank: 11, expToNext, voyageAt, returnAt: now - HOUR, now }).get(11).at, now);
  // No voyage data: nothing.
  assert.strictEqual(forecast({ rank: 10, exp: 0, untilRank: 11, expToNext, voyageAt: () => null, returnAt: null, now }).size, 0);
});

test('against made-up history: right after a route change, voyage by voyage lands on the return; the 7-day average is late', () => {
  // A sub sent out every 24h with a 1.5x bonus. For 5 days its route gives 2,000 (3,000 with the bonus), then
  // it moves to a route giving 4,000 (6,000). Its experience is recorded at each collection.
  const start = now - 7 * DAY;
  const routeOf = (day) => (day < 5 ? { sectors: [1], base: 2000 } : { sectors: [2], base: 4000 });
  let total = 50 * 10000;
  const points = [{ at: start, value: total }];
  const recorded = [];
  for (let day = 0; day < 7; day++) {
    const at = start + (day + 1) * DAY;
    total += routeOf(day).base * 1.5;
    points.push({ at, value: total });
    recorded.push({ returnedAt: at - HOUR, sectors: routeOf(day).sectors });
  }
  const rank = Math.floor(total / 10000);
  const exp = total % 10000;
  const target = rank + 3;

  // What actually happens: 6,000 at each collection, every 24h from now.
  let actual = null;
  for (let n = 1, t = total; !actual; n++) {
    t += 6000;
    if (Math.floor(t / 10000) >= target) actual = now + n * DAY;
  }

  // Voyage by voyage: each collection against the route of the voyage it collected.
  const baseOf = (sectors) => (sectors[0] === 1 ? 2000 : 4000);
  const samples = collections(points).map((c) => ({
    gained: c.gained,
    base: recorded.filter((v) => v.returnedAt > c.from && v.returnedAt <= c.at).reduce((sum, v) => sum + baseOf(v.sectors), 0),
  }));
  const bonus = bonusFactor(samples);
  assert.strictEqual(bonus.factor, 1.5);
  const reached = forecast({ rank, exp, untilRank: target, expToNext, voyageAt: () => ({ exp: 4000 * bonus.factor, hours: 24 }), returnAt: now + DAY, now });
  assert.strictEqual(reached.get(target).at, actual, 'voyage by voyage: the right return');

  // The 7-day average mixes in the slower route.
  const measured = measuredRate(points, now - 7 * DAY, now);
  const averaged = rankDate({ rank, exp, targetRank: target, expToNext, measured, out: { returnAt: now + DAY, hours: 24 }, now }).at;
  assert.ok(averaged - actual >= DAY, `the 7-day average is at least a day late (${(averaged - actual) / DAY} days)`);
});
