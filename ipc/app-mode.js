// What the app shows on this PC (shared/app-mode.js), and the Database Helper's home page.
const path = require('path');
const { app, ipcMain, BrowserWindow } = require('electron');
const { readAppMode, writeAppMode } = require('../shared/app-mode');
const { withClient, loadPostgresConfig } = require('../db');
const { listUpdates, BASELINE } = require('../db/apply-updates');

const modeFile = () => path.join(app.getPath('userData'), 'app-mode.json');

ipcMain.handle('app-mode:get', () => readAppMode(modeFile()));

ipcMain.handle('app-mode:set', (event, mode) => {
  try {
    writeAppMode(modeFile(), mode);
  } catch (err) {
    return { success: false, error: err.message };
  }
  console.log(`This PC now shows ${mode === 'tools' ? 'the Database Helper (database tools only)' : 'the whole app'}.`);
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('app-mode-changed', mode);
  }
  return { success: true, mode };
});

// The Database Helper's home page: where the database is (never the password), and how up to date it is.
ipcMain.handle('helper:overview', async () => {
  let config = {};
  try { config = loadPostgresConfig() || {}; } catch { /* no connection saved on this PC yet */ }
  const connection = config.host ? { host: config.host, port: config.port, database: config.database, user: config.user } : null;
  const latest = Math.max(BASELINE, ...listUpdates().map((u) => u.version));
  if (!connection) return { success: true, connection, latest, version: null };
  return withClient(async (client) => {
    const tracked = (await client.query(`SELECT to_regclass('companion_schema_version') IS NOT NULL AS t`)).rows[0].t;
    const version = tracked ? (await client.query('SELECT max(version) AS v FROM companion_schema_version')).rows[0].v : null;
    const pcs = (await client.query(`SELECT to_regclass('companion_pc_status') IS NOT NULL AS t`)).rows[0].t
      ? (await client.query('SELECT count(*)::int AS n FROM companion_pc_status')).rows[0].n : null;
    return { success: true, connection, latest, version, pcs };
  }, (err) => ({ success: false, connection, latest, version: null, error: err.message }));
});
