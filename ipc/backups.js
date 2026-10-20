// Settings → Backups: this PC's backup settings, the daily scheduled task, "Back up now", testing a
// backup and restoring one. Only one of those runs at a time.
const { app, ipcMain, dialog, shell, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { loadPostgresConfig, recheckDatabase } = require('../db');
const { loadBackupSettings, validateBackupSettings, saveBackupSettings } = require('../backups/settings');
const { listBackups, backupTime } = require('../backups/files');
const os = require('os');
const { findTools, run } = require('../backups/tools');
const { getTools } = require('../backups/get-tools');
const { DOWNLOADS, downloadOnce } = require('../setup/installers');
const { testBackup, checkBackupFile, restoreBackup } = require('../backups/run');
const { settingsFile, backupWithSettings } = require('../backups/app');
const schedule = require('../backups/schedule');

const scheduleAppDir = () => (app.isPackaged ? null : app.getAppPath());
const expectedCommand = () => schedule.taskCommand(process.execPath, scheduleAppDir());

let busy = null;
async function exclusive(what, work) {
  if (busy) return { success: false, error: `Busy: ${busy}. Try again when it has finished.` };
  busy = what;
  try {
    return await work();
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    busy = null;
  }
}

function logTail(folder, lines = 15) {
  try {
    return fs.readFileSync(path.join(folder, 'backup.log'), 'utf8').split(/\r?\n/).filter(Boolean).slice(-lines);
  } catch {
    return [];
  }
}

// A backup the window asked for: only files listed in this PC's backup or copy folder.
function knownBackup(settings, file) {
  return [settings.folder, settings.copyFolder].filter(Boolean)
    .flatMap((f) => listBackups(f)).find((b) => b.file === file) || null;
}

ipcMain.handle('backups:get', async () => {
  const { settings, last } = loadBackupSettings(settingsFile());
  const [tools, scheduleStatus] = await Promise.all([findTools(settings.pgBin), schedule.backupScheduleStatus(expectedCommand())]);
  return {
    success: true,
    settings,
    last,
    busy,
    tools,
    schedule: scheduleStatus,
    backups: settings.folder ? listBackups(settings.folder) : [],
    copies: settings.copyFolder ? listBackups(settings.copyFolder) : [],
    log: settings.folder ? logTail(settings.folder) : [],
    // Get the backup tools is Windows only; the UI tests (on Linux) show its button to check it answers.
    windows: process.platform === 'win32' || !!process.env.XIV_FLEET_TEST_GET_TOOLS,
    toolsDownloadMb: DOWNLOADS.pgtools.sizeMb,
  };
});

ipcMain.handle('backups:save', async (event, input) => {
  const checked = validateBackupSettings(input);
  if (!checked.ok) return { success: false, error: checked.error };
  const s = checked.settings;
  if (s.pgBin) {
    const tools = await findTools(s.pgBin);
    if (!tools.found) return { success: false, error: tools.error };
  }
  saveBackupSettings(settingsFile(), s);
  const notes = [];
  if (s.enabled) {
    const installed = await schedule.installBackupSchedule(process.execPath, scheduleAppDir(), s.time);
    if (!installed.ok) return { success: false, error: `Saved, but ${installed.error}` };
    // The earlier PowerShell scripts' task would make a second backup each night.
    const status = await schedule.backupScheduleStatus(expectedCommand());
    if (status.legacy) {
      const removed = await schedule.removeLegacySchedule();
      notes.push(removed.ok ? 'The old backup task (from the PowerShell scripts) was removed; the app makes the backups now.' : removed.error);
    }
  } else {
    const removed = await schedule.removeBackupSchedule();
    if (!removed.ok) return { success: false, error: `Saved, but ${removed.error}` };
  }
  return { success: true, note: notes.join(' ') };
});

// Get the backup tools: PostgreSQL's pg_dump and pg_restore for a PC without PostgreSQL, in the app's own folder.
ipcMain.handle('backups:get-tools', (event) => exclusive('getting the backup tools', async () => {
  if (process.platform !== 'win32') return { success: false, error: 'Only on Windows.' };
  const send = (text) => { if (!event.sender.isDestroyed()) event.sender.send('backups:tools-progress', text); };
  const result = await getTools({
    file: DOWNLOADS.pgtools.x64,
    dir: path.join(app.getPath('userData'), 'postgres-tools'),
    tempDir: path.join(os.tmpdir(), 'xiv-fleet-downloads'),
    deps: {
      download: downloadOnce,
      powershell: (script) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]),
      version: (dump) => run(dump, ['--version']),
    },
    onProgress: send,
  });
  (result.ok ? console.log : console.error)(`Get the backup tools: ${result.ok ? `${result.version} in ${result.bin}` : result.message}`);
  return result.ok ? { success: true, version: result.version } : { success: false, error: result.message };
}));

ipcMain.handle('backups:choose-folder', async (event, { title, current } = {}) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, { title: title || 'Choose a folder', defaultPath: current || undefined, properties: ['openDirectory', 'createDirectory'] });
  return result.canceled || !result.filePaths.length ? null : result.filePaths[0];
});

ipcMain.handle('backups:open-folder', async (event, folder) => {
  const { settings } = loadBackupSettings(settingsFile());
  if (![settings.folder, settings.copyFolder].includes(folder) || !folder) return { success: false, error: 'Not a backup folder.' };
  const error = await shell.openPath(folder);
  return error ? { success: false, error } : { success: true };
});

ipcMain.handle('backups:run-now', () => exclusive('backing up', async () => {
  const result = await backupWithSettings();
  return result.ok ? { success: true, ...result } : { success: false, error: result.message };
}));

ipcMain.handle('backups:test', (event, file) => exclusive('testing a backup', async () => {
  const { settings } = loadBackupSettings(settingsFile());
  const backup = knownBackup(settings, file);
  if (!backup) return { success: false, error: 'That backup is not in the backup folders.' };
  const tools = await findTools(settings.pgBin);
  if (!tools.found) return { success: false, error: tools.error };
  const result = await testBackup({ tools, config: loadPostgresConfig(), file: backup.file });
  return result.ok ? { success: true, ...result } : { success: false, error: result.message, rows: result.rows };
}));

// Restores one backup file over the database the app uses (it is backed up first).
async function restoreFile(file) {
  const { settings } = loadBackupSettings(settingsFile());
  if (!settings.folder) return { success: false, error: 'Choose a backup folder first (the database is backed up there before restoring).' };
  const tools = await findTools(settings.pgBin);
  if (!tools.found) return { success: false, error: tools.error };
  const result = await restoreBackup({ tools, config: loadPostgresConfig(), settings, file });
  // The restored database may be on an older layout: check for database updates again.
  if (result.ok) recheckDatabase();
  (result.ok ? console.log : console.error)(`Restoring ${path.basename(file)}: ${result.message}`);
  return result.ok ? { success: true, message: result.message } : { success: false, error: result.message };
}

ipcMain.handle('backups:restore', (event, file) => exclusive('restoring a backup', async () => {
  const { settings } = loadBackupSettings(settingsFile());
  const backup = knownBackup(settings, file);
  if (!backup) return { success: false, error: 'That backup is not in the backup folders.' };
  return restoreFile(backup.file);
}));

// "Restore from a file...": a backup anywhere (another PC's folder, a USB drive), for example after the PC
// that had the database is lost. Only the file picked here can then be restored.
let pickedFile = null;
ipcMain.handle('backups:choose-file', async (event) => {
  // The UI tests can't click through Windows' file window, so they name the file instead.
  let file = process.env.XIV_FLEET_TEST_PICK_FILE || null;
  if (!file) {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose a backup to restore',
      properties: ['openFile'],
      filters: [{ name: 'Backups', extensions: ['dump'] }, { name: 'All files', extensions: ['*'] }],
    });
    if (result.canceled || !result.filePaths.length) return null;
    file = result.filePaths[0];
  }
  try {
    const { settings } = loadBackupSettings(settingsFile());
    const tools = await findTools(settings.pgBin);
    if (!tools.found) return { success: false, error: tools.error };
    const checked = await checkBackupFile({ tools, file });
    if (!checked.ok) return { success: false, error: checked.message };
    pickedFile = file;
    const stat = fs.statSync(file);
    return { success: true, file, name: path.basename(file), size: stat.size, takenAt: backupTime(path.basename(file)) || stat.mtimeMs };
  } catch (err) {
    return { success: false, error: `That file couldn't be checked: ${err.message}` };
  }
});

ipcMain.handle('backups:restore-file', (event, file) => exclusive('restoring a backup', async () => {
  if (!pickedFile || file !== pickedFile) return { success: false, error: 'Choose the backup again with Restore from a file.' };
  const r = await restoreFile(pickedFile);
  if (r.success) pickedFile = null;
  return r;
}));
