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
// Where it was told to look (updater.js, test versions on or off), kept in feed.json in the app's data folder.
autoUpdater.setFeedURL = (feed) => {
  if (process.env.UI_TEST_PROFILE) require('fs').writeFileSync(require('path').join(process.env.UI_TEST_PROFILE, 'feed.json'), JSON.stringify(feed));
};

module.exports = { autoUpdater };
