// The Discord alerts were removed in 1.7.0; their task and files are removed the first time the app starts.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { OLD_TASK_NAME, OLD_FILES, DONE_FILE, removeOldDiscordAlerts } = require('../setup/old-discord-alerts');

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'old-alerts-'));

// A stand-in for schtasks.exe: `hasTask` says whether the task is there; `deleteFails` makes /Delete fail.
function fakeSchtasks({ hasTask, deleteFails = false }) {
  const calls = [];
  const run = async (args) => {
    calls.push(args);
    if (args[0] === '/Query') return { ok: hasTask, output: hasTask ? 'Ready' : 'ERROR: The system cannot find the file specified.' };
    if (args[0] === '/Delete') return deleteFails ? { ok: false, output: 'Access is denied.' } : { ok: true, output: 'SUCCESS' };
    return { ok: false, output: '' };
  };
  return { run, calls };
}

test('a PC that had the alerts set up: the task and the webhook and alert files go, once', async () => {
  const dir = tempDir();
  for (const name of OLD_FILES) fs.writeFileSync(path.join(dir, name), 'x');
  fs.writeFileSync(path.join(dir, 'backups.json'), '{}');
  const schtasks = fakeSchtasks({ hasTask: true });
  const result = await removeOldDiscordAlerts(dir, { run: schtasks.run, platform: 'win32' });
  assert.deepStrictEqual(result, { task: true, files: OLD_FILES });
  assert.deepStrictEqual(schtasks.calls, [['/Query', '/TN', OLD_TASK_NAME], ['/Delete', '/TN', OLD_TASK_NAME, '/F']]);
  for (const name of OLD_FILES) assert.ok(!fs.existsSync(path.join(dir, name)), `${name} removed`);
  assert.ok(fs.existsSync(path.join(dir, 'backups.json')), 'other settings stay');
  assert.ok(fs.existsSync(path.join(dir, DONE_FILE)));

  const again = fakeSchtasks({ hasTask: true });
  assert.strictEqual(await removeOldDiscordAlerts(dir, { run: again.run, platform: 'win32' }), null, 'later starts do nothing');
  assert.deepStrictEqual(again.calls, [], 'and do not ask Windows again');
});

test('a PC that never set them up: nothing to remove, and nothing asked after that', async () => {
  const dir = tempDir();
  const schtasks = fakeSchtasks({ hasTask: false });
  assert.deepStrictEqual(await removeOldDiscordAlerts(dir, { run: schtasks.run, platform: 'win32' }), { task: false, files: [] });
  assert.deepStrictEqual(schtasks.calls, [['/Query', '/TN', OLD_TASK_NAME]], 'only looks for the task');
  assert.ok(fs.existsSync(path.join(dir, DONE_FILE)));
});

test('a task Windows will not remove is tried again at the next start', async () => {
  const dir = tempDir();
  const first = await removeOldDiscordAlerts(dir, { run: fakeSchtasks({ hasTask: true, deleteFails: true }).run, platform: 'win32' });
  assert.strictEqual(first.task, false);
  assert.match(first.error, /Access is denied/);
  assert.ok(!fs.existsSync(path.join(dir, DONE_FILE)), 'not marked done');
  assert.deepStrictEqual(await removeOldDiscordAlerts(dir, { run: fakeSchtasks({ hasTask: true }).run, platform: 'win32' }), { task: true, files: [] });
});

test('not on Windows: only the files', async () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'alerts.log'), 'x');
  const schtasks = fakeSchtasks({ hasTask: true });
  assert.deepStrictEqual(await removeOldDiscordAlerts(dir, { run: schtasks.run, platform: 'linux' }), { task: false, files: ['alerts.log'] });
  assert.deepStrictEqual(schtasks.calls, []);
});
