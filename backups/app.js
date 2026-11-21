// The app's side of backups: where its settings are kept on this PC, the saved database connection,
// and `--fleet-backup` (started by the daily scheduled task: one backup, then quit, with no window). That run
// also saves the subs' Next Rank dates for the Subs tab's forecast line, after the backup, so a PC with no
// window open still adds a set each day; that never changes how the backup went.
const { app } = require('electron');
const path = require('path');
const { loadPostgresConfig, followMoveNow } = require('../db');
const { loadBackupSettings, saveLastResult } = require('./settings');
const { findTools, serverMajor } = require('./tools');
const { backupNow } = require('./run');

const settingsFile = () => path.join(app.getPath('userData'), 'backups.json');

// Makes a backup with this PC's settings and records the result for Settings → Backups.
async function backupWithSettings() {
  const { settings } = loadBackupSettings(settingsFile());
  let result;
  let config = null;
  try {
    // If the database moved to another PC, back up the new one.
    await followMoveNow();
    config = loadPostgresConfig();
  } catch (err) {
    result = { ok: false, at: Date.now(), message: err.message };
  }
  if (config) {
    // Tools at least the database's version (pg_dump refuses a newer server).
    const tools = await findTools(settings.pgBin, { serverMajor: await serverMajor(config) });
    result = tools.found ? await backupNow({ tools, config, settings }) : { ok: false, at: Date.now(), message: tools.error };
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
  // At most a minute: saving the forecasts can wait on a database update or the first game data fill, and this hidden
  // run must still quit.
  await Promise.race([
    require('../ipc/subs').saveForecastsNow().catch((err) => console.error('Saving the forecasts:', err.message)),
    new Promise((resolve) => { setTimeout(resolve, 60000).unref(); }),
  ]);
  app.exit(code);
}

module.exports = { settingsFile, backupWithSettings, runFromCommandLine };
