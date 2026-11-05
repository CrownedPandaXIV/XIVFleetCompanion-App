// Characters the plugin no longer syncs: unticked in the plugin's Characters list (or gone from
// AutoRetainer) but not removed in the app, so their last data stays. Every sync writes every character
// it syncs, so such a character falls behind the rest of its account; a whole account that stopped (the
// game is closed) is not this. No Electron or pg here
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

// How far behind its account a character must be to count as no longer synced: Settings → General →
// Warnings, shared by every PC (until app 1.7.0 this was the Discord alerts' "Plugin not syncing" setting,
// and database update 13 moved it here).
const BEHIND_MINUTES_KEY = 'not_synced_after_minutes';
const BEHIND_MINUTES_DEFAULT = 30;
const BEHIND_MINUTES_LIMITS = [10, 24 * 60];

const behindMinutesSetting = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= BEHIND_MINUTES_LIMITS[0] && n <= BEHIND_MINUTES_LIMITS[1] ? n : BEHIND_MINUTES_DEFAULT;
};

// Uses an open pg client.
async function readBehindMinutes(client) {
  const { rows } = await client.query(
    'SELECT setting_value FROM fleet_economics_settings WHERE setting_key = $1', [BEHIND_MINUTES_KEY]);
  return behindMinutesSetting(rows.length ? rows[0].setting_value : null);
}

module.exports = { BEHIND_MINUTES_KEY, BEHIND_MINUTES_DEFAULT, BEHIND_MINUTES_LIMITS, behindMinutesSetting, notSyncedCharacters, readBehindMinutes };
