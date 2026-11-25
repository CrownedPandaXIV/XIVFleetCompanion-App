// .github/scripts/test-version.sh: test versions count from 1 for each version of the app.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '.github', 'scripts', 'test-version.sh');
const next = (...args) => spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8' }).stdout.trim();

test('the first test version of a version is -test.1', () => {
  assert.strictEqual(next('1.13.3'), '1.13.3-test.1');
  assert.strictEqual(next('1.13.3', ''), '1.13.3-test.1');
});

test('the next test version is one above the one the testing release has', () => {
  assert.strictEqual(next('1.13.3', '1.13.3-test.4'), '1.13.3-test.5');
});

test('a new version starts at -test.1 again', () => {
  assert.strictEqual(next('1.13.3', '1.13.2-test.88'), '1.13.3-test.1');
  assert.strictEqual(next('1.13.3', '1.13.2'), '1.13.3-test.1');
});

test('a version that only starts the same does not count (1.13.30 is not 1.13.3)', () => {
  assert.strictEqual(next('1.13.3', '1.13.30-test.7'), '1.13.3-test.1');
});
