// The settings folder's move from %APPDATA%\fleet-tier3 to %APPDATA%\XIV Fleet Companion (app 0.29.0).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chooseUserDataFolder } = require('../user-data-folder');

function appData(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appdata-'));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}
const NEW = 'XIV Fleet Companion';
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');

test('a new install uses the new folder', () => {
  const dir = appData({});
  assert.strictEqual(chooseUserDataFolder(dir, path.join(dir, NEW)), path.join(dir, NEW));
});

test('the old folder is moved across, settings and all', () => {
  const dir = appData({ 'fleet-tier3/pg-credentials.enc': 'conn', 'fleet-tier3/backups.json': '{}', 'fleet-tier3/Local Storage/x': 'y' });
  assert.strictEqual(chooseUserDataFolder(dir, path.join(dir, NEW)), path.join(dir, NEW));
  assert.strictEqual(read(dir, `${NEW}/pg-credentials.enc`), 'conn');
  assert.strictEqual(read(dir, `${NEW}/Local Storage/x`), 'y');
  assert.ok(!fs.existsSync(path.join(dir, 'fleet-tier3')));
});

test('a new folder that already exists gets the old files, keeping its own', () => {
  const dir = appData({ 'fleet-tier3/pg-credentials.enc': 'conn', 'fleet-tier3/alerts.log': 'old', [`${NEW}/alerts.log`]: 'new' });
  assert.strictEqual(chooseUserDataFolder(dir, path.join(dir, NEW)), path.join(dir, NEW));
  assert.strictEqual(read(dir, `${NEW}/pg-credentials.enc`), 'conn');
  assert.strictEqual(read(dir, `${NEW}/alerts.log`), 'new');
});

test('once moved, a leftover old folder is left alone', () => {
  const dir = appData({ 'fleet-tier3/pg-credentials.enc': 'old', [`${NEW}/pg-credentials.enc`]: 'new' });
  assert.strictEqual(chooseUserDataFolder(dir, path.join(dir, NEW)), path.join(dir, NEW));
  assert.strictEqual(read(dir, 'fleet-tier3/pg-credentials.enc'), 'old');
});

test('when the old folder is in use and cannot be moved, it is used this time', () => {
  const dir = appData({ 'fleet-tier3/pg-credentials.enc': 'conn' });
  const locked = { ...fs, renameSync() { throw Object.assign(new Error('busy'), { code: 'EBUSY' }); } };
  assert.strictEqual(chooseUserDataFolder(dir, path.join(dir, NEW), locked), path.join(dir, 'fleet-tier3'));
});
