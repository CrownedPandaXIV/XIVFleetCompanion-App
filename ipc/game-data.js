// Game data update and backups of the game (ffxiv_*) tables.
const { ipcMain } = require('electron');
const { withClient } = require('../db');
const gameData = require('../db/game-data');

// ---- Game data update (ffxiv_* reference tables from the ffxiv-datamining repository) ----
// "Check" downloads and compares without changing anything and keeps the result for a while;
// "Apply" then loads exactly what was checked. Only one of them runs at a time.
const GAME_DATA_CHECK_MAX_AGE_MS = 30 * 60 * 1000;
let gameDataBusy = false;
let gameDataChecked = null; // { at, version, tables, pending }

function summarizeGameDataTable(t) {
  return {
    table: t.table,
    status: t.status,
    reason: t.reason,
    rowsBefore: t.rowsBefore,
    rowsAfter: t.rowsAfter,
    added: (t.added || []).map((a) => a.column),
    renamed: (t.renames || []).map((r) => ({ from: r.from, to: r.to })),
    kept: t.kept || [],
  };
}

ipcMain.handle('game-data-status', async () => {
  return withClient(async (client) => {
    const last = await gameData.lastUpdate(client);
    return { success: true, last: last ? { appliedAt: last.applied_at, source: last.source, summary: last.summary } : null };
  }, (err) => ({ success: false, error: err.message }));
});

ipcMain.handle('game-data-check', async () => {
  if (gameDataBusy) return { success: false, error: 'An update is already running.' };
  gameDataBusy = true;
  try {
    return await withClient(async (client) => {
      const checked = await gameData.checkAll(client);
      gameDataChecked = { at: Date.now(), ...checked };
      return { success: true, version: checked.version, tables: checked.tables.map(summarizeGameDataTable) };
    }, (err) => ({ success: false, error: err.message }));
  } finally {
    gameDataBusy = false;
  }
});

ipcMain.handle('game-data-apply', async (event, options) => {
  if (gameDataBusy) return { success: false, error: 'An update is already running.' };
  if (!gameDataChecked || Date.now() - gameDataChecked.at > GAME_DATA_CHECK_MAX_AGE_MS) {
    gameDataChecked = null;
    return { success: false, error: 'The check is out of date. Check for updates again first.' };
  }
  gameDataBusy = true;
  const checked = gameDataChecked;
  gameDataChecked = null;
  try {
    return await withClient(async (client) => {
      let backupName = null;
      if (options && options.backupFirst) {
        try {
          backupName = (await gameData.createBackup(client, { label: 'before update' })).name;
        } catch (err) {
          gameDataChecked = checked; // nothing changed, so the check is still valid
          return { success: false, error: `The backup could not be made, so nothing was changed (${err.message}).` };
        }
      }
      const results = await gameData.applyAll(client, checked);
      const done = results.filter((r) => r.status === 'updated');
      if (done.length) await gameData.recordUpdate(client, checked.version, results.filter((r) => r.status !== 'unchanged'));
      return { success: true, results, backupName };
    }, (err) => ({ success: false, error: err.message }));
  } finally {
    gameDataBusy = false;
  }
});

// Backups of the game tables: list, make one now, restore, delete.
async function gameDataBackupCall(work) {
  if (gameDataBusy) return { success: false, error: 'An update is already running.' };
  gameDataBusy = true;
  try {
    return await withClient(async (client) => ({ success: true, ...(await work(client)) }), (err) => ({ success: false, error: err.message }));
  } finally {
    gameDataBusy = false;
  }
}

ipcMain.handle('game-data-backups', () => withClient(
  async (client) => ({ success: true, backups: await gameData.listBackups(client), keep: gameData.KEEP_BACKUPS }),
  (err) => ({ success: false, error: err.message })
));
ipcMain.handle('game-data-backup-create', () => gameDataBackupCall(async (client) => {
  const made = await gameData.createBackup(client, { label: 'made by hand' });
  return { backupName: made.name };
}));
ipcMain.handle('game-data-backup-restore', (event, name) => gameDataBackupCall((client) => gameData.restoreBackup(client, name)));
ipcMain.handle('game-data-backup-delete', (event, name) => gameDataBackupCall(async (client) => {
  await gameData.deleteBackup(client, name);
  return {};
}));
