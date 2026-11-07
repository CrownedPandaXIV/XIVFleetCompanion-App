// What the app shows on this PC (shared/app-mode.js): the whole app unless the Database Helper was chosen.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readAppMode, writeAppMode, suggestedAppMode, DEFAULT_APP_MODE } = require('../shared/app-mode');

test('a PC that never chose shows the whole app, as before 1.9.0', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-mode-'));
  assert.strictEqual(DEFAULT_APP_MODE, 'fleet');
  assert.strictEqual(readAppMode(path.join(dir, 'app-mode.json')), 'fleet');
  fs.writeFileSync(path.join(dir, 'broken.json'), '{not json');
  assert.strictEqual(readAppMode(path.join(dir, 'broken.json')), 'fleet');
  fs.writeFileSync(path.join(dir, 'odd.json'), JSON.stringify({ mode: 'something else' }));
  assert.strictEqual(readAppMode(path.join(dir, 'odd.json')), 'fleet');
});

test('the choice is kept, and only the two modes are accepted', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'app-mode-')), 'app-mode.json');
  writeAppMode(file, 'tools');
  assert.strictEqual(readAppMode(file), 'tools');
  writeAppMode(file, 'fleet');
  assert.strictEqual(readAppMode(file), 'fleet');
  assert.throws(() => writeAppMode(file, 'everything'));
  assert.strictEqual(readAppMode(file), 'fleet');
});

test('the first-run setup suggests the Database Helper only for a PC that just plays', () => {
  const { ROLES } = require('../setup/installers');
  assert.deepStrictEqual(Object.keys(ROLES).map((r) => [r, suggestedAppMode(r)]),
    [['onepc', 'fleet'], ['dbhost', 'fleet'], ['connect', 'fleet'], ['plugin', 'tools']]);
});
