const test = require('node:test');
const assert = require('node:assert');
const { detectPlayStyle, resolvePlayStyle, playStyleUses, hiddenViews, alertSettingsFor } = require('../shared/play-style');

test('worked out from the characters: built subs and retainers with a class', () => {
  assert.strictEqual(detectPlayStyle({ subs: 12, retainers: 30 }), 'both');
  assert.strictEqual(detectPlayStyle({ subs: 4, retainers: 0 }), 'subs');
  assert.strictEqual(detectPlayStyle({ subs: 0, retainers: 9 }), 'retainers');
  assert.strictEqual(detectPlayStyle({ subs: 0, retainers: 0 }), 'both', 'nothing yet: everything is shown');
  assert.strictEqual(detectPlayStyle(undefined), 'both');
});

test('a saved choice wins; anything else works it out', () => {
  assert.deepStrictEqual(resolvePlayStyle('subs', { subs: 0, retainers: 5 }), { choice: 'subs', style: 'subs' });
  assert.deepStrictEqual(resolvePlayStyle('auto', { subs: 0, retainers: 5 }), { choice: 'auto', style: 'retainers' });
  assert.deepStrictEqual(resolvePlayStyle(null, { subs: 3, retainers: 0 }), { choice: 'auto', style: 'subs' });
  assert.deepStrictEqual(resolvePlayStyle('nonsense', { subs: 3, retainers: 3 }), { choice: 'auto', style: 'both' });
});

test('tabs left out for what is not run', () => {
  assert.deepStrictEqual(hiddenViews('both'), []);
  assert.deepStrictEqual(hiddenViews('subs'), ['retainers']);
  assert.deepStrictEqual(hiddenViews('retainers'), ['salvage', 'subs', 'supplies', 'parts', 'routeOpt']);
  assert.deepStrictEqual(playStyleUses('retainers'), { subs: false, retainers: true });
});

test('alerts for what is not run are turned off, the rest as set', () => {
  const settings = { enabled: true, subsOn: true, suppliesOn: true, buildOn: false, retainersOn: true, undercutOn: true, houseOn: true };
  assert.deepStrictEqual(alertSettingsFor(settings, 'both'), settings);
  assert.deepStrictEqual(alertSettingsFor(settings, 'retainers'), { ...settings, subsOn: false, suppliesOn: false, buildOn: false });
  assert.deepStrictEqual(alertSettingsFor(settings, 'subs'), { ...settings, retainersOn: false, undercutOn: false });
});
