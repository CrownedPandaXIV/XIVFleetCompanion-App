// Characters synced by more than one setup of the plugin (characters/shared-sync.js): found from the account label
// changes the database logs, when a character's label goes back to one it had.
const test = require('node:test');
const assert = require('node:assert');
const { sharedCharacters } = require('../characters/shared-sync');

const change = (cid, at, from, to) => ({ cid, changed_at: `2026-11-0${at}T12:00:00Z`, old_value: from, new_value: to });

test('a label that keeps going back is two setups overwriting each other', () => {
  const found = sharedCharacters([
    change(1, 3, 'Account 2', 'Account R'),
    change(1, 2, 'Account R', 'Account 2'),
    change(1, 4, 'Account R', 'Account 2'),
  ]);
  assert.deepStrictEqual(found, [{ cid: '1', labels: ['Account R', 'Account 2'], switches: 3, last: '2026-11-04T12:00:00.000Z' }]);
});

test('a label renamed once, or renamed again to a new name, is not', () => {
  assert.deepStrictEqual(sharedCharacters([change(2, 1, 'Main', 'Account 1')]), []);
  assert.deepStrictEqual(sharedCharacters([change(3, 1, 'Main', 'Account1'), change(3, 2, 'Account1', 'Account 1')]), []);
  assert.deepStrictEqual(sharedCharacters([]), []);
});

test('a first label set, then switched back and forth, counts the unlabelled start too', () => {
  const found = sharedCharacters([change(4, 1, null, 'Account 1'), change(4, 2, 'Account 1', ''), change(4, 3, '', 'Account 1')]);
  assert.strictEqual(found.length, 1);
  assert.deepStrictEqual(found[0].labels, ['', 'Account 1']);
});

test('each character on its own, the most recent first', () => {
  const found = sharedCharacters([
    change(5, 1, 'A', 'B'), change(5, 2, 'B', 'A'),
    change(6, 3, 'A', 'C'), change(6, 4, 'C', 'A'),
    change(7, 5, 'A', 'B'),
  ]);
  assert.deepStrictEqual(found.map((f) => f.cid), ['6', '5']);
});
