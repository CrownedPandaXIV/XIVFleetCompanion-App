// The Windows scheduled task that makes the daily backup on this PC: it starts the app itself with
// --fleet-backup (no window opens). Made for the signed-in Windows user (no administrator rights), and
// set to run as soon as the PC is back on if it was off at that time. Also finds the task the earlier
// PowerShell backup scripts made ("Fleet database backup"), so its settings can be taken over and it
// can be removed.
const { run } = require('./tools');
const { taskToRun } = require('../alerts/schedule');

const TASK_NAME = 'XIV Fleet Companion backup';
const LEGACY_TASK_NAME = 'Fleet database backup';

const supported = () => process.platform === 'win32';

// appDir: the app's folder when run from source (electron.exe <folder>); null for the installed app.
function taskCommand(electronPath, appDir) {
  return appDir ? `"${electronPath}" "${appDir}" --fleet-backup` : `"${electronPath}" --fleet-backup`;
}

// A PowerShell string literal.
const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

function registerScript(electronPath, appDir, time) {
  const args = appDir ? `"${appDir}" --fleet-backup` : '--fleet-backup';
  return [
    `$action = New-ScheduledTaskAction -Execute ${psQuote(`"${electronPath}"`)} -Argument ${psQuote(args)}`,
    `$trigger = New-ScheduledTaskTrigger -Daily -At ${psQuote(time)}`,
    '$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 4)',
    `Register-ScheduledTask -TaskName ${psQuote(TASK_NAME)} -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null`,
  ].join('; ');
}

const powershell = (script) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]);

async function installBackupSchedule(electronPath, appDir, time) {
  if (!supported()) return { ok: false, error: 'Daily backups can only be scheduled on Windows. "Back up now" still works.' };
  const r = await powershell(registerScript(electronPath, appDir, time));
  return r.ok ? { ok: true } : { ok: false, error: `Windows could not create the scheduled task: ${(r.stderr || r.stdout).trim()}` };
}

async function removeTask(name) {
  if (!supported()) return { ok: true };
  const query = await run('schtasks.exe', ['/Query', '/TN', name]);
  if (!query.ok) return { ok: true };
  const r = await run('schtasks.exe', ['/Delete', '/TN', name, '/F']);
  return r.ok ? { ok: true } : { ok: false, error: `Windows could not remove the scheduled task "${name}": ${(r.stderr || r.stdout).trim()}` };
}
const removeBackupSchedule = () => removeTask(TASK_NAME);
const removeLegacySchedule = () => removeTask(LEGACY_TASK_NAME);

// From `schtasks /Query /V /FO LIST`: the line "<label>: value", or null.
function listValue(output, label) {
  const line = String(output || '').split(/\r?\n/).find((l) => new RegExp(`^\\s*${label}:`, 'i').test(l));
  return line ? line.replace(new RegExp(`^\\s*${label}:\\s*`, 'i'), '').trim() : null;
}

// The settings in the earlier scripts' task command:
// powershell.exe -NoProfile ... -File "...\backup.ps1" -Database fleet -DbHost localhost -Port 5432 -User x
// -BackupDir "E:\FleetBackups" -Keep 14 -CopyDir "\\LAPTOP\FleetBackups"
function parseLegacyCommand(command) {
  const out = {};
  const re = /-(BackupDir|CopyDir|Keep|Database|User)\s+(?:"([^"]*)"|(\S+))/gi;
  let m;
  while ((m = re.exec(String(command || '')))) out[m[1].toLowerCase()] = m[2] !== undefined ? m[2] : m[3];
  const settings = {};
  if (out.backupdir) settings.folder = out.backupdir;
  if (out.copydir) settings.copyFolder = out.copydir;
  if (out.keep && /^\d+$/.test(out.keep)) settings.keep = Number(out.keep);
  return settings;
}

// "3:30:00 AM" or "03:30:00" -> "03:30"; null when unreadable.
function parseStartTime(text) {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP]M)?$/i.exec(String(text || '').trim());
  if (!m) return null;
  let h = Number(m[1]);
  if (m[3]) h = (h % 12) + (/p/i.test(m[3]) ? 12 : 0);
  return h < 24 ? `${String(h).padStart(2, '0')}:${m[2]}` : null;
}

async function queryTask(name) {
  const r = await run('schtasks.exe', ['/Query', '/TN', name, '/V', '/FO', 'LIST']);
  return r.ok ? r.stdout : null;
}

// { supported, installed, current, nextRun, legacy: null or { settings } }. `current` is false when the
// task starts another copy of the app.
async function backupScheduleStatus(expectedCommand) {
  if (!supported()) return { supported: false, installed: false, legacy: null };
  const [mine, legacy] = await Promise.all([queryTask(TASK_NAME), queryTask(LEGACY_TASK_NAME)]);
  const status = { supported: true, installed: !!mine, current: null, nextRun: null, legacy: null };
  if (mine) {
    const command = taskToRun(mine);
    status.current = command ? command === expectedCommand : null;
    status.nextRun = listValue(mine, 'Next Run Time');
  }
  if (legacy) {
    const settings = parseLegacyCommand(taskToRun(legacy));
    const time = parseStartTime(listValue(legacy, 'Start Time'));
    if (time) settings.time = time;
    status.legacy = { settings };
  }
  return status;
}

module.exports = {
  TASK_NAME, LEGACY_TASK_NAME, taskCommand, registerScript, psQuote, parseLegacyCommand, parseStartTime, listValue,
  installBackupSchedule, removeTask, removeBackupSchedule, removeLegacySchedule, backupScheduleStatus,
};
