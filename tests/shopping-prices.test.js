// Market board prices on the Shopping List (subs/shopping-prices.js): the "Prices from" choices, the cheapest
// way to get each item, and a sub part's market price against what it costs to make.
const test = require('node:test');
const assert = require('node:assert');
const { priceChoices, costs, priceList } = require('../subs/shopping-prices');

const places = new Map([
  ['maduin', { dc: 'Dynamis', region: 'North-America' }],
  ['halicarnassus', { dc: 'Dynamis', region: 'North-America' }],
  ['gilgamesh', { dc: 'Aether', region: 'North-America' }],
  ['odin', { dc: 'Light', region: 'Europe' }],
]);

test('Prices from: each world the characters are on, their data centers and regions; the busiest data center first', () => {
  const { choices, fallback } = priceChoices([
    { world: 'Maduin', characters: 30 }, { world: 'Gilgamesh', characters: 40 }, { world: 'Halicarnassus', characters: 20 }, { world: 'Odin', characters: 1 },
  ], places);
  assert.deepStrictEqual(choices.map((c) => c.value), [
    'world:Gilgamesh', 'world:Halicarnassus', 'world:Maduin', 'world:Odin',
    'dc:Aether', 'dc:Dynamis', 'dc:Light',
    'region:Europe', 'region:North-America',
  ]);
  assert.deepStrictEqual(choices.filter((c) => c.kind === 'region').map((c) => [c.label, c.scope]), [['EU', 'Europe'], ['NA', 'North-America']]);
  assert.strictEqual(fallback, 'dc:Dynamis', 'Dynamis has 50 characters, Aether 40');
  // A world Universalis doesn't know: still a world choice, and the fallback.
  assert.deepStrictEqual(priceChoices([{ world: 'Newworld', characters: 3 }], places), {
    choices: [{ value: 'world:Newworld', label: 'Newworld', kind: 'world', scope: 'Newworld' }], fallback: 'world:Newworld',
  });
  assert.deepStrictEqual(priceChoices([], places), { choices: [], fallback: null });
});

// A Whale bow (22528) is made from 1 Ingot + 1 Lumber in phase 1 and 1 Ingot + 2 Fire Shards in phase 2. An
// Ingot is 3 Ore + 1 Fire Shard; 2 Logs make 2 Lumber.
const recipes = new Map([
  [22528, { yield: 1, ingredients: [{ itemId: 1, amount: 2 }, { itemId: 2, amount: 1 }, { itemId: 3, amount: 2 }] }],
  [1, { yield: 1, ingredients: [{ itemId: 10, amount: 3 }, { itemId: 3, amount: 1 }] }],
  [2, { yield: 2, ingredients: [{ itemId: 20, amount: 2 }] }],
]);

test('the cheapest way to get one: market board, vendor, or making it from the cheapest materials', () => {
  const market = new Map([[10, { price: 100, world: 'Maduin' }], [3, { price: 5, world: 'Maduin' }], [1, { price: 400, world: 'Maduin' }], [20, { price: 50, world: 'Maduin' }]]);
  const vendor = new Map([[20, 40]]);
  const { cheapest, makeCost } = costs({ market, vendor, recipes });
  assert.strictEqual(makeCost(1), 3 * 100 + 5, 'an Ingot made: 305');
  assert.strictEqual(cheapest(1), 305, 'cheaper made than its 400 listing');
  assert.strictEqual(cheapest(20), 40, 'the vendor sells Logs for less than the market board');
  assert.strictEqual(makeCost(2), 40, '2 Logs make 2 Lumber: 40 each');
  assert.strictEqual(makeCost(22528), 2 * 305 + 40 + 2 * 5, 'the bow: 660');
  // Something with no price anywhere: making it has no price either.
  const none = costs({ market: new Map(), vendor: new Map(), recipes });
  assert.strictEqual(none.makeCost(22528), null);
  assert.strictEqual(none.cheapest(10), null);
});

test('each part: buy or make, and the totals for buying instead', () => {
  const list = {
    parts: [{ itemId: 22528, crafts: 3, made: 1 }, { itemId: 22526, crafts: 2, made: 0 }],
    craft: [{ itemId: 1, make: 6 }],
    gather: [{ itemId: 10, short: 18 }, { itemId: 11, short: 4 }, { itemId: 12, short: 0 }],
    crystals: [{ itemId: 3, short: 10 }],
  };
  const market = new Map([[22528, { price: 600, world: 'Halicarnassus' }], [10, { price: 100, world: 'Maduin' }], [3, { price: 5, world: 'Maduin' }], [20, { price: 50, world: 'Maduin' }]]);
  const priced = priceList(list, { market, vendor: new Map(), recipes });
  const bow = priced.parts[0];
  assert.deepStrictEqual([bow.market, bow.makeCost, bow.cheaper], [{ price: 600, world: 'Halicarnassus' }, 670, 'buy'],
    'listed at 600, 2 x 305 + 50 + 10 = 670 to make');
  assert.deepStrictEqual([priced.parts[1].market, priced.parts[1].makeCost, priced.parts[1].cheaper], [null, null, null], 'not listed, no recipe here');
  assert.deepStrictEqual(priced.gather.map((r) => r.market && r.market.price), [100, null, null]);
  assert.deepStrictEqual(priced.marketTotals, {
    parts: 2 * 600, partsUnlisted: 1,       // two bows not made yet; the hull isn't listed
    materials: 18 * 100 + 10 * 5, materialsUnlisted: 1,  // item 11 isn't listed; item 12 isn't short
  });
});
