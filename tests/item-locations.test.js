const test = require('node:test');
const assert = require('node:assert');
const { placeLabel, groupByItem, likePattern } = require('../characters/item-locations');

test('places are named in plain words', () => {
  const label = (kind, container, extra = {}) => placeLabel({ kind, container, ...extra });
  assert.strictEqual(label('character', 2), 'Bags');
  assert.strictEqual(label('character', 4001), 'Saddlebag');
  assert.strictEqual(label('character', 4100), 'Premium saddlebag');
  assert.strictEqual(label('character', 2001), 'Crystals');
  assert.strictEqual(label('character', 3205), 'Armoury chest');
  assert.strictEqual(label('character', 1000), 'Equipped');
  assert.strictEqual(label('character', 27001, { containerName: 'HousingInteriorStoreroom1' }), 'House: HousingInteriorStoreroom1');
  assert.strictEqual(label('character', 2005, { containerName: 'HandIn' }), 'HandIn');
  assert.strictEqual(label('retainer', 10003, { retainerName: 'Amy' }), 'Retainer Amy');
  assert.strictEqual(label('retainer', 12002, { retainerName: 'Amy' }), 'Retainer Amy (for sale)');
  assert.strictEqual(label('retainer', 12001, { retainerName: 'Amy' }), 'Retainer Amy (crystals)');
  assert.strictEqual(label('fc', 20002), 'FC chest tab 3');
  assert.strictEqual(label('fc', 22001), 'FC crystals');
});

test('stacks are grouped per item and per place, in Roster order', () => {
  const stack = (who, kind, container, qty, extra = {}) => ({ itemId: 5057, name: 'Iron Ore', who, world: 'Maduin', kind, container, qty, ...extra });
  const bex = { owner: 'Bex', sortIndex: 2, account: 'Account 1' };
  const cal = { owner: 'Cal', sortIndex: 1, account: 'Account 2' };
  const items = groupByItem([
    stack('Bex', 'character', 0, 10, bex),
    stack('Bex', 'character', 1, 5, bex),
    stack('Bex', 'retainer', 10000, 40, { ...bex, retainerName: 'Zed', hireOrder: 2 }),
    stack('Bex', 'retainer', 10000, 1, { ...bex, retainerName: 'Amy', hireOrder: 1 }),
    stack('Bex', 'character', 4000, 30, bex),
    stack('Best Cats', 'fc', 20000, 7, { ...bex, world: null }),
    stack('Cal', 'character', 0, 3, cal),
    stack('Dee', 'character', 0, 99, { owner: 'Dee', sortIndex: null }),
    stack('Abe', 'character', 0, 1, { owner: 'Abe', sortIndex: null }),
    stack('Bex', 'character', 2, 0, bex),
  ]);
  assert.strictEqual(items[0].total, 196);
  assert.deepStrictEqual(items[0].places.map((p) => [p.who, p.where, p.qty]), [
    ['Cal', 'Bags', 3],
    ['Bex', 'Saddlebag', 30],
    ['Bex', 'Bags', 15],
    ['Bex', 'Retainer Amy', 1],
    ['Bex', 'Retainer Zed', 40],
    ['Best Cats', 'FC chest tab 1', 7],
    ['Abe', 'Bags', 1],
    ['Dee', 'Bags', 99],
  ]);
  assert.strictEqual(items[0].places[5].account, 'Account 1', 'the FC chest goes with the member holding it');
});

test('characters sharing a name on different worlds are kept apart, retainers like the Retainers tab', () => {
  const stack = (world, ownerKey, kind, container, qty, extra = {}) => ({
    itemId: 5530, name: 'Coke', who: "No'wa Sugu'ya", world, owner: "No'wa Sugu'ya", ownerKey, sortIndex: null, kind, container, qty, ...extra,
  });
  const items = groupByItem([
    stack('Maduin', '842', 'retainer', 10000, 5, { retainerName: 'Zed', hireOrder: 1 }),
    stack('Golem', '789', 'character', 0, 500),
    stack('Maduin', '842', 'character', 0, 100),
    stack('Golem', '789', 'retainer', 10000, 9, { retainerName: 'Bea', hireOrder: 2 }),
    stack('Golem', '789', 'retainer', 10000, 7, { retainerName: 'Amy', hireOrder: 2 }),
    stack('Golem', '789', 'retainer', 10000, 1, { retainerName: 'Cid', hireOrder: 1 }),
  ]);
  assert.deepStrictEqual(items[0].places.map((p) => `${p.world} ${p.where} ${p.qty}`), [
    'Golem Bags 500',
    'Golem Retainer Cid 1',
    'Golem Retainer Amy 7',
    'Golem Retainer Bea 9',
    'Maduin Bags 100',
    'Maduin Retainer Zed 5',
  ]);
});

test('items come in name order', () => {
  const items = groupByItem([
    { itemId: 2, name: 'Fire Shard', who: 'Cal', kind: 'character', container: 2001, qty: 9 },
    { itemId: 5057, name: 'Iron Ore', who: 'Cal', kind: 'character', container: 0, qty: 1 },
    { itemId: 5, name: 'Earth Shard', who: 'Cal', kind: 'character', container: 2001, qty: 1 },
  ]);
  assert.deepStrictEqual(items.map((i) => i.name), ['Earth Shard', 'Fire Shard', 'Iron Ore']);
});

test('search terms match anywhere, with % and _ taken literally', () => {
  assert.strictEqual(likePattern(' cobalt '), '%cobalt%');
  assert.strictEqual(likePattern('100%_x\\'), '%100\\%\\_x\\\\%');
});
