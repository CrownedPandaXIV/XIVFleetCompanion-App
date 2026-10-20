// Settings → Backups on a PC without PostgreSQL's tools: the warning says where to get them, and "Get the backup
// tools" answers through to the app (on Linux, where the UI tests run, with "Only on Windows."; the real download
// and a backup and restore with it run on Windows in the installer job of .github/workflows/test.yml).
const fs = require('fs');
const path = require('path');

module.exports = async (t) => {
  const { ev, waitFor, check, shot } = t;
  const section = `document.querySelector('.backups-section')`;
  // A tools folder with nothing in it: the tools aren't found.
  fs.writeFileSync(path.join(t.profile, 'backups.json'), JSON.stringify({ pgBin: path.join(t.profile, 'no-tools-here') }));

  await ev(`document.querySelector('.gear-button').click()`);
  await waitFor(`!!document.querySelector('.settings-tab')`, 'Settings');
  await ev(`[...document.querySelectorAll('.settings-tab')].find((b) => b.innerText === 'Backups').click()`);
  await waitFor(`!!${section} && !!${section}.querySelector('.backups-get-tools-button')`, 'the Get the backup tools button', 20000);
  const help = await ev(`${section}.querySelector('.backups-get-tools').innerText`);
  check(/in the version the database runs \(about 351 to 367 MB, once\)/.test(help) && /Nothing is installed/.test(help), 'says how big the download is and that nothing is installed: ' + help);
  await shot('backup-tools');
  await ev(`${section}.querySelector('.backups-get-tools-button').click()`);
  await waitFor(`/Only on Windows/.test((${section}.querySelector('.backups-status') || {}).innerText || '')`, 'the answer', 20000);
  check(true, 'the button reaches the app and its answer is shown');
};

module.exports.env = () => ({ XIV_FLEET_TEST_GET_TOOLS: '1' });
