// Game data update and backups of the game (ffxiv_*) tables.
const fs = require('fs');
const path = require('path');
const { app, ipcMain } = require('electron');
const { withClient } = require('../db');
const gameData = require('../db/game-data');
const gameDataNotice = require('../db/game-data-notice');

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
      const checked = await gameData.checkAll(client, testCheckOptions());
      gameDataChecked = { at: Date.now(), ...checked };
      // Every table already matches the files: the game data is up to date as of the files' version, so the
      // window's "New game data is available" goes away.
      if (checked.version && checked.tables.every((t) => t.status === 'unchanged')) {
        await gameDataNotice.markUpToDate(client, checked.version.date).catch(() => {});
      }
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

// The UI tests have no internet: XIV_FLEET_TEST_GAME_DATA_BASE_URL points the game data downloads elsewhere.
function testCheckOptions() {
  const baseUrl = process.env.XIV_FLEET_TEST_GAME_DATA_BASE_URL;
  return baseUrl ? { baseUrl, fetchSourceVersion: false } : {};
}

// ---- "New game data is available" (db/game-data-notice.js) ----
// Asked by the window when it opens and every hour; GitHub itself is asked at most once a day across all PCs.
// "Later" is remembered on this PC until something newer changes.
const noticeFile = () => path.join(app.getPath('userData'), 'game-data-notice.json');

function readDismissed() {
  try {
    return JSON.parse(fs.readFileSync(noticeFile(), 'utf8')).dismissed || null;
  } catch {
    return null;
  }
}

// The UI tests have no internet: XIV_FLEET_TEST_GAME_DATA_CHANGES ({ File: date }) stands in for GitHub's answers.
function testFetch() {
  const fake = process.env.XIV_FLEET_TEST_GAME_DATA_CHANGES;
  if (fake === undefined) return undefined;
  const changes = JSON.parse(fake || '{}');
  return async (url) => {
    const file = /path=csv\/en\/([^.&]+)\.csv/.exec(url);
    const dates = file ? (changes[decodeURIComponent(file[1])] ? [changes[decodeURIComponent(file[1])]] : []) : Object.values(changes);
    return dates.map((date) => ({ commit: { committer: { date } } }));
  };
}

ipcMain.handle('game-data-notice:get', () => withClient(async (client) => {
  // (The fleet file's game data is updated from Settings > Data: no notice.)
  if (client.dialect === 'sqlite') return { success: true, available: false, files: [], newest: null };
  const found = await gameDataNotice.refresh(client, { fetch: testFetch() });
  if (found.error) console.log(`Game data: couldn't look for new game data (${found.error}); trying again in an hour.`);
  return { success: true, ...gameDataNotice.noticeFrom({ changes: found.changes, dismissed: readDismissed() }) };
}, (err) => ({ success: false, error: err.message })));

ipcMain.handle('game-data-notice:later', (event, newest) => {
  if (typeof newest !== 'string' || Number.isNaN(Date.parse(newest))) return { success: false, error: 'Not a date.' };
  fs.writeFileSync(noticeFile(), JSON.stringify({ dismissed: new Date(newest).toISOString() }));
  return { success: true };
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
