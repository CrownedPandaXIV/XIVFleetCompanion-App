const test = require('node:test');
const assert = require('node:assert');
const { voyagesFrom, lootSummary, ventureSummary, ventureTotals, ventureMarketGil, itemsValue, routeText } = require('../subs/loot');

const DAY = 24 * 60 * 60 * 1000;
const t1 = '2026-10-05T10:00:00Z';
const t2 = '2026-10-06T10:00:00Z';
const rows = [
  { fc_id: '9', sub_register: 100, returned_at: t1, sector: 15, sub_name: 'Sub-1', primary_item: 22500, primary_count: 3, additional_item: 22505, additional_count: 1 },
  { fc_id: '9', sub_register: 100, returned_at: t1, sector: 10, sub_name: 'Sub-1', primary_item: 5000, primary_count: 10, additional_item: 0, additional_count: 0 },
  { fc_id: '9', sub_register: 100, returned_at: t2, sector: 10, sub_name: 'Sub-1 Renamed', primary_item: 22507, primary_count: 1, additional_item: 0, additional_count: 0 },
  { fc_id: '9', sub_register: 100, returned_at: t2, sector: 15, sub_name: 'Sub-1 Renamed', primary_item: 22500, primary_count: 1, additional_item: 0, additional_count: 0 },
  { fc_id: '9', sub_register: 200, returned_at: t2, sector: 3, sub_name: null, primary_item: 22501, primary_count: 2, additional_item: 0, additional_count: 0 },
];
const prices = new Map([[22500, 8000], [22501, 9000], [22505, 28500], [22507, 34500], [5000, 3]]);
const letters = new Map([[10, 'J'], [15, 'O']]);

test('sector rows become voyages: one per sub and return time, items added up', () => {
  const voyages = voyagesFrom(rows);
  assert.strictEqual(voyages.length, 3);
  assert.deepStrictEqual(voyages[0].sectors, [10, 15], 'a voyage stored without its order has its sectors by number');
  assert.deepStrictEqual([...voyages[0].items], [[22500, 3], [22505, 1], [5000, 10]]);
  assert.strictEqual(routeText([15, 10], letters), 'O-J', 'the route is the sectors in the order run');
  assert.strictEqual(routeText([3], letters), '3', 'a sector with no letter shows its number');
});

test('sectors are in the order the voyage ran them (leg), not by number', () => {
  const v = voyagesFrom([
    { fc_id: '9', sub_register: 1, returned_at: t1, sector: 3, leg: 3, primary_item: 0, primary_count: 0 },
    { fc_id: '9', sub_register: 1, returned_at: t1, sector: 15, leg: 1, primary_item: 0, primary_count: 0 },
    { fc_id: '9', sub_register: 1, returned_at: t1, sector: 10, leg: 2, primary_item: 0, primary_count: 0 },
  ]);
  assert.deepStrictEqual(v[0].sectors, [15, 10, 3]);
  assert.strictEqual(lootSummary(v, { prices, letterFor: letters, windowDays: 1 }).subs[0].route, 'O-J-3');
});

test('per sub and per route: voyages, gil per voyage and per day, the newest name', () => {
  const s = lootSummary(voyagesFrom(rows), { prices, letterFor: letters, windowDays: 2 });
  const sub1 = s.subs.find((x) => x.register === '100');
  assert.deepStrictEqual([sub1.subName, sub1.voyages, sub1.gil, sub1.route], ['Sub-1 Renamed', 2, 3 * 8000 + 28500 + 30 + 34500 + 8000, 'J-O']);
  assert.strictEqual(sub1.perVoyage, sub1.gil / 2);
  assert.strictEqual(sub1.perDay, sub1.gil / 2);
  const sub2 = s.subs.find((x) => x.register === '200');
  assert.strictEqual(sub2.subName, null, 'a sub SubmarineTracker has no name for');
  assert.deepStrictEqual(s.routes.map((r) => [r.route, r.voyages, r.subs]), [['J-O', 2, 1], ['3', 1, 1]], 'routes, best gil per voyage first');
  assert.deepStrictEqual([s.totals.voyages, s.totals.gil], [3, sub1.gil + 18000]);
});

test('venture rewards per character: rewards, retainers and vendor value per day', () => {
  const v = ventureSummary(ventureTotals([
    { owner_cid: '1', retainer_name: 'A', item_id: 5000, quantity: 120 },
    { owner_cid: '1', retainer_name: 'B', item_id: 22500, quantity: 1 },
    { owner_cid: '2', retainer_name: 'C', item_id: 7777, quantity: 1 },
  ]), { prices, windowDays: 4 });
  assert.deepStrictEqual(v.map((o) => [o.ownerCid, o.rewards, o.retainers, o.gil, o.perDay]), [['1', 2, 2, 360 + 8000, 8360 / 4], ['2', 1, 1, 0, 0]],
    'an item with no known price counts as 0');
  assert.ok(DAY);
});

// Before 0.34.4 the app read every reward and added them up itself: one reward per row, the sums in JavaScript.
function oneByOne(rewards, { prices, windowDays }) {
  const byOwner = new Map();
  for (const r of rewards) {
    const key = String(r.owner_cid);
    if (!byOwner.has(key)) byOwner.set(key, { ownerCid: key, rewards: 0, items: new Map(), retainers: new Set() });
    const o = byOwner.get(key);
    o.rewards += 1;
    o.retainers.add(r.retainer_name);
    o.items.set(Number(r.item_id), (o.items.get(Number(r.item_id)) || 0) + (Number(r.quantity) || 0));
  }
  return [...byOwner.values()].map((o) => {
    const gil = itemsValue(o.items, prices);
    return { ownerCid: o.ownerCid, rewards: o.rewards, retainers: o.retainers.size, items: o.items, gil, perDay: gil / windowDays };
  });
}

test('venture rewards added up per character, item and quality give the same totals and market values', () => {
  let seed = 7;
  const random = (n) => { seed = (seed * 16807) % 2147483647; return seed % n; };
  const rewards = [];
  for (let i = 0; i < 3000; i++) {
    rewards.push({ owner_cid: String(1 + random(6)), retainer_name: `R${random(9)}`, item_id: [5000, 22500, 7777, 12345][random(4)], quantity: 1 + random(150), hq: random(3) === 0 });
  }
  const totals = ventureTotals(rewards);
  assert.ok(totals.length < 60, `${totals.length} rows instead of ${rewards.length}`);
  const sort = (list) => [...list].sort((a, b) => a.ownerCid.localeCompare(b.ownerCid));
  assert.deepStrictEqual(sort(ventureSummary(totals, { prices, windowDays: 7 })), sort(oneByOne(rewards, { prices, windowDays: 7 })));

  const market = new Map([[5000, 4], [22500, 9000], [7777, 50]]);
  const marketHq = new Map([[5000, 9], [22500, 9000], [12345, 300]]);
  for (let owner = 1; owner <= 6; owner++) {
    const mine = (list) => list.filter((r) => r.owner_cid === String(owner));
    assert.strictEqual(ventureMarketGil(mine(totals), market, marketHq), ventureMarketGil(mine(rewards), market, marketHq), `owner ${owner}`);
  }
});
