// Settings → General → Auto-Refresh: how often every page reloads its data, in whole minutes. Kept within a day,
// as a timer's delay can't be: a negative one, or one over about 24.8 days, fires straight away, which would
// reload every page nonstop. No Electron or pg here (tests/auto-refresh.test.js).

const AUTO_REFRESH_DEFAULT = 5;
const AUTO_REFRESH_LIMITS = [1, 24 * 60];

const validAutoRefresh = (n) => Number.isInteger(n) && n >= AUTO_REFRESH_LIMITS[0] && n <= AUTO_REFRESH_LIMITS[1];

// The saved value as minutes to use: the default when nothing usable is saved.
const autoRefreshSetting = (value) => {
  const n = value === null || value === undefined || value === '' ? NaN : Number(value);
  return validAutoRefresh(n) ? n : AUTO_REFRESH_DEFAULT;
};

// Why a value can't be saved, or null when it can.
const autoRefreshProblem = (minutes) => (validAutoRefresh(minutes)
  ? null
  : `Auto-refresh must be a whole number of minutes from ${AUTO_REFRESH_LIMITS[0]} to ${AUTO_REFRESH_LIMITS[1]}.`);

module.exports = { AUTO_REFRESH_DEFAULT, AUTO_REFRESH_LIMITS, autoRefreshSetting, autoRefreshProblem };
