// The Discord alert settings: their keys in fleet_economics_settings (shared by every PC, edited in the
// app's Settings), defaults, and checks on what is saved. No Electron or pg here, so it can be tested on
// its own (tests/alerts.test.js). fleet_economics_settings only holds numbers, so on/off is 1/0, times
// of day are minutes after midnight, and the Discord user id is stored as a (large) number.

const ALERT_SETTING_KEYS = {
  enabled: 'alert_enabled',
  mentionUserId: 'alert_mention_user_id',
  subsOn: 'alert_subs_on',
  subIdleHours: 'alert_sub_idle_hours',
  retainersOn: 'alert_retainers_on',
  retainerIdleMinutes: 'alert_retainer_idle_minutes',
  suppliesOn: 'alert_supplies_on',
  houseOn: 'alert_house_on',
  buildOn: 'alert_build_on',
  undercutOn: 'alert_undercut_on',
  backupOn: 'alert_backup_on',
  summaryEvery: 'alert_summary_every',
  summaryTime: 'alert_summary_time',
  summaryDay: 'alert_summary_day',
  syncOn: 'alert_sync_on',
  syncStaleMinutes: 'alert_sync_stale_minutes',
  repeatHours: 'alert_repeat_hours',
  quietOn: 'alert_quiet_on',
  quietStart: 'alert_quiet_start',
  quietEnd: 'alert_quiet_end',
  quietMode: 'alert_quiet_mode',
  quietUntil: 'alert_quiet_until',
  pausedUntil: 'alert_paused_until',
  minGapMinutes: 'alert_min_gap_minutes',
};
// Written by the alert check each time it runs (Unix seconds), so Settings can show it is running.
const LAST_CHECK_KEY = 'alert_last_check_at';

// During quiet hours: hold everything until they end, or post without the @mention (no phone buzz).
const QUIET_HOLD = 1;
const QUIET_NO_MENTION = 2;

const ALERT_DEFAULTS = {
  enabled: true,
  mentionUserId: '',
  subsOn: true,
  subIdleHours: 2,
  retainersOn: true,
  retainerIdleMinutes: 30,
  suppliesOn: true,
  houseOn: true,
  buildOn: true,
  undercutOn: true,
  backupOn: true,
  // The Discord summary: 0 off, 1 daily, 7 weekly; at summaryTime (minutes after midnight, this PC's
  // time) and, weekly, on summaryDay (0 Sunday to 6 Saturday).
  summaryEvery: 0,
  summaryTime: 9 * 60,
  summaryDay: 1,
  syncOn: true,
  syncStaleMinutes: 30,
  repeatHours: 6,
  quietOn: false,
  quietStart: 23 * 60,
  quietEnd: 8 * 60,
  quietMode: QUIET_HOLD,
  quietUntil: 0,
  pausedUntil: 0,
  minGapMinutes: 30,
};

const BOOLEAN_KEYS = ['enabled', 'subsOn', 'retainersOn', 'suppliesOn', 'houseOn', 'buildOn', 'undercutOn', 'backupOn', 'syncOn', 'quietOn'];
const SUMMARY_CHOICES = [0, 1, 7];

// Limits for the number settings: [smallest, largest].
const LIMITS = {
  subIdleHours: [0.5, 48],
  retainerIdleMinutes: [10, 24 * 60],
  syncStaleMinutes: [10, 24 * 60],
  repeatHours: [1, 72],
  quietStart: [0, 24 * 60 - 1],
  quietEnd: [0, 24 * 60 - 1],
  minGapMinutes: [0, 240],
  summaryTime: [0, 24 * 60 - 1],
  summaryDay: [0, 6],
};

// A Discord user id ("snowflake"): 17 to 20 digits.
const USER_ID = /^\d{17,20}$/;

// The settings from fleet_economics_settings rows ({ setting_key, setting_value }), with defaults for
// anything missing or out of range.
function readAlertSettings(rows) {
  const byKey = {};
  for (const row of rows || []) byKey[row.setting_key] = row.setting_value;
  const settings = { ...ALERT_DEFAULTS };
  for (const [name, key] of Object.entries(ALERT_SETTING_KEYS)) {
    const raw = byKey[key];
    if (raw === undefined || raw === null) continue;
    if (name === 'mentionUserId') {
      const id = String(raw).replace(/\.0+$/, '');
      settings.mentionUserId = USER_ID.test(id) ? id : '';
      continue;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) continue;
    if (BOOLEAN_KEYS.includes(name)) settings[name] = n !== 0;
    else if (name === 'quietMode') settings.quietMode = n === QUIET_NO_MENTION ? QUIET_NO_MENTION : QUIET_HOLD;
    else if (name === 'summaryEvery') settings.summaryEvery = SUMMARY_CHOICES.includes(n) ? n : 0;
    else if (name === 'quietUntil' || name === 'pausedUntil') settings[name] = Math.max(0, n);
    else if (LIMITS[name] && n >= LIMITS[name][0] && n <= LIMITS[name][1]) settings[name] = n;
  }
  const lastCheck = Number(byKey[LAST_CHECK_KEY]);
  settings.lastCheckAt = Number.isFinite(lastCheck) && lastCheck > 0 ? lastCheck : null;
  return settings;
}

// Checks settings from the window before saving. Returns { ok: true, rows: [[key, value], ...] } or
// { ok: false, error } with a plain message.
function validateAlertSettings(input) {
  const s = { ...ALERT_DEFAULTS, ...(input || {}) };
  const id = String(s.mentionUserId || '').trim();
  if (id && !USER_ID.test(id)) {
    return { ok: false, error: 'The Discord user ID should be 17 to 20 digits (Discord: Settings → Advanced → Developer Mode, then right-click your name → Copy User ID).' };
  }
  const labels = {
    subIdleHours: 'Subs idle after (hours)',
    retainerIdleMinutes: 'Retainers without a venture after (minutes)',
    syncStaleMinutes: 'Plugin not syncing after (minutes)',
    repeatHours: 'Repeat every (hours)',
    quietStart: 'Quiet hours start',
    quietEnd: 'Quiet hours end',
    minGapMinutes: 'At most one message every (minutes)',
    summaryTime: 'Summary time',
    summaryDay: 'Summary day',
  };
  for (const [name, [min, max]] of Object.entries(LIMITS)) {
    const n = Number(s[name]);
    if (!Number.isFinite(n) || n < min || n > max) {
      return { ok: false, error: `${labels[name]} must be between ${min} and ${max}.` };
    }
  }
  if (s.quietOn && Number(s.quietStart) === Number(s.quietEnd)) {
    return { ok: false, error: 'Quiet hours need different start and end times.' };
  }
  const rows = [];
  for (const [name, key] of Object.entries(ALERT_SETTING_KEYS)) {
    if (name === 'quietUntil' || name === 'pausedUntil') continue; // changed by their own buttons
    let value = s[name];
    if (name === 'mentionUserId') value = id || null;
    else if (BOOLEAN_KEYS.includes(name)) value = value ? 1 : 0;
    else if (name === 'quietMode') value = Number(value) === QUIET_NO_MENTION ? QUIET_NO_MENTION : QUIET_HOLD;
    else if (name === 'summaryEvery') value = SUMMARY_CHOICES.includes(Number(value)) ? Number(value) : 0;
    else value = Number(value);
    rows.push([key, value]);
  }
  return { ok: true, rows };
}

// Whether the scheduled quiet hours cover `now` (milliseconds), in this PC's local time (start and end
// may cross midnight).
function inQuietHours(settings, now = Date.now()) {
  if (!settings.quietOn || settings.quietStart === settings.quietEnd) return false;
  const d = new Date(now);
  const minute = d.getHours() * 60 + d.getMinutes();
  return settings.quietStart < settings.quietEnd
    ? minute >= settings.quietStart && minute < settings.quietEnd
    : minute >= settings.quietStart || minute < settings.quietEnd;
}

// How alerts go out at `now`:
//   'hold'   nothing is posted (paused, or quiet hours set to hold); held alerts go out afterwards,
//   'silent' posted without the @mention ("quiet for N hours", or quiet hours set to no @mention),
//   'normal' posted with the @mention.
// `reason` says why, for Settings and the log.
function alertMode(settings, now = Date.now()) {
  const until = (s) => new Date(s * 1000).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  if (settings.pausedUntil && settings.pausedUntil * 1000 > now) return { mode: 'hold', reason: `paused until ${until(settings.pausedUntil)}` };
  const quietHours = inQuietHours(settings, now);
  if (quietHours && settings.quietMode === QUIET_HOLD) return { mode: 'hold', reason: 'quiet hours (holding alerts)' };
  if (settings.quietUntil && settings.quietUntil * 1000 > now) return { mode: 'silent', reason: `quiet (no @mention) until ${until(settings.quietUntil)}` };
  if (quietHours) return { mode: 'silent', reason: 'quiet hours (no @mention)' };
  return { mode: 'normal', reason: null };
}

module.exports = {
  ALERT_SETTING_KEYS, LAST_CHECK_KEY, ALERT_DEFAULTS, QUIET_HOLD, QUIET_NO_MENTION, SUMMARY_CHOICES,
  readAlertSettings, validateAlertSettings, inQuietHours, alertMode,
};
