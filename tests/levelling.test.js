// Sub Calculator → Levelling Plan (subs/levelling.js): voyages to a target rank with experience carried over, stages
// by route and parts, a sub that can't go anywhere, and part swaps suggested on the way.
const test = require('node:test');
const assert = require('node:assert');
const lv = require('../subs/levelling');

const expToNext = new Map(Array.from({ length: 20 }, (_, i) => [i + 1, 100]));
expToNext.set(20, 0); // the top rank
// One voyage: route A below rank 3, B from it; 10 hours, faster with W+ in the hull.
const bestAt = (rank, parts) => {
  const hours = parts[0] === 'W+' ? 8 : 10;
  const exp = rank < 3 ? 150 : 120;
  return { route: rank < 3 ? [1, 2] : [3], hours, exp, expPerHour: exp / hours, range: 10, tanks: 2, kits: parts[0].endsWith('+') ? 1 : 0.5 };
};

test('voyages to a target rank, the experience carrying over into the next ranks', () => {
  const p = lv.simulate({ rank: 1, exp: 0, target: 4, expToNext, partsAt: () => ['S', 'S', 'S', 'S'], bestAt });
  // 150 -> rank 2 (50 in); +150 -> 200 -> rank 3 (100 in) -> rank 4: two voyages.
  assert.strictEqual(p.voyages, 2);
  assert.strictEqual(p.reached, true);
  assert.strictEqual(p.expNeeded, 300);
  assert.deepStrictEqual(p.stages.map((s) => [s.fromRank, s.toRank, s.route.join('-'), s.voyages]), [[1, 4, '1-2', 2]]);
  assert.strictEqual(p.hours, 20);
  assert.strictEqual(p.tanks, 4);
});

test('a new route makes a new stage; experience already into the rank counts', () => {
  const p = lv.simulate({ rank: 2, exp: 90, target: 6, expToNext, partsAt: () => ['S', 'S', 'S', 'S'], bestAt });
  // 90 + 150 = 240 -> rank 4 (40 in), then route B: 160 -> 5 (60), 180 -> 6.
  assert.deepStrictEqual(p.stages.map((s) => [s.fromRank, s.toRank, s.route.join('-'), s.voyages]), [[2, 4, '1-2', 1], [4, 6, '3', 2]]);
  assert.strictEqual(p.expNeeded, 310);
});

test('a sub with nowhere to go stops, and says where', () => {
  const p = lv.simulate({ rank: 1, exp: 0, target: 5, expToNext, partsAt: () => ['S', 'S', 'S', 'S'], bestAt: (r) => (r < 3 ? bestAt(r, ['S']) : null) });
  assert.strictEqual(p.reached, false);
  assert.strictEqual(p.stuckAt, 4); // two voyages below rank 3 reach rank 4, then nothing
});

test('suggestions: the best one-part swap on the route being run, with the time it saves; Standard parts only leaves Modified out', () => {
  const score = (rank, parts, route) => (parts[0] === 'W+' ? 2 : parts[0] === 'W' ? 1.5 : 1) * route.length;
  const plan = lv.levellingPlan({ rank: 1, exp: 0, target: 8, expToNext, parts: ['S', 'S', 'S', 'S'], bestAt, score, suggest: true, owned: new Set(['W|0']) });
  assert.strictEqual(plan.swaps.length, 1);
  assert.deepStrictEqual([plan.swaps[0].atRank, plan.swaps[0].slot, plan.swaps[0].from, plan.swaps[0].to, plan.swaps[0].owned], [1, 0, 'S', 'W+', false]);
  assert.ok(plan.swaps[0].savedHours > 0 && plan.hours < plan.keepHours, `saves time (${plan.hours} of ${plan.keepHours})`);
  assert.ok(plan.stages.every((s) => s.parts[0] === 'W+'));
  // Standard only: W (owned) is better than S, but this bestAt isn't faster with it, so the plan isn't shorter: nothing.
  const std = lv.levellingPlan({ rank: 1, exp: 0, target: 8, expToNext, parts: ['S', 'S', 'S', 'S'], bestAt, score, suggest: true, standardOnly: true });
  assert.ok(std.swaps.every((s) => !s.to.endsWith('+')));
  assert.strictEqual(std.swaps.length, 0);
  // Off: the build is kept.
  const off = lv.levellingPlan({ rank: 1, exp: 0, target: 8, expToNext, parts: ['S', 'S', 'S', 'S'], bestAt, score });
  assert.strictEqual(off.swaps.length, 0);
  assert.strictEqual(off.hours, off.keepHours);
});

test('suggestions: only parts the sub\'s rank allows, looked at again from the rank a part opens', () => {
  // W+ is the best part but needs rank 4; the plan runs one route from rank 1, so W+ comes in at rank 4, not before.
  const score = (rank, parts, route) => (parts[0] === 'W+' ? 2 : 1) * route.length;
  const partRank = (letter) => (letter === 'W+' ? 4 : 0);
  const plan = lv.levellingPlan({ rank: 1, exp: 0, target: 8, expToNext, parts: ['S', 'S', 'S', 'S'], bestAt, score, suggest: true, partRank });
  assert.ok(plan.swaps.every((s) => s.to !== 'W+' || s.atRank >= 4), JSON.stringify(plan.swaps));
  assert.ok(plan.stages.every((s) => s.parts[0] !== 'W+' || s.fromRank >= 4));
  // From the game's parts: Modified parts at rank 50, Shark from 1, Whale from 25.
  const ranksOf = lv.partRanks([{ class: 3, slot: 0, rank: 1 }, { class: 1, slot: 2, rank: 25 }, { class: 6, slot: 0, rank: 50 }]);
  assert.deepStrictEqual([ranksOf('S', 0), ranksOf('W', 2), ranksOf('W+', 0), ranksOf('Y', 1)], [1, 25, 50, 0]);
});

test('an undiscovered sector is mentioned only when it gives at least 1% more an hour', () => {
  const stage = (expPerHour) => ({ stages: [{ fromRank: 5, toRank: 6, parts: ['S', 'S', 'S', 'S'], expPerHour }] });
  const every = { bestAt: () => ({ route: [1, 9], expPerHour: 100 }) };
  const read = new Map([[1, { unlocked: true }]]);
  assert.strictEqual(lv.markBetter(stage(99.99), every, read).stages[0].better, null); // 0.01% more: not worth a line
  assert.ok(lv.markBetter(stage(99), every, read).stages[0].better); // about 1% more
  assert.deepStrictEqual(lv.markBetter(stage(90), every, read).stages[0].better.missing, [9]);
  // Every rank of a stage is looked at, against the route it runs at that rank: only at rank 7 is it better.
  const long = { stages: [{ fromRank: 5, toRank: 9, parts: ['S', 'S', 'S', 'S'], expPerHour: 100 }] };
  const every2 = { bestAt: (r) => ({ route: [1, 9], expPerHour: r === 7 ? 120 : 100 }) };
  const own = { bestAt: () => ({ route: [1], expPerHour: 100 }) };
  const b = lv.markBetter(long, every2, read, own).stages[0].better;
  assert.strictEqual(b.atRank, 7);
  assert.ok(Math.abs(b.gain - 0.2) < 1e-9);
});

test('a stage shows its own averages, not its first voyage\'s', () => {
  // The same route the whole way, but each rank gives more experience a voyage.
  const grow = (rank) => ({ route: [1], hours: 10, exp: 100 * rank, expPerHour: 10 * rank });
  const plan = lv.simulate({ rank: 1, exp: 0, target: 4, expToNext, partsAt: () => ['S', 'S', 'S', 'S'], bestAt: grow });
  assert.strictEqual(plan.stages.length, 1);
  const st = plan.stages[0];
  assert.strictEqual(st.exp, plan.stages.reduce((s, x) => s + x.exp, 0));
  assert.ok(Math.abs(st.expPerVoyage * st.voyages - st.exp) < 1e-6);
  assert.ok(Math.abs(st.expPerHour * st.hours - st.exp) < 1e-6);
  assert.ok(st.expPerVoyage > 100);
});

test('a plan stuck at its rank gets the one-part swap that lets it fly', () => {
  // With a W in the first slot nothing fits; any other part there does.
  const fly = (rank, parts) => (parts[0] === 'W' ? null : { route: [1], hours: 10, exp: 1000, expPerHour: 100 });
  const plan = lv.levellingPlan({ rank: 1, exp: 0, target: 4, expToNext, parts: ['W', 'S', 'S', 'S'], bestAt: fly, score: () => 100, suggest: true });
  assert.ok(plan.reached);
  assert.strictEqual(plan.swaps[0].atRank, 1);
  assert.strictEqual(plan.swaps[0].slot, 0);
  assert.strictEqual(plan.swaps[0].gain, null);
});

test('a swap shows before the first stage that uses it, even when found inside a stage', () => {
  // Stages from 47 and 51 (a voyage goes from 49 to 51); a swap at 50 is first used from 51, and shown there.
  const plan = { stages: [{ fromRank: 47 }, { fromRank: 51 }, { fromRank: 54 }], swaps: [{ atRank: 47, slot: 2 }, { atRank: 50, slot: 0 }, { atRank: 54, slot: 1 }] };
  const by = lv.swapsByStage(plan);
  assert.deepStrictEqual(by.map((l) => l.map((s) => `${s.slot}@${s.showRank}`)), [['2@47'], ['0@51'], ['1@54']]);
});

test('no cap on swaps: every one that makes the plan shorter (here 8: each slot to W, then to W+ from rank 5)', () => {
  const value = { S: 0, W: 1, 'W+': 2 };
  const hoursOf = (parts) => 10 - parts.reduce((n, p) => n + (value[p] || 0), 0) * 0.5;
  const fly = (rank, parts) => ({ route: [1], hours: hoursOf(parts), exp: 100, expPerHour: 100 / hoursOf(parts) });
  const score = (rank, parts) => 100 / hoursOf(parts);
  const many = new Map(Array.from({ length: 40 }, (_, i) => [i + 1, 100]));
  many.set(40, 0);
  const plan = lv.levellingPlan({ rank: 1, exp: 0, target: 30, expToNext: many, parts: ['S', 'S', 'S', 'S'], bestAt: fly, score, suggest: true,
    partRank: (letter) => (letter === 'W+' ? 5 : 0), standardOnly: false });
  assert.ok(lv.MAX_SWAPS > 4);
  assert.strictEqual(plan.swaps.length, 8, JSON.stringify(plan.swaps.map((s) => `${s.atRank}:${s.slot}${s.from}>${s.to}`)));
  assert.ok(plan.stages[plan.stages.length - 1].parts.every((p) => p === 'W+'));
});

test('a swap that doesn\'t speed up the route it runs but opens a better one is still found (judged on the best route too)', () => {
  // On route [1] every build is the same; with W+ in the bridge, route [2] fits and gives twice as much an hour.
  const fly = (rank, parts) => (parts[3] === 'W+' ? { route: [2], hours: 10, exp: 200, expPerHour: 20 } : { route: [1], hours: 10, exp: 100, expPerHour: 10 });
  const score = () => 10;
  const plan = lv.levellingPlan({ rank: 1, exp: 0, target: 10, expToNext, parts: ['W', 'S', 'U', 'C'], bestAt: fly, score, suggest: true });
  assert.deepStrictEqual(plan.swaps.map((s) => [s.atRank, s.slot, s.from, s.to]), [[1, 3, 'C', 'W+']]);
  assert.ok(plan.hours < plan.keepHours);
});

// A made-up map for opening sectors: 1 is open; 2 opens from 1 and is far better; 3 is open, better than 1, and doesn't
// lead to 2. bestAt goes by the open sectors it's given, and `must` forces a sector in.
const unlockMap = (bestRoute) => (rank, parts, open, must) => {
  const has = (id) => open.set.has(id);
  if (must) return { route: [must], hours: 10, exp: 100, expPerHour: 10 };
  return has(2) ? { route: [2], hours: 10, exp: 400, expPerHour: 40 } : bestRoute(has);
};
const unlockOf = (extra = {}) => ({ open: new Set([1, 3]), chance: 0.25, opens: new Map([[1, [2]]]), openerOf: new Map([[2, 1]]), rankOf: new Map([[1, 1], [2, 1], [3, 1]]),
  targets: [[2, 1]], lookahead: null, ...extra });
const longExp = new Map(Array.from({ length: 60 }, (_, i) => [i + 1, 400]));
longExp.set(60, 0);

test('opening sectors: each voyage through a sector adds its chance; one opens when they add up to a whole (4 voyages at 25%)', () => {
  const p = lv.simulate({ rank: 1, exp: 0, target: 6, expToNext: longExp, partsAt: () => ['S', 'S', 'S', 'S'], bestAt: unlockMap(() => ({ route: [1], hours: 10, exp: 100, expPerHour: 10 })),
    unlock: unlockOf({ open: new Set([1]) }) });
  assert.deepStrictEqual(p.stages.map((s) => [s.route.join('-'), s.voyages, s.discovers]), [['1', 4, [2]], ['2', 4, []]]);
  // At 100%, one voyage is enough.
  const sure = lv.simulate({ rank: 1, exp: 0, target: 6, expToNext: longExp, partsAt: () => ['S', 'S', 'S', 'S'], bestAt: unlockMap(() => ({ route: [1], hours: 10, exp: 100, expPerHour: 10 })),
    unlock: unlockOf({ open: new Set([1]), chance: 1 }) });
  assert.deepStrictEqual(sure.stages.map((s) => [s.route.join('-'), s.voyages]), [['1', 1], ['2', 5]]); // 100 + 5 x 400 for 2,000
});

test('opening sectors: the plan goes out of its way to open a better one when that gets there sooner, and says so', () => {
  const via3 = unlockMap(() => ({ route: [3], hours: 10, exp: 150, expPerHour: 15 }));
  // Never going through 1, 2 never opens: 150 a voyage the whole way.
  const stay = lv.simulate({ rank: 1, exp: 0, target: 30, expToNext: longExp, partsAt: () => ['S', 'S', 'S', 'S'], bestAt: via3, unlock: unlockOf() });
  assert.ok(stay.stages.every((s) => s.route.join() === '3'));
  // Going through 1 four times opens 2 (400 a voyage): the plan picks that, and the stage says why.
  const plan = lv.levellingPlan({ rank: 1, exp: 0, target: 30, expToNext: longExp, parts: ['S', 'S', 'S', 'S'], bestAt: via3, unlock: unlockOf() });
  assert.strictEqual(plan.lookahead, Infinity);
  assert.deepStrictEqual(plan.stages[0].toOpen, { via: 1, next: 2, target: 2 });
  assert.deepStrictEqual(plan.stages.map((s) => [s.route.join('-'), s.voyages]).slice(0, 2), [['1', 4], ['2', plan.stages[1].voyages]]);
  assert.ok(plan.hours < stay.hours);
});

test('a sector the plan opens itself later says by when, not what it would add', () => {
  const read = new Map([[1, { unlocked: true }]]);
  const every = { bestAt: () => ({ route: [1, 9], expPerHour: 100 }) };
  const plan = { stages: [
    { fromRank: 5, toRank: 6, parts: ['S', 'S', 'S', 'S'], expPerHour: 50, discovers: [] },
    { fromRank: 6, toRank: 8, parts: ['S', 'S', 'S', 'S'], expPerHour: 50, discovers: [9] },
  ] };
  lv.markBetter(plan, every, read);
  assert.strictEqual(plan.stages[0].better.opensBy, 8);
  // One it never opens: what it would add, as before.
  const never = { stages: [{ fromRank: 5, toRank: 6, parts: ['S', 'S', 'S', 'S'], expPerHour: 50, discovers: [] }] };
  lv.markBetter(never, every, read);
  assert.strictEqual(never.stages[0].better.opensBy, null);
});
