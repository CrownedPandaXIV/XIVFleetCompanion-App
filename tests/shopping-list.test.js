const test = require('node:test');
const assert = require('node:assert');
const { buildShoppingList } = require('../subs/shopping-list');

// A small made-up recipe tree: part 100 = 2x ingot 200 + 1x lumber 300 + 3x fire shard (2).
// Ingot 200 = 3x ore 400 + 1x fire shard, makes 1. Lumber 300 = 4x log 500, makes 2.
// Part 101 = 1x ingot 200 + 2x ore 400.
const recipes = new Map([
  [100, { yield: 1, job: 'Carpenter', ingredients: [{ itemId: 200, amount: 2 }, { itemId: 300, amount: 1 }, { itemId: 2, amount: 3 }] }],
  [101, { yield: 1, job: 'Blacksmith', ingredients: [{ itemId: 200, amount: 1 }, { itemId: 400, amount: 2 }] }],
  [200, { yield: 1, job: 'Blacksmith', ingredients: [{ itemId: 400, amount: 3 }, { itemId: 2, amount: 1 }] }],
  [300, { yield: 2, job: 'Carpenter', ingredients: [{ itemId: 500, amount: 4 }] }],
]);
const byId = (list) => Object.fromEntries(list.map((e) => [e.itemId, e]));

test('expands parts down to raw materials, with nothing held', () => {
  const r = buildShoppingList({ parts: new Map([[100, 3]]), recipes, held: new Map() });
  assert.deepStrictEqual(r.parts, [{ itemId: 100, need: 3, crafts: 3, job: 'Carpenter' }]);
  const craft = byId(r.craft);
  assert.strictEqual(craft[200].make, 6);
  assert.strictEqual(craft[300].make, 3);
  assert.strictEqual(craft[300].crafts, 2, 'lumber makes 2 per craft, so 3 needs 2 crafts');
  assert.deepStrictEqual(byId(r.gather)[400], { itemId: 400, need: 18, have: 0, short: 18 });
  assert.strictEqual(byId(r.gather)[500].need, 8);
  assert.deepStrictEqual(r.crystals, [{ itemId: 2, need: 15, have: 0, short: 15 }]);
});

test('held items are taken off once, across every recipe that uses them', () => {
  // Ingot is used by both parts: 2*1 + 1*1 = 3 ingots; 2 are held, so 1 is made.
  const r = buildShoppingList({ parts: new Map([[100, 1], [101, 1]]), recipes, held: new Map([[200, 2], [400, 1]]) });
  const ingot = byId(r.craft)[200];
  assert.deepStrictEqual([ingot.need, ingot.have, ingot.make], [3, 2, 1]);
  // Ore: 2 for part 101 + 3 for the one ingot made = 5, 1 held.
  assert.deepStrictEqual(byId(r.gather)[400], { itemId: 400, need: 5, have: 1, short: 4 });
});

test('an intermediate held in full needs none of its own materials', () => {
  const r = buildShoppingList({ parts: new Map([[100, 1]]), recipes, held: new Map([[200, 5], [300, 1]]) });
  assert.strictEqual(byId(r.craft)[200].make, 0);
  assert.strictEqual(byId(r.gather)[400], undefined, 'no ore needed');
  assert.strictEqual(byId(r.gather)[500], undefined, 'no logs needed');
  assert.deepStrictEqual(r.crystals, [{ itemId: 2, need: 3, have: 0, short: 3 }]);
});

test('held sub parts are not counted again (Parts already used the spares)', () => {
  const r = buildShoppingList({ parts: new Map([[100, 1]]), recipes, held: new Map([[100, 4]]) });
  assert.strictEqual(r.parts[0].crafts, 1);
});

test('crafted items come deepest first; a part with no recipe is flagged', () => {
  const deep = new Map(recipes);
  deep.set(400, { yield: 1, job: 'Miner?', ingredients: [{ itemId: 600, amount: 1 }] });
  const r = buildShoppingList({ parts: new Map([[100, 1], [999, 2]]), recipes: deep, held: new Map() });
  const ids = r.craft.map((e) => e.itemId);
  assert.ok(ids.indexOf(400) < ids.indexOf(200), 'ore is made before the ingot that uses it: ' + ids);
  assert.deepStrictEqual(r.parts.find((p) => p.itemId === 999), { itemId: 999, need: 2, crafts: 2, job: null, noRecipe: true });
});

test('a recipe loop does not hang', () => {
  const loop = new Map([
    [100, { yield: 1, job: 'X', ingredients: [{ itemId: 700, amount: 1 }] }],
    [700, { yield: 1, job: 'X', ingredients: [{ itemId: 701, amount: 1 }] }],
    [701, { yield: 1, job: 'X', ingredients: [{ itemId: 700, amount: 1 }] }],
  ]);
  const r = buildShoppingList({ parts: new Map([[100, 1]]), recipes: loop, held: new Map() });
  assert.strictEqual(r.parts.length, 1);
});

test('items bought from a vendor are not crafted, so their materials drop off', () => {
  // Buy the ingot (200) and the ore (400); the lumber is still crafted from logs.
  const r = buildShoppingList({ parts: new Map([[100, 2]]), recipes, held: new Map([[200, 1]]), buy: new Set([200, 400, 100]) });
  assert.deepStrictEqual(r.buy, [{ itemId: 200, need: 4, have: 1, short: 3 }], 'ore is no longer needed at all');
  assert.strictEqual(byId(r.craft)[200], undefined);
  assert.strictEqual(byId(r.craft)[300].make, 2);
  assert.strictEqual(byId(r.gather)[400], undefined);
  assert.deepStrictEqual(r.crystals, [{ itemId: 2, need: 6, have: 0, short: 6 }], 'only the parts\' own shards, none for ingots');
  assert.strictEqual(r.parts[0].crafts, 2, 'a sub part is never bought, even if listed');
});
