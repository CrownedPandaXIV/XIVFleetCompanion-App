const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadBackupSettings, validateBackupSettings, saveBackupSettings, saveLastResult, BACKUP_DEFAULTS } = require('../backups/settings');
const { backupName, backupTime, listBackups, backupsToRemove } = require('../backups/files');
const { servicePathsToFolders, firstWithTools } = require('../backups/tools');
const { taskCommand, registerScript, parseLegacyCommand, parseStartTime, listValue } = require('../backups/schedule');

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'backups-test-'));

test('settings: defaults when nothing is saved, and when what is saved is wrong', () => {
  const dir = tempDir();
  assert.deepStrictEqual(loadBackupSettings(path.join(dir, 'none.json')), { settings: BACKUP_DEFAULTS, last: null });
  fs.writeFileSync(path.join(dir, 'bad.json'), JSON.stringify({ enabled: 'yes', keep: 0, time: '25:00', folder: 5 }));
  assert.deepStrictEqual(loadBackupSettings(path.join(dir, 'bad.json')).settings, BACKUP_DEFAULTS);
  fs.writeFileSync(path.join(dir, 'broken.json'), '{');
  assert.deepStrictEqual(loadBackupSettings(path.join(dir, 'broken.json')).settings, BACKUP_DEFAULTS);
});

test('settings: saved settings and the last result are kept apart', () => {
  const file = path.join(tempDir(), 'sub', 'backups.json');
  saveBackupSettings(file, { ...BACKUP_DEFAULTS, enabled: true, folder: 'E:\\FleetBackups', keep: 7, time: '04:15' });
  saveLastResult(file, { ok: true, at: 1 });
  saveBackupSettings(file, { ...BACKUP_DEFAULTS, enabled: true, folder: 'E:\\FleetBackups', keep: 9, time: '04:15' });
  const { settings, last } = loadBackupSettings(file);
  assert.deepStrictEqual([settings.enabled, settings.folder, settings.keep, settings.time, last], [true, 'E:\\FleetBackups', 9, '04:15', { ok: true, at: 1 }]);
});

test('settings: checks before saving', () => {
  const ok = (over) => validateBackupSettings({ ...BACKUP_DEFAULTS, ...over });
  assert.match(ok({ enabled: true }).error, /Choose a folder/);
  assert.strictEqual(ok({ enabled: false }).ok, true, 'off without a folder is fine');
  assert.strictEqual(ok({ enabled: true, folder: 'E:\\FleetBackups' }).ok, true);
  assert.strictEqual(ok({ enabled: true, folder: '\\\\LAPTOP\\FleetBackups' }).ok, true);
  assert.strictEqual(ok({ enabled: true, folder: '/srv/backups' }).ok, true);
  assert.match(ok({ enabled: true, folder: 'backups' }).error, /not a full folder path/);
  assert.match(ok({ folder: 'E:\\FleetBackups', copyFolder: 'e:\\fleetbackups\\' }).error, /different folder/);
  assert.match(ok({ keep: 0 }).error, /Keep between/);
  assert.match(ok({ keep: 2.5 }).error, /Keep between/);
  assert.match(ok({ time: '3:30' }).error, /such as 03:30/);
  assert.deepStrictEqual(ok({ enabled: 1, folder: ' E:\\B ', keep: '7' }).settings,
    { enabled: true, folder: 'E:\\B', copyFolder: '', keep: 7, time: '03:30', pgBin: '' });
});

test('file names: this PC\'s time, read back, other files ignored', () => {
  const d = new Date(2026, 9, 17, 3, 30, 5);
  assert.strictEqual(backupName(d), 'fleet-20261017-033005.dump');
  assert.strictEqual(backupTime('fleet-20261017-033005.dump'), d.getTime());
  assert.strictEqual(backupTime('fleet-20261017-033005.dump.partial'), null);
  assert.strictEqual(backupTime('character-snapshot-20261017-033005.dump'), null);
});

test('listing a folder: newest first, with sizes; a missing folder is empty', () => {
  const dir = tempDir();
  for (const name of ['fleet-20261015-033000.dump', 'fleet-20261017-033000.dump', 'fleet-20261016-033000.dump', 'backup.log', 'fleet-20261018-033000.dump.partial']) {
    fs.writeFileSync(path.join(dir, name), 'xx');
  }
  const list = listBackups(dir);
  assert.deepStrictEqual(list.map((b) => b.name), ['fleet-20261017-033000.dump', 'fleet-20261016-033000.dump', 'fleet-20261015-033000.dump']);
  assert.strictEqual(list[0].size, 2);
  assert.deepStrictEqual(listBackups(path.join(dir, 'missing')), []);
  assert.deepStrictEqual(backupsToRemove(list, 2).map((b) => b.name), ['fleet-20261015-033000.dump']);
  assert.deepStrictEqual(backupsToRemove(list, 5), []);
});

test('PostgreSQL tools: the service\'s folder, and the first folder that has both tools', () => {
  const out = '"C:\\Program Files\\PostgreSQL\\16\\bin\\pg_ctl.exe" runservice -N "postgresql-x64-16" -D "C:\\Program Files\\PostgreSQL\\16\\data" -w\r\n'
    + 'E:\\SubmarineAI\\PostgreSQL\\pgsql\\bin\\pg_ctl.exe runservice -N "pg"\r\n\r\n';
  assert.deepStrictEqual(servicePathsToFolders(out), ['C:\\Program Files\\PostgreSQL\\16\\bin', 'E:\\SubmarineAI\\PostgreSQL\\pgsql\\bin']);
  const present = new Set([path.join('B', 'pg_dump.exe'), path.join('B', 'pg_restore.exe'), path.join('A', 'pg_dump.exe')]);
  assert.strictEqual(firstWithTools(['A', 'B'], (f) => present.has(f), 'win32'), 'B');
  assert.strictEqual(firstWithTools(['A'], (f) => present.has(f), 'win32'), null);
});

test('schedule: the command, and the PowerShell that registers it with quotes escaped', () => {
  assert.strictEqual(taskCommand('C:\\Apps\\XIV Fleet Companion.exe', null), '"C:\\Apps\\XIV Fleet Companion.exe" --fleet-backup');
  assert.strictEqual(taskCommand('C:\\e\\electron.exe', 'C:\\src\\app'), '"C:\\e\\electron.exe" "C:\\src\\app" --fleet-backup');
  const script = registerScript("C:\\Users\\O'Neil\\x.exe", null, '03:30');
  assert.match(script, /-Execute '"C:\\Users\\O''Neil\\x\.exe"'/);
  assert.match(script, /-Argument '--fleet-backup'/);
  assert.match(script, /-Daily -At '03:30'/);
  assert.match(script, /-StartWhenAvailable/);
});

test('the old PowerShell task: its folders, count and time are read', () => {
  const command = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "E:\\tier3-app-final\\backup\\backup.ps1" -Database fleet_warehouse -DbHost localhost -Port 5432 -User salvage_admin -BackupDir "E:\\FleetBackups" -Keep 14 -CopyDir "\\\\LAPTOP\\FleetBackups"';
  assert.deepStrictEqual(parseLegacyCommand(command), { folder: 'E:\\FleetBackups', copyFolder: '\\\\LAPTOP\\FleetBackups', keep: 14 });
  assert.deepStrictEqual(parseLegacyCommand('powershell.exe -File x.ps1 -Database fleet -BackupDir D:\\B'), { folder: 'D:\\B' });
  assert.strictEqual(parseStartTime('3:30:00 AM'), '03:30');
  assert.strictEqual(parseStartTime('12:05:00 AM'), '00:05');
  assert.strictEqual(parseStartTime('1:15:00 PM'), '13:15');
  assert.strictEqual(parseStartTime('04:15:00'), '04:15');
  assert.strictEqual(parseStartTime('N/A'), null);
  const list = 'HostName:      DESKTOP-2\r\nTaskName:      \\Fleet database backup\r\nNext Run Time: 10/18/2026 3:30:00 AM\r\nStart Time:    3:30:00 AM\r\n';
  assert.strictEqual(listValue(list, 'Next Run Time'), '10/18/2026 3:30:00 AM');
  assert.strictEqual(listValue(list, 'Start Time'), '3:30:00 AM');
  assert.strictEqual(listValue(list, 'Missing'), null);
});
