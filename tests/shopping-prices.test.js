// Market board prices on the Shopping List (subs/shopping-prices.js): the "Prices from" choices, the cheapest
// way to get each item, and a sub part's market price against what it costs to make.
const test = require('node:test');
const assert = require('node:assert');
const { priceChoices, costs, buyingCost, priceList } = require('../subs/shopping-prices');

const place = (name, dc, region) => [name.toLowerCase(), { name, dc, region }];
const places = new Map([
  place('Maduin', 'Dynamis', 'North-America'), place('Halicarnassus', 'Dynamis', 'North-America'),
  place('Gilgamesh', 'Aether', 'North-America'), place('Odin', 'Light', 'Europe'), place('Bahamut', 'Gaia', 'Japan'),
]);

test('Prices from: every world, data center and region, with the busiest data center of yours to start', () => {
  const { choices, fallback } = priceChoices([
    { world: 'Maduin', characters: 30 }, { world: 'Gilgamesh', characters: 40 }, { world: 'Halicarnassus', characters: 20 },
  ], places);
  assert.deepStrictEqual(choices.filter((c) => c.kind === 'world').map((c) => c.label), [
    'Gilgamesh (Aether)', 'Halicarnassus (Dynamis)', 'Maduin (Dynamis)', 'Odin (Light)', 'Bahamut (Gaia)',
  ], 'your region first, then the rest; data center by data center, including ones none of your characters are on');
  assert.deepStrictEqual(choices.filter((c) => c.kind === 'dc').map((c) => c.value), ['dc:Aether', 'dc:Dynamis', 'dc:Light', 'dc:Gaia']);
  assert.deepStrictEqual(choices.filter((c) => c.kind === 'region').map((c) => [c.label, c.scope]), [['NA', 'North-America'], ['EU', 'Europe'], ['JP', 'Japan']]);
  assert.strictEqual(choices.find((c) => c.value === 'world:Maduin').scope, 'Maduin');
  assert.strictEqual(fallback, 'dc:Dynamis', 'Dynamis has 50 of your characters, Aether 40');
  // A world Universalis doesn't know: still listed, and the start when nothing else is yours.
  const odd = priceChoices([{ world: 'Newworld', characters: 3 }], places);
  assert.deepStrictEqual(odd.choices.filter((c) => c.kind === 'world').pop(), { value: 'world:Newworld', label: 'Newworld', kind: 'world', scope: 'Newworld' });
  assert.strictEqual(odd.fallback, 'world:Newworld');
  assert.deepStrictEqual(priceChoices([], new Map()), { choices: [], fallback: null });
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

test('buying several goes up the listings, cheapest first, and says when too few are listed', () => {
  const listings = [{ price: 600, quantity: 1 }, { price: 750, quantity: 2 }, { price: 900, quantity: 5 }];
  assert.deepStrictEqual(buyingCost(listings, 1), { gil: 600, got: 1 });
  assert.deepStrictEqual(buyingCost(listings, 4), { gil: 600 + 2 * 750 + 900, got: 4 }, 'not 4 x 600');
  assert.deepStrictEqual(buyingCost(listings, 10), { gil: 600 + 1500 + 4500, got: 8 }, 'only 8 listed');
  assert.deepStrictEqual(buyingCost([], 3), { gil: 0, got: 0 });
});

test('each part: buy or make, and the totals for buying instead', () => {
  const list = {
    parts: [{ itemId: 22528, crafts: 3, made: 0 }, { itemId: 22526, crafts: 2, made: 0 }],
    craft: [{ itemId: 1, make: 6 }],
    gather: [{ itemId: 10, short: 18 }, { itemId: 11, short: 4 }, { itemId: 12, short: 0 }],
    crystals: [{ itemId: 3, short: 10 }],
  };
  const listed = (price, world, more = []) => ({ price, world, listings: [{ price, quantity: 1, world }, ...more] });
  const market = new Map([
    // Two bows: one at 600, one at 800; three are wanted.
    [22528, listed(600, 'Halicarnassus', [{ price: 800, quantity: 1, world: 'Maduin' }])],
    [10, { price: 100, world: 'Maduin', listings: [{ price: 100, quantity: 10 }, { price: 120, quantity: 99 }] }],
    [3, { price: 5, world: 'Maduin', listings: [{ price: 5, quantity: 999 }] }],
    [20, { price: 50, world: 'Maduin', listings: [{ price: 50, quantity: 99 }] }],
  ]);
  const priced = priceList(list, { market, vendor: new Map(), recipes });
  const bow = priced.parts[0];
  assert.deepStrictEqual([bow.market.price, bow.makeCost, bow.cheaper], [600, 670, 'buy'], 'listed at 600, 2 x 305 + 50 + 10 = 670 to make');
  assert.deepStrictEqual(bow.buying, { gil: 1400, got: 2, wanted: 3 }, 'only two listed: 600 + 800');
  assert.deepStrictEqual([priced.parts[1].market, priced.parts[1].makeCost, priced.parts[1].cheaper, priced.parts[1].buying], [null, null, null, null]);
  assert.deepStrictEqual(priced.gather[0].buying, { gil: 10 * 100 + 8 * 120, got: 18, wanted: 18 });
  assert.deepStrictEqual(priced.marketTotals, {
    parts: 1400, partsUnlisted: 1, partsTooFew: 1,
    materials: 1960 + 10 * 5, materialsUnlisted: 1, materialsTooFew: 0,  // item 11 isn't listed; item 12 isn't short
  });
});
