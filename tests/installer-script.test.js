// The Windows uninstaller's extra step (build/installer.nsh): it removes the backup and alert tasks, by the names
// the app gives them, and not when it runs as part of an update. The real install and uninstall run in the
// installer job of .github/workflows/test.yml.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const backups = require('../backups/schedule');
const alerts = require('../alerts/schedule');

const script = fs.readFileSync(path.join(__dirname, '..', 'build', 'installer.nsh'), 'utf8');

test('uninstalling removes the backup and alert tasks, by the names the app gives them', () => {
  for (const name of [backups.TASK_NAME, alerts.TASK_NAME]) {
    assert.ok(script.includes(`/Delete /TN "${name}" /F`), `removes "${name}"`);
  }
});

test('an update keeps the tasks', () => {
  const body = script.slice(script.indexOf('!macro customUnInstall'), script.indexOf('!macroend'));
  const guard = body.indexOf('${ifNot} ${isUpdated}');
  assert.ok(guard >= 0 && guard < body.indexOf('schtasks') && body.indexOf('${endIf}') > body.lastIndexOf('schtasks'), 'every removal is inside ifNot isUpdated');
});
