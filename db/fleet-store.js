// Where this PC's fleet is: in a shared PostgreSQL database, or in the plugin's fleet file ("Just this PC").
//
// The plugin keeps the file at %APPDATA%\XIV Fleet Companion\fleet.db, and its choice for the PC in store.json beside
// it (written when a game chooses or moves the fleet; every game on the PC follows it). The app follows the same
// choice, so moving the fleet in the game moves the app with it:
//   store.json says "thisPc"   -> the file (when it's there)
//   store.json says "shared"   -> the database
//   no store.json              -> the database when one is set up here, else the file when there is one
// Kept free of Electron so it can be tested.
const fs = require('fs');
const path = require('path');

const FOLDER = 'XIV Fleet Companion';
const FILE = 'fleet.db';
const GAME_DATA_FILE = 'game-data.db';

// appData: %APPDATA% (Electron's app.getPath('appData')).
function fleetFilePath(appData) {
  return path.join(appData, FOLDER, FILE);
}

// The plugin's choice for this PC: 'thisPc', 'shared' or null (none, or one that can't be read).
function readStoreChoice(fleetFile, fsys = fs) {
  try {
    const saved = JSON.parse(fsys.readFileSync(path.join(path.dirname(fleetFile), 'store.json'), 'utf8'));
    return saved && (saved.store === 'thisPc' || saved.store === 'shared') ? saved.store : null;
  } catch {
    return null;
  }
}

// 'file', 'database' or 'none' (nothing set up yet). hasDatabase: a connection is saved on this PC.
function whereIsTheFleet({ fleetFile, hasDatabase, fsys = fs }) {
  const choice = readStoreChoice(fleetFile, fsys);
  const fileThere = fsys.existsSync(fleetFile);
  if (choice === 'thisPc' && fileThere) return 'file';
  if (choice === 'shared') return hasDatabase ? 'database' : 'none';
  if (hasDatabase) return 'database';
  return fileThere ? 'file' : 'none';
}

module.exports = { FOLDER, FILE, GAME_DATA_FILE, fleetFilePath, readStoreChoice, whereIsTheFleet };
