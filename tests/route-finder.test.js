// The Route Finder (subs/route-finder.js): checked against trying every order of every set with the Planner's own
// working out, and its unlocks with figures worked out by hand.
const test = require('node:test');
const assert = require('node:assert');
const rf = require('../subs/route-finder');
const calc = require('../subs/calculator');
const { voyage } = require('../subs/rank-up');

let seed = 11;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const start = { id: 0, x: 0, y: 0, z: 0, surveyDistance: 0 };
const made = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, letter: String.fromCharCode(65 + i), x: Math.round(rnd() * 1200),
  y: Math.round(rnd() * 1200), z: Math.round(rnd() * 100), surveyMinutes: 60 + Math.round(rnd() * 500), surveyDistance: 5 + Math.floor(rnd() * 10),
  expReward: 1000 + Math.round(rnd() * 9000) }));
const valuesOf = (sectors) => new Map(sectors.map((s) => [s.id, { exp: s.expReward, gil: s.id * 10, items: new Map([[7, s.id % 3]]), tier: 1 }]));

// Every set of up to `stops` sectors: the Planner's best order with this range, kept when it fits the range and time.
function everyRoute(sectors, stats, stops, maxHours) {
  const out = new Map();
  const pick = (from, chosen) => {
    if (chosen.length) {
      const order = chosen.length > 1 ? calc.bestOrder(chosen, start, stats.speed, stats.range) : chosen;
      const range = calc.rangeUsed(order, start);
      const hours = voyage(order, start, stats.speed).hours;
      if (range <= stats.range && (!maxHours || hours <= maxHours)) out.set(chosen.map((s) => s.id).sort((a, b) => a - b).join(','), { order: order.map((s) => s.id), range, hours });
    }
    if (chosen.length === stops) return;
    for (let i = from; i < sectors.length; i++) pick(i + 1, [...chosen, sectors[i]]);
  };
  pick(0, []);
  return out;
}

test('every route the sub can fly, each in the fastest order its range allows, as the Planner picks it', () => {
  for (const [n, range, stops, maxHours] of [[8, 60, 5, null], [10, 90, 4, null], [9, 1000, 5, 40], [12, 75, 3, 30]]) {
    const sectors = made(n);
    const stats = { speed: 40 + Math.round(rnd() * 150), range };
    const routes = rf.findRoutes({ sectors, start, stats, maxStops: stops, maxHours, values: valuesOf(sectors) });
    const want = everyRoute(sectors, stats, stops, maxHours);
    assert.strictEqual(routes.length, want.size, `${n} sectors, range ${range}: how many`);
    for (const r of routes) {
      const w = want.get(r.route.slice().sort((a, b) => a - b).join(','));
      assert.ok(w, `${r.route} is a route`);
      assert.strictEqual(r.range, w.range, `${r.route}: range`);
      assert.ok(Math.abs(r.hours - w.hours) < 1e-9, `${r.route}: hours ${r.hours} against ${w.hours}`);
      assert.deepStrictEqual(r.route, w.order, 'the same order');
    }
  }
});

test('ranked by experience an hour, gil a day or an item a day; must-haves and new sectors first', () => {
  const sectors = made(7);
  const stats = { speed: 120, range: 200 };
  const values = valuesOf(sectors);
  const byExp = rf.findRoutes({ sectors, start, stats, values, rankBy: 'exp' });
  assert.ok(byExp.every((r, i) => i === 0 || byExp[i - 1].expPerHour >= r.expPerHour), 'best experience an hour first');
  const r0 = byExp[0];
  assert.strictEqual(r0.exp, r0.route.reduce((sum, id) => sum + values.get(id).exp, 0));
  assert.ok(Math.abs(r0.gilPerDay - r0.gilPerVoyage * 24 / r0.hours) < 1e-6);
  const byGil = rf.findRoutes({ sectors, start, stats, values, rankBy: 'gil' });
  assert.ok(byGil.every((r, i) => i === 0 || byGil[i - 1].gilPerDay >= r.gilPerDay), 'most gil a day first');
  const byItem = rf.findRoutes({ sectors, start, stats, values, rankBy: 'item', itemId: 7 });
  assert.ok(byItem.every((r, i) => i === 0 || byItem[i - 1].itemPerDay >= r.itemPerDay), 'most of the item a day first');
  const withC = rf.findRoutes({ sectors, start, stats, values, must: [3] });
  assert.ok(withC.length > 0 && withC.every((r) => r.route.includes(3)), 'every route has the must');
  // Sector 2 is discovered (exploring it is sure); sector 4 opens sectors 5 and 6, which may open.
  const states = new Map([[1, 'explored'], [2, 'discovered'], [3, 'explored'], [4, 'explored'], [5, 'chance'], [6, 'chance'], [7, 'explored']]);
  const opens = new Map([[4, [5, 6]]]);
  const newFirst = rf.findRoutes({ sectors: sectors.filter((s) => s.id <= 4 || s.id === 7), start, stats, values, states, opens, exploreFirst: true });
  assert.deepStrictEqual([newFirst[0].explores, newFirst[0].chances], [1, 2], 'through 2 and 4 first');
  assert.ok(newFirst.every((r, i) => i === 0 || newFirst[i - 1].explores + newFirst[i - 1].chances >= r.explores + r.chances));
});

test("an FC's sectors: explored, discovered, could open by chance, locked; unknown until read", () => {
  // A opens B and C; B opens D; D opens E (the next map's first).
  const openerOf = new Map([[1, 0], [2, 1], [3, 1], [4, 2], [5, 4]]);
  const read = new Map([[1, { unlocked: true, explored: true }], [2, { unlocked: true, explored: false }]]);
  const states = rf.sectorStates([1, 2, 3, 4, 5], read, openerOf);
  assert.deepStrictEqual([...states.values()], ['explored', 'discovered', 'chance', 'chance', 'locked']);
  assert.deepStrictEqual([...rf.sectorStates([1, 2], null, openerOf).values()], [null, null]);
  assert.deepStrictEqual(rf.opensOf(openerOf).get(1), [2, 3]);
  const sectors = [{ id: 1, map: 1 }, { id: 2, map: 1 }, { id: 3, map: 1 }, { id: 4, map: 1 }, { id: 5, map: 2 }];
  const u = rf.unlocks({ sectors, maps: [{ id: 1, name: 'Deep' }, { id: 2, name: 'Ash' }], states, openerOf });
  assert.deepStrictEqual(u.maps.map((m) => [m.total, m.explored, m.discovered, m.open]), [[4, 1, 1, true], [1, 0, 0, false]]);
  assert.deepStrictEqual(u.sure, [2]);
  assert.deepStrictEqual(u.chance, [{ id: 3, from: 1 }, { id: 4, from: 2 }]);
  // Ash opens from D, D from B (discovered): explore B, then D and E by chance.
  assert.deepStrictEqual(u.nextMap, { id: 2, name: 'Ash', first: 5, steps: [{ id: 2, how: 'explore' }, { id: 4, how: 'chance' }, { id: 5, how: 'chance' }] });
});

test("Fight Club routes against the FC's sectors: what's missing, and the best it can run now", () => {
  const { fightClubOptions, bestOf } = require('../subs/submarine-builds');
  // Deep-sea Site: O 15, J 10, Z 26, M 13, R 18; Sea of Ash has its own O and J.
  const maps = [{ id: 2, byLetter: new Map([['O', 46], ['J', 41]]) }, { id: 1, byLetter: new Map([['O', 15], ['J', 10], ['Z', 26], ['M', 13], ['R', 18], ['AA', 27]]) }];
  assert.deepStrictEqual(rf.routeIds('MROJZ', maps), [13, 18, 15, 10, 26]);
  assert.deepStrictEqual(rf.routeIds('O-J', maps), [15, 10], 'the first map with every letter');
  assert.deepStrictEqual(rf.routeIds('ZAA', maps), [26, 27], 'two-letter sectors');
  assert.strictEqual(rf.routeIds('QQ', maps), null);
  const rows = [{ route: 'MROJZ', hours: 24, repair_times: '', gil_sub_day: 320000, rec_build_notes: '90: WWWW' },
    { route: 'OJZ', hours: 24, repair_times: '', gil_sub_day: 250000, rec_build_notes: '88: WWWW' },
    { route: 'OJ', hours: 12, repair_times: '', gil_sub_day: 200000, rec_build_notes: '85: SSSS' }];
  const options = fightClubOptions(rows, 0);
  const read = new Map([13, 15, 10, 26].map((id) => [id, { unlocked: true, explored: true }])); // R not discovered
  const blocked = rf.fightClubCheck({ options, rank: 90, maps, read, bestOf });
  assert.deepStrictEqual([blocked.best.row.route, blocked.missing, blocked.alt.row.route], ['MROJZ', [18], 'OJZ']);
  assert.deepStrictEqual(rf.fightClubCheck({ options, rank: 90, maps, read: null, bestOf }).missing, [], 'not read: nothing marked');
  const all = new Map([...read, [18, { unlocked: true, explored: false }]]);
  assert.deepStrictEqual(rf.fightClubCheck({ options, rank: 90, maps, read: all, bestOf }).missing, [], 'discovered is enough');
});

test('best only: the same best route as the whole list, with or without a rate to beat', () => {
  for (let k = 0; k < 40; k++) {
    const sectors = made(6 + (k % 12));
    const stats = { speed: 20 + (k % 5) * 10, range: 150 + (k % 7) * 60 };
    const values = valuesOf(sectors);
    for (const maxHours of [24, 48, null]) {
      const args = { sectors, start, stats, maxStops: 5, maxHours, values, rankBy: 'exp' };
      const all = rf.findRoutes(args);
      const one = rf.findRoutes({ ...args, bestOnly: true });
      assert.deepStrictEqual(one.map((r) => r.route), all.slice(0, 1).map((r) => r.route), `case ${k}, ${maxHours}h`);
      // A rate to beat: the best is kept when it reaches it; below it, nothing at least that good is claimed.
      if (all[0]) {
        const under = rf.findRoutes({ ...args, bestOnly: true, atLeast: all[0].expPerHour * 0.9 });
        assert.deepStrictEqual(under[0].route, all[0].route);
        const over = rf.findRoutes({ ...args, bestOnly: true, atLeast: all[0].expPerHour * 1.1 });
        assert.ok(!over[0] || over[0].expPerHour < all[0].expPerHour * 1.1);
      }
    }
  }
});
