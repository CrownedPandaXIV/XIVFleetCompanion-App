// Stands in for electron-updater in the UI tests (XIV_FLEET_TEST_FAKE_UPDATER, see updater.js): the first look
// finds nothing newer, the next finds version 9.9.9 and "downloads" it in two steps. Nothing is downloaded or
// installed.
const { EventEmitter } = require('events');

const autoUpdater = new EventEmitter();
let looks = 0;
const later = (ms, fn) => setTimeout(fn, ms);

autoUpdater.checkForUpdates = async () => {
  looks += 1;
  autoUpdater.emit('checking-for-update');
  if (looks === 1) {
    later(300, () => autoUpdater.emit('update-not-available', { version: '0.0.0' }));
    return;
  }
  later(600, () => autoUpdater.emit('update-available', { version: '9.9.9' }));
  later(1200, () => autoUpdater.emit('download-progress', { percent: 50 }));
  later(2500, () => autoUpdater.emit('update-downloaded', { version: '9.9.9' }));
};
autoUpdater.quitAndInstall = () => {};

module.exports = { autoUpdater };
