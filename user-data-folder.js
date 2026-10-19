// Where the app keeps its settings, saved connection and alert state: %APPDATA%\XIV Fleet Companion.
// Versions before 0.29.0 used %APPDATA%\fleet-tier3. The first time a newer version starts, that folder's
// contents are moved across, so nothing has to be set up again. If the move can't happen (another copy of
// the app has the old folder open), the old folder is used this time and the move is tried on the next start.
const fs = require('fs');
const path = require('path');

const OLD_NAME = 'fleet-tier3';
// A folder that holds this file has been set up (the saved, encrypted connection).
const MARKER = 'pg-credentials.enc';

// appData: %APPDATA%; folder: the new folder. Returns the folder to use. `fsys` is for the tests.
function chooseUserDataFolder(appData, folder, fsys = fs) {
  const old = path.join(appData, OLD_NAME);
  if (!fsys.existsSync(old) || fsys.existsSync(path.join(folder, MARKER))) return folder;
  try {
    if (!fsys.existsSync(folder)) {
      fsys.renameSync(old, folder);
    } else {
      // Something already made the new folder (Windows or Electron can), so move the old files into it one by
      // one, leaving anything already there alone.
      for (const name of fsys.readdirSync(old)) {
        if (!fsys.existsSync(path.join(folder, name))) fsys.renameSync(path.join(old, name), path.join(folder, name));
      }
      if (fsys.readdirSync(old).length === 0) fsys.rmdirSync(old);
    }
  } catch {
    // Part-way moves are fine: whichever folder now holds the saved connection is the one to use.
  }
  if (fsys.existsSync(path.join(folder, MARKER)) || !fsys.existsSync(path.join(old, MARKER))) return folder;
  return old;
}

module.exports = { chooseUserDataFolder, OLD_NAME };
