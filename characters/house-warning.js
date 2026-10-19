// How long since each Free Company house was last entered, and whether that needs a warning. The game
// demolishes an FC house when no member enters it for 45 days. The date comes from FCTracker (saved by the
// plugin as house_last_visited); AutoRetainer enters the house on every workshop trip, so a house that is
// running subs normally reads 0 or 1 days. No Electron or pg here, so it can be tested on its own
// (tests/house-warning.test.js).

const DEMOLITION_DAYS = 45;
// From here the Free Companies tab shows the age in red, whatever the warning setting is.
const DANGER_DAYS = 30;
// The Summary warns from this many days unless changed there (the house_warn_days setting).
const DEFAULT_WARN_DAYS = 7;
const DAY_MS = 86400000;

// Whole days since the house was last entered (0 = within the last 24 hours), or null if unknown.
function daysSince(lastVisited, now = Date.now()) {
  if (!lastVisited) return null;
  const at = new Date(lastVisited).getTime();
  if (!Number.isFinite(at)) return null;
  return Math.max(0, Math.floor((now - at) / DAY_MS));
}

// 'ok', 'warn' (at or past the warning setting), 'danger' (30+ days) or 'unknown' (a house with no date).
function houseLevel(days, warnDays = DEFAULT_WARN_DAYS) {
  if (days === null || days === undefined) return 'unknown';
  if (days >= DANGER_DAYS) return 'danger';
  if (days >= warnDays) return 'warn';
  return 'ok';
}

// The saved warning setting as a whole number of days from 1 to 44, or the default.
function warnDaysSetting(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n < DEMOLITION_DAYS ? n : DEFAULT_WARN_DAYS;
}

// Adds the age fields to one house row ({ has_house, house_last_visited, ... }).
function withHouseAge(row, warnDays, now = Date.now()) {
  if (!row.has_house) return { ...row, house_days: null, house_level: null, demolition_in_days: null };
  const days = daysSince(row.house_last_visited, now);
  return {
    ...row,
    house_days: days,
    house_level: houseLevel(days, warnDays),
    demolition_in_days: days === null ? null : Math.max(0, DEMOLITION_DAYS - days),
  };
}

module.exports = { DEMOLITION_DAYS, DANGER_DAYS, DEFAULT_WARN_DAYS, daysSince, houseLevel, warnDaysSetting, withHouseAge };
