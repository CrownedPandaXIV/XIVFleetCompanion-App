// The installed app's updates (updater.js): whether a new version is downloaded, "Restart to update", and
// Settings → General → Updates (what the check is doing, and "Check for updates"). Also "What's new": what changed
// in the versions this PC hasn't run yet, from the changelog shipped with the app (shared/changelog.js).
const fs = require('fs');
const path = require('path');
const { app, ipcMain, shell } = require('electron');
const { updateReady, updateStatus, checkNow, installUpdate } = require('../updater');
const { parseChangelog, versionsSince } = require('../shared/changelog');
// This copy's version and changelog, from its own files (the same as app.getVersion() once installed).
const VERSION = require('../package.json').version;

ipcMain.handle('get-update-ready', () => updateReady());
ipcMain.handle('install-update', () => installUpdate());
ipcMain.handle('updates:status', () => ({ version: app.getVersion(), status: updateStatus() }));
ipcMain.handle('updates:check', () => ({ version: app.getVersion(), status: checkNow() }));

// The newest version this PC has been shown, kept in the app's settings folder.
const seenFile = () => path.join(app.getPath('userData'), 'whats-new.json');
function readSeen() {
  try {
    const { seen } = JSON.parse(fs.readFileSync(seenFile(), 'utf8'));
    return typeof seen === 'string' ? seen : null;
  } catch {
    return null;
  }
}
const writeSeen = (version) => fs.writeFileSync(seenFile(), JSON.stringify({ seen: version }));
function changelog() {
  try {
    return parseChangelog(fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8'));
  } catch {
    return [];
  }
}

// What changed since the version this PC last ran: [] when it has been shown already, and on a new install (nothing
// to compare with). A copy updated from before this was added has no record but has a saved connection: it is
// shown this version's changes.
ipcMain.handle('whats-new:get', () => {
  const current = VERSION;
  const seen = readSeen();
  if (!seen && !fs.existsSync(path.join(app.getPath('userData'), 'pg-credentials.enc'))) {
    writeSeen(current);
    return { current, versions: [] };
  }
  return { current, versions: seen === current ? [] : versionsSince(changelog(), seen, current) };
});
ipcMain.handle('whats-new:seen', () => { writeSeen(VERSION); return true; });
// Settings → General → Updates → What's new: this version and the few before it.
ipcMain.handle('whats-new:recent', () => ({ current: VERSION, versions: versionsSince(changelog(), '0.0.0', VERSION).slice(0, 8) }));
// "What's new" on the Restart to update bar: the new version's notes on its release page.
ipcMain.handle('whats-new:open-release', (event, version) => {
  if (!/^\d+\.\d+\.\d+$/.test(String(version))) return false;
  shell.openExternal(`https://github.com/CrownedPandaXIV/XIVFleetCompanion-Releases/releases/tag/v${version}`);
  return true;
});
