// Backup settings for this PC (folders are this PC's own), kept in backups.json in the app's settings
// folder with the last backup's result. No Electron here, so it can be tested on its own
// (tests/backups.test.js).
const fs = require('fs');
const path = require('path');

const BACKUP_DEFAULTS = {
  enabled: false,     // the daily scheduled backup on this PC
  folder: '',         // where backups go
  copyFolder: '',     // optional second copy: another PC's shared folder, a USB drive, a cloud-synced folder
  keep: 14,           // newest backups kept in each folder
  time: '03:30',      // daily, this PC's time
  pgBin: '',          // PostgreSQL's bin folder, when it is not found by itself
};
const KEEP_LIMITS = [1, 365];

// The saved settings, with defaults for anything missing or wrong, plus the last result.
function loadBackupSettings(file) {
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
  } catch {
    saved = {};
  }
  const s = { ...BACKUP_DEFAULTS };
  if (typeof saved.enabled === 'boolean') s.enabled = saved.enabled;
  for (const key of ['folder', 'copyFolder', 'pgBin']) if (typeof saved[key] === 'string') s[key] = saved[key];
  const keep = Number(saved.keep);
  if (Number.isInteger(keep) && keep >= KEEP_LIMITS[0] && keep <= KEEP_LIMITS[1]) s.keep = keep;
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(saved.time)) s.time = saved.time;
  return { settings: s, last: saved.last && typeof saved.last === 'object' ? saved.last : null };
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// Checks settings from the window. Returns { ok: true, settings } or { ok: false, error }.
function validateBackupSettings(input) {
  const s = { ...BACKUP_DEFAULTS, ...(input || {}) };
  s.enabled = !!s.enabled;
  for (const key of ['folder', 'copyFolder', 'pgBin']) s[key] = String(s[key] || '').trim();
  if (s.enabled && !s.folder) return { ok: false, error: 'Choose a folder for the backups first.' };
  for (const key of ['folder', 'copyFolder']) {
    if (s[key] && !path.isAbsolute(s[key]) && !path.win32.isAbsolute(s[key])) {
      return { ok: false, error: `"${s[key]}" is not a full folder path (for example E:\\FleetBackups or \\\\LAPTOP\\FleetBackups).` };
    }
  }
  const same = (a, b) => a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase();
  if (s.folder && s.copyFolder && same(s.folder, s.copyFolder)) {
    return { ok: false, error: 'The second copy needs a different folder (ideally on another PC or drive).' };
  }
  const keep = Number(s.keep);
  if (!Number.isInteger(keep) || keep < KEEP_LIMITS[0] || keep > KEEP_LIMITS[1]) {
    return { ok: false, error: `Keep between ${KEEP_LIMITS[0]} and ${KEEP_LIMITS[1]} backups.` };
  }
  s.keep = keep;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(s.time))) return { ok: false, error: 'Choose a time such as 03:30.' };
  return { ok: true, settings: { enabled: s.enabled, folder: s.folder, copyFolder: s.copyFolder, keep: s.keep, time: s.time, pgBin: s.pgBin } };
}

function saveBackupSettings(file, settings) {
  const { last } = loadBackupSettings(file);
  writeJson(file, { ...settings, last });
}

function saveLastResult(file, last) {
  const { settings } = loadBackupSettings(file);
  writeJson(file, { ...settings, last });
}

module.exports = { BACKUP_DEFAULTS, KEEP_LIMITS, loadBackupSettings, validateBackupSettings, saveBackupSettings, saveLastResult };
