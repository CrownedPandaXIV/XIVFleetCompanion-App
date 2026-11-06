// Every Free Company with its house, bid eligibility and how long since the house was last entered.
// Used by the Free Companies tab and the Summary's house warning (ipc/inventory.js).
const { snapshotFragments } = require('../db');
const { warnDaysSetting } = require('./house-warning');
const { fcDirectorySql, fcDirectoryRows } = require('./fc-directory-rows');

// The house warning setting (days without anyone entering), from the Summary tab.
async function houseWarnDays(client) {
  const result = await client.query(
    `SELECT setting_value FROM fleet_economics_settings WHERE setting_key = 'house_warn_days'`);
  return warnDaysSetting(result.rows.length ? result.rows[0].setting_value : null);
}

async function loadFcDirectory(client) {
  const { latestFcMember } = await snapshotFragments(client);
  const result = await client.query(fcDirectorySql(latestFcMember));
  const warnDays = await houseWarnDays(client);
  return { rows: fcDirectoryRows(result.rows, warnDays), warnDays };
}

module.exports = { loadFcDirectory, houseWarnDays };
