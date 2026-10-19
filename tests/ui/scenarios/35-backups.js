// Settings → Backups: choose a folder, "Back up now" (with the real pg_dump, found on the PATH here), the
// backup listed, Test (loads it into a temporary database), Restore (a change made after the backup is
// undone, after a backup of how it was), Restore from a file (a backup kept anywhere else; a file that isn't one
// is turned down), and the command-line backup the daily scheduled task runs.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

module.exports = async (t) => {
  const { ev, waitFor, check } = t;
  const section = `document.querySelector('.backups-section')`;
  const setInput = (selector, value) => ev(`(() => { const el = ${section}.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  const click = (text, scope = section) => ev(`(() => { const b = [...${scope}.querySelectorAll('button')].find((x) => x.innerText.trim() === ${JSON.stringify(text)} && !x.disabled); if (!b) throw new Error('no ' + ${JSON.stringify(text)}); b.click(); return true; })()`);
  const waitStatus = (re, label, ms = 60000) => waitFor(`/${re.source}/.test((${section}.querySelector('.backups-status') || {}).innerText || '')`, label, ms);
  const rows = () => ev(`${section}.querySelectorAll('.backups-list tbody tr').length`);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-ui-backups-'));

  await waitFor(`document.querySelectorAll('.sidebar-button').length>0`, 'the app to load', 60000);
  await ev(`document.querySelector('.gear-button').click()`);
  await waitFor(`!!document.querySelector('.settings-tab')`, 'Settings');
  await ev(`[...document.querySelectorAll('.settings-tab')].find((b) => b.innerText === 'Backups').click()`);
  await waitFor(`!!${section} && ${section}.innerText.includes('No backup made by the app')`, 'the Backups section', 20000);
  check(!(await ev(`!!${section}.querySelector('.backups-no-tools')`)), 'PostgreSQL\'s tools are found');
  check(await ev(`${section}.innerText.includes('Daily backups are scheduled on Windows only')`), 'scheduling is Windows only (this is Linux)');

  await setInput('.backups-folder', folder);
  check(await ev(`[...${section}.querySelectorAll('button')].find((b) => b.innerText === 'Back up now').disabled`), '"Back up now" waits for the folder to be saved');
  await click('Save');
  await waitStatus(/^Saved\./, 'saved');
  await click('Back up now');
  await waitStatus(/Backed up \(/, 'the backup', 120000);
  check(await rows() === 1, 'the backup is listed');
  const files = fs.readdirSync(folder);
  check(files.some((f) => /^fleet-\d{8}-\d{6}\.dump$/.test(f)) && files.includes('backup.log'), `the backup and its log are in the folder: ${files.join(', ')}`);
  check(await ev(`${section}.querySelector('.backups-last').innerText.startsWith('Last backup:')`), 'the last backup is shown');

  await click('Test');
  await waitStatus(/The backup restores/, 'the test', 180000);
  check(true, 'Test loads it into a temporary database and finds every table');

  // A change after the backup, then Restore: it goes back, and how it was is backed up first.
  const [before] = await t.query(`SELECT setting_value FROM tier3_settings WHERE setting_key = 'auto_refresh_minutes'`);
  await t.query(`INSERT INTO tier3_settings (setting_key, setting_value) VALUES ('ui_backup_marker', 'after the backup')
    ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value`);
  await click('Restore...');
  await waitFor(`!!document.querySelector('.backups-confirm')`, 'the restore question');
  check(await ev(`document.querySelector('.backups-confirm').innerText.includes('everything recorded since')`), 'it says what restoring replaces');
  await click('Cancel', `document.querySelector('.backups-confirm')`);
  check(!(await ev(`!!document.querySelector('.backups-confirm')`)), 'Cancel changes nothing');
  await click('Restore...');
  await waitFor(`!!document.querySelector('.backups-confirm')`, 'the restore question again');
  await click('Restore', `document.querySelector('.backups-confirm')`);
  await waitStatus(/^Restored\./, 'the restore', 300000);
  const marker = await t.query(`SELECT 1 FROM tier3_settings WHERE setting_key = 'ui_backup_marker'`);
  check(marker.length === 0, 'the change made after the backup is gone');
  const [after] = await t.query(`SELECT setting_value FROM tier3_settings WHERE setting_key = 'auto_refresh_minutes'`);
  check(JSON.stringify(after) === JSON.stringify(before), 'and the rest is as it was');
  check(await rows() === 2, 'the database as it was before restoring is backed up first (two backups listed)');

  // Restore from a file: Windows' file window is skipped here (XIV_FLEET_TEST_PICK_FILE names the file).
  fs.writeFileSync(PICK, 'not a backup');
  await click('Restore from a file...');
  await waitStatus(/isn't a backup of the app's database, so it can't be restored/, 'a file that is not a backup is turned down', 30000);
  check(!(await ev(`!!document.querySelector('.backups-confirm')`)), 'and nothing is asked or restored');
  const oldest = fs.readdirSync(folder).filter((f) => f.endsWith('.dump')).sort()[0];
  fs.copyFileSync(path.join(folder, oldest), PICK);
  await t.query(`INSERT INTO tier3_settings (setting_key, setting_value) VALUES ('ui_backup_marker', 'before the file restore')
    ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value`);
  await click('Restore from a file...');
  await waitFor(`!!document.querySelector('.backups-confirm')`, 'the question for the picked file', 30000);
  const asked = await ev(`document.querySelector('.backups-confirm h2').innerText`);
  check(asked.startsWith(`Restore ${path.basename(PICK)} (`), `it names the file: ${asked}`);
  await click('Restore', `document.querySelector('.backups-confirm')`);
  await waitStatus(/^Restored\./, 'the restore from a file', 300000);
  check((await t.query(`SELECT 1 FROM tier3_settings WHERE setting_key = 'ui_backup_marker'`)).length === 0, 'the file restore put the database back too');
  check(await rows() === 3, 'and backed up how it was first');

  // The daily scheduled task's run: no window, one more backup, recorded for Settings.
  const code = await new Promise((resolve) => {
    const child = spawn(require('electron'), [path.join(__dirname, '..', 'launcher.js'), '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--fleet-backup'], {
      env: { ...process.env, UI_TEST_PROFILE: t.profile }, stdio: 'ignore',
    });
    const timer = setTimeout(() => { child.kill(); resolve('timed out'); }, 180000);
    child.on('exit', (c) => { clearTimeout(timer); resolve(c); });
  });
  check(code === 0, `the command-line backup finishes by itself (exit ${code})`);
  check(fs.readdirSync(folder).filter((f) => f.endsWith('.dump')).length === 4, 'and adds a backup');
  const saved = JSON.parse(fs.readFileSync(path.join(t.profile, 'backups.json'), 'utf8'));
  check(saved.last && saved.last.ok === true && saved.folder === folder, 'its result is recorded for Settings');
  await t.shot('backups');
  fs.rmSync(folder, { recursive: true, force: true });
  fs.rmSync(PICK, { force: true });
};

// The file "Restore from a file" picks, instead of Windows' file window.
const PICK = path.join(os.tmpdir(), 'fleet-ui-picked backup.dump');
module.exports.env = () => ({ XIV_FLEET_TEST_PICK_FILE: PICK });
