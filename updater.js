// Updates for the installed app (Windows installer): new versions are published to the public
// CrownedPandaXIV/XIVFleetCompanion-Releases repository (package.json "build.publish"). The installed app
// looks there when it starts and every hour, or when "Check for updates" is clicked (Settings → General),
// downloads a new version in the background, and the window offers "Restart to update" once it is ready (it is
// also installed the next time the app is closed). Settings shows what it's doing (update-status.js) and the
// app's log records what it found. A copy run from source (npm start) does not look for updates.
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');
const { nextStatus, statusText, logLine } = require('./update-status');

// Where new versions are downloaded to (%LOCALAPPDATA%\<package name>-updater), as electron-updater names it.
// Versions before 0.33.8 were called fleet-tier3, so their folder is deleted once a newer version runs.
const OLD_DOWNLOAD_FOLDER = 'fleet-tier3-updater';
const downloadFolders = () => (process.env.LOCALAPPDATA
  ? [`${app.getName().toLowerCase()}-updater`, OLD_DOWNLOAD_FOLDER].map((name) => path.join(process.env.LOCALAPPDATA, name))
  : []);

const CHECK_EVERY_MS = Number(process.env.FLEET_UPDATE_CHECK_MS) || 60 * 60 * 1000;

let ready = null; // { version } once a new version is downloaded
let updater = null;
let status = { state: 'idle', source: false };
let settled = status; // the last status that wasn't 'checking', for the log
let lastEventAt = 0;
// A look or download that has said nothing for this long is taken as stuck, so the next look can start.
const STUCK_MS = 10 * 60 * 1000;

function tellWindows() {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send('update-ready', ready);
    win.webContents.send('update-status', shown());
  }
}

function onEvent(event, data) {
  lastEventAt = Date.now();
  status = nextStatus(status, event, data);
  if (status.state !== 'checking') {
    const line = logLine(settled, status);
    if (line) (status.state === 'error' ? console.error : console.log)(line);
    settled = status;
  }
  if (status.state === 'ready') ready = { version: status.version };
  tellWindows();
}

// The status with its line for the window.
const shown = () => ({ ...status, text: statusText(status) });

// Looks for a new version now, unless it already is (or one is downloading or downloaded).
function checkNow() {
  if (!updater || status.state === 'ready') return shown();
  if (['checking', 'downloading'].includes(status.state) && Date.now() - lastEventAt < STUCK_MS) return shown();
  updater.checkForUpdates().catch((err) => onEvent('error', err));
  return shown();
}

function startUpdates() {
  // The UI tests stand in a fake for electron-updater (XIV_FLEET_TEST_FAKE_UPDATER names it).
  const fake = process.env.XIV_FLEET_TEST_FAKE_UPDATER;
  if (!app.isPackaged && !fake) {
    status = { state: 'idle', source: true };
    return;
  }
  const old = downloadFolders()[1];
  if (old) fs.rm(old, { recursive: true, force: true }, () => {});
  const { autoUpdater } = fake ? require(fake) : require('electron-updater');
  updater = autoUpdater;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  for (const event of ['checking-for-update', 'update-available', 'update-not-available', 'download-progress', 'update-downloaded', 'error']) {
    autoUpdater.on(event, (data) => onEvent(event, data));
  }
  checkNow();
  setInterval(checkNow, CHECK_EVERY_MS);
}

// The downloaded version waiting to be installed ({ version }), or null; and what the update check is doing.
const updateReady = () => ready;
const updateStatus = () => shown();

// Closes the app and installs the downloaded version (the window's "Restart to update"), with the installer's
// progress window showing (not silent), and opens the app again once it's done.
function installUpdate() {
  if (ready && updater) updater.quitAndInstall(false, true);
}

module.exports = { startUpdates, updateReady, updateStatus, checkNow, installUpdate, downloadFolders };
