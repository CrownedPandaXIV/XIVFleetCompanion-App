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

test('Look ahead: an old part from a build coming up only goes to a need coming up after it', () => {
  const ahead = (n) => ({ ...n, ahead: true });
  const needs = [
    need('Submersible-2', 0, 'Bow', 'Shark'),                                // needed now
    ahead(need('Submersible-1', 60, 'Bow', 'Whale', part('Shark'))),         // frees a Shark bow, later
    ahead(need('Submersible-3', 0, 'Hull', 'Unkiu', part('Shark'))),         // frees a Shark hull, later
    ahead(need('Submersible-4', 40, 'Bow', 'Shark', part('Unkiu'))),         // after Sub 1's: can have its bow
    ahead(need('Submersible-4', 40, 'Hull', 'Shark', part('Unkiu'))),        // after Sub 3's: can have its hull
  ];
  const result = matchNeeds(needs, []);
  assert.strictEqual(result[0].location, null, "today's need does not wait for an upgrade that is still to come");
  assert.deepStrictEqual(result.map((r) => r.recycledFrom), [null, null, null, 'Submersible-1', 'Submersible-3']);
  // A need coming up before the upgrade that frees the part: crafted instead.
  const early = matchNeeds([ahead(need('Submersible-4', 40, 'Bow', 'Shark')), ahead(need('Submersible-1', 60, 'Bow', 'Whale', part('Shark')))], []);
  assert.strictEqual(early[0].location, null);
  // A part an upgrade needed now frees can go to a need coming up.
  const fromNow = matchNeeds([need('Submersible-1', 60, 'Bow', 'Whale', part('Shark')), ahead(need('Submersible-4', 40, 'Bow', 'Shark'))], []);
  assert.strictEqual(fromNow[1].recycledFrom, 'Submersible-1');
});

test('Look ahead: a shorter look-ahead gives the same answers as the start of a longer one', () => {
  const ahead = (n, at) => ({ ...n, ahead: true, at });
  const all = [
    need('Submersible-1', 30, 'Bow', 'Whale', part('Shark')),
    ahead(need('Submersible-2', 40, 'Bow', 'Shark', part('Unkiu')), 1),
    ahead(need('Submersible-3', 50, 'Bow', 'Whale', part('Shark')), 2),
    ahead(need('Submersible-4', 20, 'Bow', 'Shark'), 3),
  ];
  const pool = () => [{ class: 'Whale', slot: 'Bow', modified: false, location: 'Inventory Box 1', qty: 1 }];
  const longer = matchNeeds(all, pool());
  for (let n = 1; n < all.length; n++) assert.deepStrictEqual(matchNeeds(all.slice(0, n), pool()), longer.slice(0, n));
});
