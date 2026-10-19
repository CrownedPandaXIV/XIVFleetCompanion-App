// Updates for the installed app (Windows installer): new versions are published to the public
// CrownedPandaXIV/XIVFleetCompanion-Releases repository (package.json "build.publish"). The installed app
// looks there when it starts and every 6 hours, downloads a new version in the background, and the window
// offers "Restart to update" once it is ready (it is also installed the next time the app is closed). A
// copy run from source (npm start) does not look for updates.
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

// Where new versions are downloaded to (%LOCALAPPDATA%\<package name>-updater), as electron-updater names it.
// Versions before 0.33.8 were called fleet-tier3, so their folder is deleted once a newer version runs.
const OLD_DOWNLOAD_FOLDER = 'fleet-tier3-updater';
const downloadFolders = () => (process.env.LOCALAPPDATA
  ? [`${app.getName().toLowerCase()}-updater`, OLD_DOWNLOAD_FOLDER].map((name) => path.join(process.env.LOCALAPPDATA, name))
  : []);

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

let ready = null; // { version } once a new version is downloaded
let updater = null;

function tellWindows() {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('update-ready', ready);
  }
}

function startUpdates() {
  if (!app.isPackaged) return;
  const old = downloadFolders()[1];
  if (old) fs.rm(old, { recursive: true, force: true }, () => {});
  const { autoUpdater } = require('electron-updater');
  updater = autoUpdater;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-downloaded', (info) => {
    ready = { version: info.version };
    tellWindows();
  });
  autoUpdater.on('error', (err) => console.error('Update check failed:', err.message));
  const check = () => autoUpdater.checkForUpdates().catch((err) => console.error('Update check failed:', err.message));
  check();
  setInterval(check, CHECK_EVERY_MS);
}

// The downloaded version waiting to be installed ({ version }), or null.
const updateReady = () => ready;

// Closes the app and installs the downloaded version (the window's "Restart to update"), with the installer's
// progress window showing (not silent), and opens the app again once it's done.
function installUpdate() {
  if (ready && updater) updater.quitAndInstall(false, true);
}

module.exports = { startUpdates, updateReady, installUpdate, downloadFolders };
