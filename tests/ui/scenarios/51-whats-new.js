// What's new: this PC last ran 1.4.5, so after updating the app shows what changed in each version since (newest
// first, from the changelog shipped with the app) until "Got it"; it stays away after that, and Settings → General
// → Updates → What's new shows the recent versions again.
const fs = require('fs');
const path = require('path');
const { version } = require('../../../package.json');

module.exports = async (t) => {
  const { ev, waitFor, check, shot } = t;
  const box = `document.querySelector('.whats-new')`;
  await waitFor(`!!${box}`, "the What's new box", 20000);
  const text = await ev(`${box}.innerText`);
  check(text.startsWith(`Updated to version ${version}.`), 'says the version it updated to: ' + text.split('\n')[0]);
  const shown = await ev(`[...${box}.querySelectorAll('.changelog-version h4')].map((h) => h.innerText)`);
  check(shown[0].startsWith(`Version ${version}`) && shown.some((h) => h.startsWith('Version 1.5.0')) && !shown.some((h) => /^Version 1\.4\.5\b/.test(h)),
    'every version after 1.4.5, newest first: ' + shown.join(' | '));
  check(await ev(`!!${box}.querySelector('li strong')`), 'bold kept from the changelog');
  check(await ev(`!${box}.innerHTML.includes('**')`), 'no markdown marks left');
  await shot('whats-new');

  await ev(`${box}.querySelector('.whats-new-done').click()`);
  await waitFor(`!${box}`, 'the box closed', 5000);
  const seen = JSON.parse(fs.readFileSync(path.join(t.profile, 'whats-new.json'), 'utf8'));
  check(seen.seen === version, `remembered as seen: ${JSON.stringify(seen)}`);
  check(await ev(`window.api.getWhatsNew().then((r) => r.versions.length)`) === 0, 'and not shown again');

  await ev(`document.querySelector('.gear-button').click()`);
  await waitFor(`!!document.querySelector('.settings-tab')`, 'Settings');
  await ev(`[...document.querySelectorAll('.settings-tab')].find((b) => b.innerText === 'General').click()`);
  await waitFor(`!!document.querySelector('.whats-new-open')`, "Settings' What's new button", 15000);
  await ev(`document.querySelector('.whats-new-open').click()`);
  await waitFor(`!!document.querySelector('.settings-whats-new .changelog-version')`, 'the recent versions', 5000);
  const recent = await ev(`[...document.querySelectorAll('.settings-whats-new .changelog-version h4')].map((h) => h.innerText)`);
  check(recent.length === 8 && recent[0].startsWith(`Version ${version}`), 'this version and the 7 before it: ' + recent.join(' | '));
  await shot('whats-new-settings');
};

module.exports.env = () => ({ XIV_FLEET_TEST_SEEN_VERSION: '1.4.5' });
