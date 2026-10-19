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
