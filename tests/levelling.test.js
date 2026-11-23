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
