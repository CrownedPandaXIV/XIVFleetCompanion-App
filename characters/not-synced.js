// Characters the plugin no longer syncs: unticked in the plugin's Characters list (or gone from
// AutoRetainer) but not removed in the app, so their last data stays. Every sync writes every character
// it syncs, so such a character falls behind the rest of its account; a whole account that stopped (the
// game is closed) is not this, and has its own "Plugin not syncing" alert. No Electron or pg here
// (tests/not-synced.test.js).

const MINUTE = 60 * 1000;

// characters: [{ cid, account_label, last_synced_at }] (last_synced_at: a date or ISO text).
// Returns Map cid (text) -> how far behind its account's newest character it is (ms), for those at least
// `behindMinutes` behind.
function notSyncedCharacters(characters, behindMinutes) {
  const at = (c) => (c.last_synced_at ? new Date(c.last_synced_at).getTime() : NaN);
  const newest = new Map();
  for (const c of characters) {
    const t = at(c);
    if (!Number.isFinite(t)) continue;
    const label = c.account_label || 'Ungrouped';
    if (!newest.has(label) || t > newest.get(label)) newest.set(label, t);
  }
  const behind = new Map();
  for (const c of characters) {
    const t = at(c);
    if (!Number.isFinite(t)) continue;
    const lag = newest.get(c.account_label || 'Ungrouped') - t;
    if (lag >= behindMinutes * MINUTE) behind.set(String(c.cid), lag);
  }
  return behind;
}

// The "Plugin not syncing" alert setting (Settings → Discord Alerts), which also says how far behind
// its account a character must be to count as no longer synced. Uses an open pg client.
async function readBehindMinutes(client) {
  const { readAlertSettings, ALERT_SETTING_KEYS } = require('../alerts/settings');
  const { rows } = await client.query(
    'SELECT setting_key, setting_value FROM fleet_economics_settings WHERE setting_key = $1', [ALERT_SETTING_KEYS.syncStaleMinutes]);
  return readAlertSettings(rows).syncStaleMinutes;
}

module.exports = { notSyncedCharacters, readBehindMinutes };
