const test = require('node:test');
const assert = require('node:assert');
const { daysSince, houseLevel, warnDaysSetting, withHouseAge, DEFAULT_WARN_DAYS } = require('../characters/house-warning');

const DAY = 86400000;
const now = Date.parse('2026-10-03T21:00:00Z');

test('days since the house was last entered are whole days', () => {
  assert.strictEqual(daysSince(new Date(now - 2 * 3600000), now), 0, 'a few hours ago is today');
  assert.strictEqual(daysSince(new Date(now - DAY - 1), now), 1);
  assert.strictEqual(daysSince(new Date(now - 7.9 * DAY).toISOString(), now), 7, 'dates from the database can be strings');
  assert.strictEqual(daysSince(new Date(now + 3600000), now), 0, 'a clock slightly ahead is not negative');
  assert.strictEqual(daysSince(null, now), null);
  assert.strictEqual(daysSince('not a date', now), null);
});

test('levels: ok, then warn at the setting, then danger at 30 days', () => {
  assert.strictEqual(houseLevel(0, 7), 'ok');
  assert.strictEqual(houseLevel(6, 7), 'ok');
  assert.strictEqual(houseLevel(7, 7), 'warn');
  assert.strictEqual(houseLevel(29, 7), 'warn');
  assert.strictEqual(houseLevel(30, 7), 'danger');
  assert.strictEqual(houseLevel(31, 40), 'danger', 'red from 30 days even with a later warning');
  assert.strictEqual(houseLevel(null, 7), 'unknown');
});

test('the warning setting is 1 to 44 whole days, else the default of 7', () => {
  assert.strictEqual(DEFAULT_WARN_DAYS, 7);
  assert.strictEqual(warnDaysSetting('14'), 14, 'stored as numeric, read back as a string');
  assert.strictEqual(warnDaysSetting(null), 7);
  for (const bad of [0, 45, 2.5, 'x', -1]) assert.strictEqual(warnDaysSetting(bad), 7, String(bad));
});

test('house rows get their age and the days left before demolition is possible', () => {
  const at = (days) => new Date(now - days * DAY - 60000);
  assert.deepStrictEqual(
    (({ house_days, house_level, demolition_in_days }) => ({ house_days, house_level, demolition_in_days }))(withHouseAge({ has_house: true, house_last_visited: at(33) }, 7, now)),
    { house_days: 33, house_level: 'danger', demolition_in_days: 12 });
  assert.strictEqual(withHouseAge({ has_house: true, house_last_visited: at(50) }, 7, now).demolition_in_days, 0);
  const unknown = withHouseAge({ has_house: true, house_last_visited: null }, 7, now);
  assert.strictEqual(unknown.house_level, 'unknown');
  assert.strictEqual(unknown.demolition_in_days, null);
  const noHouse = withHouseAge({ has_house: false, house_last_visited: at(100), fc_name: 'X' }, 7, now);
  assert.strictEqual(noHouse.house_level, null, 'an FC without a house gets no warning');
  assert.strictEqual(noHouse.fc_name, 'X', 'other fields are kept');
});
