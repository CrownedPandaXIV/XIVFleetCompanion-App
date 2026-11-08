// Where this PC's fleet is (db/fleet-store.js), and for the plugin's fleet file ("Just this PC"): the file's own
// notes, its backups (db/fleet-file-backups.js) and the app's game data file (db/game-data-file.js).
const path = require('path');
const { ipcMain, shell } = require('electron');
const db = require('../db');
const fleetStore = require('../db/fleet-store');
const backups = require('../db/fleet-file-backups');
const gameDataFile = require('../db/game-data-file');

// { location: 'file' | 'database' | 'none', file, choice ('thisPc' | 'shared' | null), plugin (the version that last
// set the file up), health (the plugin's last check of it: { ok, problems, at }) }.
ipcMain.handle('fleet:location', async () => {
  const location = db.fleetLocation();
  const file = db.fleetFile();
  const out = { success: true, location, file, choice: fleetStore.readStoreChoice(file), plugin: null, health: null };
  if (location !== 'file') return out;
  return db.withClient(async (client) => {
    const info = new Map((await client.query('SELECT key, value FROM companion_file_info')).rows.map((r) => [r.key, r.value]));
    out.plugin = info.get('app_version') || null;
    // The plugin's weekly check of the file (FileDatabase.CheckAsync): 'ok', or what it found.
    if (info.has('health_checked_at')) {
      const result = info.get('health_result') || '';
      out.health = { ok: result === 'ok', problems: result === 'ok' ? '' : result, at: info.get('health_checked_at') };
    }
    return out;
  }, () => out);
});

ipcMain.handle('fleet-file:backups', () => {
  try {
    return { success: true, folder: backups.folderOf(db.fleetFile()), kept: backups.KEPT,
      backups: backups.listBackups(db.fleetFile()).map(({ name, bytes, at }) => ({ name, bytes, at: at.toISOString() })) };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('fleet-file:back-up-now', () => {
  if (db.fleetLocation() !== 'file') return { success: false, error: 'This PC keeps its fleet in a shared database.' };
  try {
    return { success: true, name: path.basename(backups.backUpNow(db.fleetFile())) };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('fleet-file:open-folder', async () => {
  const folder = backups.folderOf(db.fleetFile());
  require('fs').mkdirSync(folder, { recursive: true });
  const problem = await shell.openPath(folder);
  return problem ? { success: false, error: problem } : { success: true };
});

ipcMain.handle('fleet-file:game-data-status', () => {
  try {
    const last = gameDataFile.lastUpdate(db.gameDataFile());
    return { success: true, last: last ? { appliedAt: last.applied_at, source: last.source, summary: last.summary } : null };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

let updating = false;
ipcMain.handle('fleet-file:game-data-update', async () => {
  if (updating) return { success: false, error: 'An update is already running.' };
  updating = true;
  try {
    const result = await gameDataFile.loadAll(db.gameDataFile());
    return { success: true, ...result };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    updating = false;
  }
});
