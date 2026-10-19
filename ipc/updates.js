// The installed app's updates (updater.js): whether a new version is downloaded, and "Restart to update".
const { ipcMain } = require('electron');
const { updateReady, installUpdate } = require('../updater');

ipcMain.handle('get-update-ready', () => updateReady());
ipcMain.handle('install-update', () => installUpdate());
