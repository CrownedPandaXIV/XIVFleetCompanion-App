// What the app shows on this PC (Settings → General → This PC shows, or the first-run setup):
//   fleet  the whole app (the default, and what every PC had before 1.9.0);
//   tools  the Database Helper: only the database tools (setup, the connection, moving it, backups and restore,
//          Remove everything) and the PCs list, for a PC that keeps the database or only plays with the plugin.
// Kept per PC in app-mode.json, in the app's settings folder. Nothing in the database changes either way.
const fs = require('fs');

const APP_MODES = ['fleet', 'tools'];
const DEFAULT_APP_MODE = 'fleet';

function readAppMode(file, fsys = fs) {
  try {
    const saved = JSON.parse(fsys.readFileSync(file, 'utf8'));
    return APP_MODES.includes(saved && saved.mode) ? saved.mode : DEFAULT_APP_MODE;
  } catch {
    return DEFAULT_APP_MODE;
  }
}

function writeAppMode(file, mode, fsys = fs) {
  if (!APP_MODES.includes(mode)) throw new Error(`Unknown mode: ${mode}`);
  fsys.writeFileSync(file, JSON.stringify({ mode }));
  return mode;
}

// The first-run setup's suggestion for each kind of PC (setup/installers.js ROLES): a PC that only plays has the
// app for setting up and the backups, so it starts on the Database Helper; the others start with the whole app.
const suggestedAppMode = (role) => (role === 'plugin' ? 'tools' : 'fleet');

module.exports = { APP_MODES, DEFAULT_APP_MODE, readAppMode, writeAppMode, suggestedAppMode };
