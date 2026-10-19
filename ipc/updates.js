// The installed app's updates (updater.js): whether a new version is downloaded, "Restart to update", and
// Settings → General → Updates (what the check is doing, and "Check for updates").
const { app, ipcMain } = require('electron');
const { updateReady, updateStatus, checkNow, installUpdate } = require('../updater');

ipcMain.handle('get-update-ready', () => updateReady());
ipcMain.handle('install-update', () => installUpdate());
ipcMain.handle('updates:status', () => ({ version: app.getVersion(), status: updateStatus() }));
ipcMain.handle('updates:check', () => ({ version: app.getVersion(), status: checkNow() }));
