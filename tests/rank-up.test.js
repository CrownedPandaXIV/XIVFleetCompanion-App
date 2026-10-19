const test = require('node:test');
const assert = require('node:assert');
const { DAY } = require('../subs/supply-runway');
const {
  totalExp, totalExpSeries, measuredRate, voyage, startFor, atCollection, rankDate, maxRank, nextBuildRank,
} = require('../subs/rank-up');

const now = Date.UTC(2026, 9, 20);
const at = (daysAgo) => now - daysAgo * DAY;
const HOUR = 60 * 60 * 1000;
// Ranks 1-4 need 100, 200, 300, 400 to the next; rank 5 is the highest.
const expToNext = new Map([[1, 100], [2, 200], [3, 300], [4, 400], [5, 0]]);

test('total experience adds every rank below plus what the sub has into its rank', () => {
  assert.strictEqual(totalExp(1, 50, expToNext), 50);
  assert.strictEqual(totalExp(3, 10, expToNext), 310);
  assert.strictEqual(maxRank(expToNext), 5);
});

test('rank and experience recorded together become total experience over time', () => {
  const rank = [{ at: at(5), value: 2 }, { at: at(2), value: 3 }];
  const exp = [{ at: at(5), value: 150 }, { at: at(3), value: 190 }, { at: at(2), value: 40 }];
  assert.deepStrictEqual(totalExpSeries(rank, exp, expToNext), [
    { at: at(5), value: 250 }, { at: at(3), value: 290 }, { at: at(2), value: 340 },
  ]);
});

test('measured rate: gained over the window, from the value before it', () => {
  const points = [{ at: at(10), value: 0 }, { at: at(5), value: 300 }, { at: at(1), value: 1000 }];
  // From 7 days ago (still 0 then) to now: 1,000 over 7 days.
  assert.strictEqual(Math.round(measuredRate(points, at(7), now).perDay), 143);
  assert.strictEqual(measuredRate([{ at: now - DAY / 2, value: 0 }, { at: now, value: 50 }], at(7), now), null, 'under a day');
});

test('measured rate starts again after the sub in the slot is replaced', () => {
  const points = [{ at: at(6), value: 5000 }, { at: at(4), value: 6000 }, { at: at(3), value: 0 }, { at: at(1), value: 300 }];
  const r = measuredRate(points, at(7), now);
  assert.strictEqual(r.spanDays, 3);
  assert.strictEqual(r.perDay, 100);
});

test('voyage: 12 hours plus travel and survey time at the sub speed, experience from each sector', () => {
  const start = { id: 0, x: 0, y: 0, z: 0 };
  const a = { id: 1, x: 300, y: 400, z: 0, expReward: 1000, surveyMinutes: 100 }; // 500 from start
  const b = { id: 2, x: 300, y: 400, z: 120, expReward: 2000, surveyMinutes: 50 }; // 120 from a
  const v = voyage([a, b], start, 100);
  // travel: 500 * 3990 / 10000 * 60 = 11970 s, 120 * 3990 / 10000 * 60 = 2872.8 -> 2872 s
  // survey: 100 * 7000 / 10000 * 60 = 4200 s, 50 * ... = 2100 s
  assert.strictEqual(v.exp, 3000);
  assert.strictEqual(v.hours, (43200 + 11970 + 4200 + 2872 + 2100) / 3600);
  assert.strictEqual(voyage([a, undefined], start, 100), null, 'an unknown sector');
  assert.strictEqual(startFor(33, [{ id: 0 }, { id: 31 }, { id: 60 }]).id, 31);
});

test('measured date: the experience still needed at the rate per day', () => {
  // Rank 2 with 50: 150 more to rank 3, 450 more to rank 4. 100 a day.
  const base = { rank: 2, exp: 50, expToNext, measured: { perDay: 100 }, now };
  assert.strictEqual(rankDate({ ...base, targetRank: 3 }).at, now + 1.5 * DAY);
  assert.strictEqual(rankDate({ ...base, targetRank: 4 }).at, now + 4.5 * DAY);
  assert.deepStrictEqual(rankDate({ ...base, targetRank: 2 }), { reached: true });
  assert.strictEqual(rankDate({ ...base, targetRank: 3, measured: { perDay: 0 } }), null, 'no progress');
  assert.strictEqual(rankDate({ ...base, targetRank: 6 }), null, 'past the highest rank');
});

test('measured date for a sub out at sea: never before it is back, then on a return', () => {
  // 100 a day, 150 needed: 1.5 days at the steady rate.
  const base = { rank: 2, exp: 50, targetRank: 3, expToNext, measured: { perDay: 100 }, now };
  // Back in 2 days: it can't rank up before then, so the date is its return.
  assert.strictEqual(rankDate({ ...base, out: { returnAt: now + 2 * DAY, hours: 24 } }).at, now + 2 * DAY);
  // Back in 5 hours, 24h voyages: 1.5 days falls during the second voyage after, so it's the return after that.
  assert.strictEqual(rankDate({ ...base, out: { returnAt: now + 5 * HOUR, hours: 24 } }).at, now + 53 * HOUR);
  // Voyage length unknown: the return, or the steady date when that is later.
  assert.strictEqual(rankDate({ ...base, out: { returnAt: now + 5 * HOUR, hours: null } }).at, now + 1.5 * DAY);
  // In port, or back and waiting to be collected: the steady date.
  assert.strictEqual(rankDate({ ...base, out: { returnAt: null, hours: 24 } }).at, now + 1.5 * DAY);
  assert.strictEqual(rankDate({ ...base, out: { returnAt: now - HOUR, hours: 24 } }).at, now + 1.5 * DAY);
  assert.strictEqual(atCollection(now + DAY, undefined, now), now + DAY);
});

test('calculated date: experience arrives when each voyage comes back', () => {
  // 120 per 24h voyage, back in 5 hours: 150 needed = 2 voyages, the second a day after the first.
  const calculated = { exp: 120, hours: 24, returnAt: now + 5 * HOUR };
  const r = rankDate({ rank: 2, exp: 50, targetRank: 3, expToNext, calculated, now });
  assert.deepStrictEqual(r, { at: now + 29 * HOUR, voyages: 2 });
  // Back already, waiting to be collected: its experience counts straight away.
  assert.deepStrictEqual(rankDate({ rank: 2, exp: 50, targetRank: 3, expToNext, calculated: { exp: 200, hours: 24, returnAt: now - HOUR }, now }),
    { at: now, voyages: 1 });
  // In port, not sent out (no return time): after a whole voyage from now.
  assert.deepStrictEqual(rankDate({ rank: 2, exp: 50, targetRank: 3, expToNext, calculated: { exp: 200, hours: 24, returnAt: null }, now }),
    { at: now + 24 * HOUR, voyages: 1 });
});

test('next build: the first rank above with a different build', () => {
  const buildAt = (rank) => (rank >= 90 ? ['W', 'W', 'U', 'C'] : rank >= 40 ? ['S', 'S', 'U', 'C'] : ['S', 'S', 'S', 'S']);
  assert.deepStrictEqual(nextBuildRank(35, 125, buildAt), { rank: 40, build: ['S', 'S', 'U', 'C'] });
  assert.deepStrictEqual(nextBuildRank(40, 125, buildAt).rank, 90);
  assert.strictEqual(nextBuildRank(95, 125, buildAt), null);
});
