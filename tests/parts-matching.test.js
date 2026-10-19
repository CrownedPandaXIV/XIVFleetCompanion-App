const test = require('node:test');
const assert = require('node:assert');
const { matchNeeds } = require('../subs/parts-matching');

const need = (subName, rank, slotKey, cls, freed = null, modified = false) => ({ subName, rank, slotKey, cls, modified, freed });
const part = (cls, modified = false) => ({ cls, modified });

test("an upgrade's old part goes onto the new sub in the empty slot", () => {
  // Sub 3 swaps its Shark bow for an Unkiu bow; the empty slot needs a whole Shark sub.
  const needs = [
    need('Submersible-3', 15, 'Bow', 'Unkiu', part('Shark')),
    need('Submersible-4', 0, 'Hull', 'Shark'),
    need('Submersible-4', 0, 'Stern', 'Shark'),
    need('Submersible-4', 0, 'Bow', 'Shark'),
    need('Submersible-4', 0, 'Bridge', 'Shark'),
  ];
  const result = matchNeeds(needs, []);
  assert.strictEqual(result.filter((r) => !r.location).length, 4, 'four parts to craft, not five');
  assert.deepStrictEqual(result[3], { location: "Submersible-3's old Bow (once it is upgraded)", recycledFrom: 'Submersible-3' });
  assert.strictEqual(result[0].location, null, 'the Unkiu bow itself still needs crafting');
});

test('spares are used before old parts, and each old part is used once', () => {
  const pool = [{ class: 'Shark', slot: 'Bow', modified: false, location: 'Inventory Box 1', qty: 1 }];
  const needs = [
    need('Submersible-2', 20, 'Bow', 'Unkiu', part('Shark')),
    need('Submersible-3', 0, 'Bow', 'Shark'),
    need('Submersible-4', 0, 'Bow', 'Shark'),
    need('Submersible-4', 0, 'Hull', 'Shark'),
  ];
  const result = matchNeeds(needs, pool);
  assert.deepStrictEqual(result.map((r) => r.recycledFrom), [null, null, 'Submersible-2', null]);
  assert.strictEqual(result[1].location, 'Inventory Box 1');
  assert.strictEqual(result[3].location, null, 'no Shark hull is freed anywhere');
  assert.strictEqual(pool[0].qty, 0);
});

test('two subs can swap parts', () => {
  const needs = [
    need('Submersible-1', 30, 'Hull', 'Whale', part('Unkiu')),
    need('Submersible-2', 30, 'Hull', 'Unkiu', part('Whale')),
  ];
  assert.deepStrictEqual(matchNeeds(needs, []).map((r) => r.recycledFrom), ['Submersible-2', 'Submersible-1']);
});

test('old parts only fit the same slot, class and modified state', () => {
  const needs = [
    need('Submersible-1', 40, 'Bow', 'Whale', part('Shark', true)),
    need('Submersible-2', 0, 'Bow', 'Shark'),
    need('Submersible-2', 0, 'Bridge', 'Shark', null),
    need('Submersible-3', 50, 'Bow', 'Shark', part('Unkiu'), true),
  ];
  const result = matchNeeds(needs, []);
  assert.deepStrictEqual(result.map((r) => r.recycledFrom), [null, null, null, 'Submersible-1']);
});
