const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const { chooseUserDataFolder } = require('./user-data-folder');

// Settings, the saved connection and the alert state live in %APPDATA%\XIV Fleet Companion, whether the app
// runs from the installer or from source; older versions' %APPDATA%\fleet-tier3 is moved there (see
// user-data-folder.js). Set before anything below reads the folder, and only when nothing has chosen another
// (the UI tests do).
const defaultUserData = path.join(app.getPath('appData'), app.getName());
if (app.getPath('userData') === defaultUserData) {
  app.setPath('userData', chooseUserDataFolder(app.getPath('appData'), path.join(app.getPath('appData'), 'XIV Fleet Companion')));
}
// PostgreSQL's backup tools, when Settings → Backups → Get the backup tools downloaded them (backups/get-tools.js).
require('./backups/tools').useAppTools(path.join(app.getPath('userData'), 'postgres-tools'));

// What the app prints also goes to logs\app.log in that folder (app-log.js). Not for Windows' permission-prompt
// runs (--fleet-setup), which run as the administrator and report back to the app that started them. The alert
// check runs every 5 minutes and keeps its own alerts.log, so only its warnings and errors go here.
if (!process.argv.includes('--fleet-setup')) {
  const { createLog, captureConsole } = require('./app-log');
  const alertCheck = process.argv.includes('--fleet-alerts');
  const log = captureConsole(createLog(path.join(app.getPath('userData'), 'logs')), console, { onlyProblems: alertCheck });
  const mode = process.argv.includes('--fleet-backup') ? 'daily backup' : 'window';
  if (!alertCheck) log.write('info', [`XIV Fleet Companion ${app.getVersion()} started (${mode}) on ${process.platform} ${require('os').release()}`]);
  app.on('render-process-gone', (event, contents, details) => {
    if (details.reason !== 'clean-exit') console.error('The window stopped:', details.reason, `(exit code ${details.exitCode})`);
  });
  app.on('child-process-gone', (event, details) => {
    if (details.reason !== 'clean-exit') console.error(`A ${details.type} process stopped:`, details.reason, `(exit code ${details.exitCode})`);
  });
}

const gameData = require('./db/game-data');
const { leaveRemovedOutOfTrends } = require('./db/trends-cleanup');
const { withClient } = require('./db');
const { startUpdates } = require('./updater');

// Each ipc/ file registers the calls the window can make for one area of the app.
require('./ipc/trends');
require('./ipc/game-data');
require('./ipc/settings');
require('./ipc/subs');
require('./ipc/roster');
require('./ipc/fight-club');
require('./ipc/parts');
require('./ipc/shopping');
require('./ipc/supplies');
require('./ipc/income');
require('./ipc/details');
require('./ipc/play-style');
require('./ipc/universalis');
require('./ipc/csv');
require('./ipc/retainers');
require('./ipc/inventory');
require('./ipc/alerts');
require('./ipc/updates');
require('./ipc/database');
require('./ipc/backups');
require('./ipc/setup-help');
require('./ipc/setup-wizard');
require('./ipc/remove-everything');
require('./ipc/move-database');
require('./ipc/leftovers');

let mainWindow;

// Started with --fleet-alerts (by the Windows scheduled task, see alerts/schedule.js): run one Discord
// alert check and quit, with no window.
const ALERTS_ONLY = process.argv.includes('--fleet-alerts');
// Started with --fleet-backup (by the daily backup task, see backups/schedule.js): make one backup and
// quit, with no window.
const BACKUP_ONLY = process.argv.includes('--fleet-backup');
// Started with --fleet-setup through Windows' permission prompt (see setup/elevated.js): install PostgreSQL
// or Tailscale, or let other PCs connect to PostgreSQL on this PC, then quit, with no window.
const SETUP_ONLY = process.argv.includes('--fleet-setup');
if (ALERTS_ONLY || BACKUP_ONLY || SETUP_ONLY) app.disableHardwareAcceleration();

function createWindow() {
  mainWindow = new BrowserWindow({
    title: `XIV Fleet Companion v${app.getVersion()}`,
    width: 1000,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Keep the version in the window title; otherwise the page's own <title> replaces it.
  mainWindow.on('page-title-updated', (event) => event.preventDefault());

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Rebuilds the SAME File/Edit/View/Window/Help menu Electron provides
  // by default (Menu.buildFromTemplate with no custom template gives you
  // that exact default) but with one new item added under File. Sending
  // an IPC message to the renderer - rather than trying to open the
  // Settings modal directly from main.js - keeps the "how" of opening
  // Settings in one place (App's own showSettings state), whether it's
  // triggered by the gear icon or this menu item.
  const menu = Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        {
          label: 'Settings',
          accelerator: 'CmdOrCtrl+,',
          click: () => mainWindow.webContents.send('open-settings')
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    { role: 'help', submenu: [] }
  ]);
  Menu.setApplicationMenu(menu);
}


app.whenReady().then(() => {
  if (ALERTS_ONLY) {
    require('./alerts/run').runFromCommandLine();
    return;
  }
  if (BACKUP_ONLY) {
    require('./backups/app').runFromCommandLine();
    return;
  }
  if (SETUP_ONLY) {
    require('./setup/elevated').runFromCommandLine();
    return;
  }
  createWindow();
  startUpdates();
  // Indexes and planner statistics for the game tables (see game-data.js). Quick when they are
  // already in place; skipped quietly when no connection is set up yet.
  withClient(
    async (client) => {
      const done = await gameData.prepareTables(client);
      if (done.indexesMade.length || done.analyzed.length) {
        console.log(`Game tables prepared: indexes made ${done.indexesMade.join(', ') || 'none'}; statistics refreshed for ${done.analyzed.join(', ') || 'none'}.`);
      }
      const cleaned = await leaveRemovedOutOfTrends(client);
      if (cleaned) console.log(`Characters removed earlier left out of Trends: ${cleaned.characterRows} character and ${cleaned.fcRows} Free Company rows.`);
    },
    (err) => console.error('Could not prepare the game tables:', err.message)
  ).catch(() => {});
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
