// The app's side of backups: where its settings are kept on this PC, the saved database connection,
// and `--fleet-backup` (started by the daily scheduled task: one backup, then quit, with no window).
const { app } = require('electron');
const path = require('path');
const { loadPostgresConfig, followMoveNow } = require('../db');
const { loadBackupSettings, saveLastResult } = require('./settings');
const { findTools } = require('./tools');
const { backupNow } = require('./run');

const settingsFile = () => path.join(app.getPath('userData'), 'backups.json');

// Makes a backup with this PC's settings and records the result for Settings → Backups.
async function backupWithSettings() {
  const { settings } = loadBackupSettings(settingsFile());
  let result;
  const tools = await findTools(settings.pgBin);
  if (!tools.found) {
    result = { ok: false, at: Date.now(), message: tools.error };
  } else {
    let config = null;
    try {
      // If the database moved to another PC, back up the new one.
      await followMoveNow();
      config = loadPostgresConfig();
    } catch (err) {
      result = { ok: false, at: Date.now(), message: err.message };
    }
    if (config) result = await backupNow({ tools, config, settings });
  }
  saveLastResult(settingsFile(), result);
  return result;
}

async function runFromCommandLine() {
  let code = 0;
  try {
    const result = await backupWithSettings();
    if (!result.ok) code = 1;
    else if (result.copyError) code = 2;
  } catch (err) {
    console.error(err);
    code = 1;
  }
  app.exit(code);
}

module.exports = { settingsFile, backupWithSettings, runFromCommandLine };
