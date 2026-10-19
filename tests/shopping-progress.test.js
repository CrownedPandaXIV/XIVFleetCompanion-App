const test = require('node:test');
const assert = require('node:assert');
const { reconcileProgress, setProgress, parseProgress } = require('../subs/shopping-progress');

test('ticks are remembered per part, never more than the list asks for', () => {
  let stored = setProgress({}, 21800, 2, 4);
  assert.deepStrictEqual(stored, { 21800: { made: 2, outOf: 4 } });
  stored = setProgress(stored, 21801, 9, 3);
  assert.deepStrictEqual(stored[21801], { made: 3, outOf: 3 }, 'capped at the crafts needed');
  assert.deepStrictEqual(setProgress(stored, 21800, 0, 4)[21800], undefined, '0 clears it');
});

test('crafted parts the plugin now sees as spares are taken back off, so they are not counted twice', () => {
  const stored = { 21800: { made: 3, outOf: 4 }, 21801: { made: 1, outOf: 1 } };
  const now = reconcileProgress(stored, [{ itemId: 21800, crafts: 2 }]);
  assert.deepStrictEqual(now, { 21800: { made: 1, outOf: 2 } }, 'two made parts reached a bag: one tick left of two to craft');
  assert.deepStrictEqual(reconcileProgress(stored, [{ itemId: 21800, crafts: 4 }]), { 21800: { made: 3, outOf: 4 } }, 'nothing changed');
  assert.deepStrictEqual(reconcileProgress(stored, [{ itemId: 21800, crafts: 6 }])[21800], { made: 3, outOf: 6 }, 'more needed (a new build): ticks kept');
  assert.deepStrictEqual(reconcileProgress(stored, []), {}, 'parts no longer on the list are forgotten');
});

test('saved text is read safely', () => {
  assert.deepStrictEqual(parseProgress('{"1":{"made":1,"outOf":2}}'), { 1: { made: 1, outOf: 2 } });
  assert.deepStrictEqual(parseProgress('not json'), {});
  assert.deepStrictEqual(parseProgress(null), {});
  assert.deepStrictEqual(parseProgress('[1]'), {});
});

test('Look ahead: ticks are kept per look-ahead, so changing it does not lose them', () => {
  const { reconcileByAhead } = require('../subs/shopping-progress');
  // Four made while looking 7 days ahead; looking at now only, the list asks for one.
  const stored = setProgress({ 21802: { made: 1, outOf: 2 } }, 21800, 4, 4, 7);
  assert.deepStrictEqual(stored[21800], { made: 4, outOf: 4, ahead: 7 });
  const lists = new Map([[0, [{ itemId: 21800, crafts: 1 }, { itemId: 21802, crafts: 2 }]], [7, [{ itemId: 21800, crafts: 4 }]]]);
  assert.deepStrictEqual(reconcileByAhead(stored, lists), stored, 'nothing changes: each tick is checked against its own list');
  // Two of them reach a bag: the 7-day list asks for two fewer.
  lists.set(7, [{ itemId: 21800, crafts: 2 }]);
  assert.deepStrictEqual(reconcileByAhead(stored, lists)[21800], { made: 2, outOf: 2, ahead: 7 });
});
