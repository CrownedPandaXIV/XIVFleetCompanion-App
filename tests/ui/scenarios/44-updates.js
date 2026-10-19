// Settings → General → Updates, with a stand-in for electron-updater (tests/ui/fake-updater.js): the look at start
// finds nothing newer, "Check for updates" finds version 9.9.9, shows the download, then the "Restart to update"
// bar appears; and the app's log records each step once.
const fs = require('fs');
const path = require('path');

module.exports = async (t) => {
  const { ev, waitFor, check } = t;
  const section = `document.querySelector('.updates-section')`;
  const statusText = () => ev(`${section}.querySelector('.updates-status').innerText`);

  await ev(`document.querySelector('.gear-button').click()`);
  await waitFor(`!!document.querySelector('.settings-tab')`, 'Settings');
  await ev(`[...document.querySelectorAll('.settings-tab')].find((b) => b.innerText === 'General').click()`);
  await waitFor(`!!${section} && /Up to date/.test(${section}.innerText)`, 'the look at start', 15000);
  check(/This is version \d+\.\d+\.\d+\./.test(await ev(`${section}.innerText`)), 'it says which version this is');
  check(/^Up to date\. Last looked just now\.$/.test(await statusText()), `nothing newer at start: ${await statusText()}`);
  check(await ev(`${section}.innerText.includes('every hour')`), 'it says it also looks by itself every hour');

  await ev(`${section}.querySelector('.updates-check').click()`);
  await waitFor(`/Downloading version 9\\.9\\.9 \\(50%\\)/.test(${section}.innerText)`, 'the download', 10000);
  check(await ev(`${section}.querySelector('.updates-check').disabled`), 'the button waits while it downloads');
  await waitFor(`/Version 9\\.9\\.9 is downloaded/.test(${section}.innerText)`, 'the downloaded version', 10000);
  check(true, 'then says the new version is downloaded');
  check(await ev(`!!document.querySelector('.update-banner') && document.querySelector('.update-banner').innerText.includes('Version 9.9.9 is ready')`), 'and the "Restart to update" bar appears');

  const log = fs.readFileSync(path.join(t.profile, 'logs', 'app.log'), 'utf8');
  const lines = log.split(/\r?\n/).filter((l) => l.includes('Update:')).map((l) => l.replace(/^.*?Update: /, ''));
  check(JSON.stringify(lines) === JSON.stringify(['up to date.', 'found version 9.9.9, downloading it.', 'version 9.9.9 is downloaded and ready to install.']),
    `the log has each step once: ${JSON.stringify(lines)}`);
};

module.exports.env = () => ({ XIV_FLEET_TEST_FAKE_UPDATER: path.join(__dirname, '..', 'fake-updater.js') });
