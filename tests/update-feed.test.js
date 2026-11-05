// Test versions (update-feed.js): which versions are test versions, whether a PC gets them, and where it looks.
const test = require('node:test');
const assert = require('node:assert');
const { isTestVersion, testingWanted, feedFor, TESTING_URL } = require('../update-feed');

test("test versions are the release workflow's -test.N builds", () => {
  assert.ok(isTestVersion('1.6.0-test.12'));
  assert.ok(!isTestVersion('1.6.0'));
  assert.ok(!isTestVersion('1.6.0-beta.1'));
  assert.ok(!isTestVersion(undefined));
});

test('a PC gets test versions when Settings says so; with no choice yet, only when it runs one', () => {
  assert.strictEqual(testingWanted(null, '1.6.0'), false);
  assert.strictEqual(testingWanted(null, '1.6.0-test.3'), true, 'someone who installed a test version wants the next one');
  assert.strictEqual(testingWanted({ testing: false }, '1.6.0-test.3'), false, 'turned off stays off');
  assert.strictEqual(testingWanted({ testing: true }, '1.6.0'), true);
  assert.strictEqual(testingWanted({}, '1.6.0'), false);
});

test('normal updates come from the newest release, test versions from the "testing" release', () => {
  assert.deepStrictEqual(feedFor(false), { provider: 'github', owner: 'CrownedPandaXIV', repo: 'XIVFleetCompanion-Releases', releaseType: 'release' });
  assert.deepStrictEqual(feedFor(true), { provider: 'generic', url: TESTING_URL });
  assert.strictEqual(TESTING_URL, 'https://github.com/CrownedPandaXIV/XIVFleetCompanion-Releases/releases/download/testing');
});
