const test = require('node:test');
const assert = require('node:assert');
const { MIN_PLUGIN_VERSION, compareVersions, pcsNeedingUpdate } = require('../shared/plugin-version');

test('versions compare part by part, not as text', () => {
  assert.ok(compareVersions('0.10.0', '0.9.9') > 0);
  assert.ok(compareVersions('0.12.0', '0.12.0') === 0);
  assert.ok(compareVersions('0.12', '0.12.0') === 0);
  assert.ok(compareVersions('0.11.1', '0.12.0') < 0);
  assert.ok(compareVersions(null, '0.1.0') < 0, 'an unknown version is older');
  assert.ok(compareVersions('1.0.0.1', '1.0.0') > 0);
});

test('PCs whose plugin is older than the app needs are picked out', () => {
  const pcs = [{ pc_name: 'Laptop', plugin_version: '0.11.1' }, { pc_name: 'Desktop 1', plugin_version: MIN_PLUGIN_VERSION },
    { pc_name: 'Desktop 2', plugin_version: '0.14.1' }, { pc_name: 'Old', plugin_version: null }];
  assert.deepStrictEqual(pcsNeedingUpdate(pcs).map((p) => p.pc_name), ['Laptop', 'Old']);
  assert.deepStrictEqual(pcsNeedingUpdate(pcs, '0.1.0').map((p) => p.pc_name), ['Old']);
});
