// Settings → General → Auto-Refresh stays whole minutes from 1 to a day (auto-refresh.js): a value outside that
// would make the page timer fire straight away and reload every page nonstop.
const test = require('node:test');
const assert = require('node:assert');
const { autoRefreshSetting, autoRefreshProblem, AUTO_REFRESH_DEFAULT } = require('../auto-refresh');

test('whole minutes from 1 to 1440 can be saved', () => {
  for (const ok of [1, 5, 60, 1440]) assert.strictEqual(autoRefreshProblem(ok), null, String(ok));
});

test('anything else is refused, with what is allowed', () => {
  for (const bad of [0, -5, 0.01, 2.5, 1441, 50000, NaN, Infinity, '5', null, undefined]) {
    assert.match(autoRefreshProblem(bad) || '', /whole number of minutes from 1 to 1440/, String(bad));
  }
});

test('a saved value that is no good reads as the usual 5 minutes', () => {
  assert.strictEqual(autoRefreshSetting('15'), 15);
  for (const bad of ['0', '-5', '0.01', '50000', 'abc', '', null, undefined]) {
    assert.strictEqual(autoRefreshSetting(bad), AUTO_REFRESH_DEFAULT, String(bad));
  }
});
