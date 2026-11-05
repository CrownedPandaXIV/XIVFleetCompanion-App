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
  check(await ev(`!!document.querySelector('.update-banner .update-whats-new')`), 'with a What\'s new button (the release notes on GitHub)');

  const log = fs.readFileSync(path.join(t.profile, 'logs', 'app.log'), 'utf8');
  const lines = log.split(/\r?\n/).filter((l) => l.includes('Update:')).map((l) => l.replace(/^.*?Update: /, ''));
  check(JSON.stringify(lines) === JSON.stringify(['up to date.', 'found version 9.9.9, downloading it.', 'version 9.9.9 is downloaded and ready to install.']),
    `the log has each step once: ${JSON.stringify(lines)}`);

  // Get test versions: off on a normal version, looks at the "testing" release once on, back to the releases once off.
  const feed = () => JSON.parse(fs.readFileSync(path.join(t.profile, 'feed.json'), 'utf8'));
  const toggle = `${section}.querySelector('.test-versions-toggle')`;
  check(await ev(`!!${toggle} && !${toggle}.checked`), 'Get test versions is there, and off');
  check(feed().provider === 'github', 'normal versions come from the newest release: ' + JSON.stringify(feed()));
  await ev(`${toggle}.click()`);
  await waitFor(`${toggle}.checked && ${section}.innerText.includes('every normal update too')`, 'test versions on', 5000);
  check(feed().provider === 'generic' && /releases\/download\/testing$/.test(feed().url), 'test versions come from the testing release: ' + JSON.stringify(feed()));
  check(JSON.parse(fs.readFileSync(path.join(t.profile, 'test-versions.json'), 'utf8')).testing === true, 'remembered on this PC');
  await ev(`${toggle}.click()`);
  await waitFor(`!${toggle}.checked`, 'test versions off', 5000);
  check(feed().provider === 'github', 'and back to the normal releases when turned off');
};

module.exports.env = () => ({ XIV_FLEET_TEST_FAKE_UPDATER: path.join(__dirname, '..', 'fake-updater.js') });
