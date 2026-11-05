// The Discord alerts were removed in app 1.7.0. A PC that had them set up still has their pieces: a Windows
// scheduled task that started the app every 5 minutes with --fleet-alerts, the webhook address (encrypted)
// and the alert check's own files in the app's settings folder. They are removed the first time 1.7.0 or
// later starts (or is started by that task), so nothing is left behind and nobody has to clean up by hand.
// No Electron here, so it can be tested on its own (tests/old-discord-alerts.test.js).
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const OLD_TASK_NAME = 'Fleet Companion alerts';
const OLD_FILES = ['discord-webhook.enc', 'alerts-state.json', 'alerts.log'];
// Written once everything is gone, so later starts don't ask Windows about the task again.
const DONE_FILE = 'discord-alerts-removed';

function schtasks(args) {
  return new Promise((resolve) => {
    execFile('schtasks.exe', args, { windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, output: String(stderr || stdout || (err && err.message) || '').trim() });
    });
  });
}

// userDir: the app's settings folder. Returns what was removed: { task, files: [...] }; null when this
// already ran. A task Windows won't remove is tried again at the next start.
async function removeOldDiscordAlerts(userDir, { run = schtasks, platform = process.platform } = {}) {
  const done = path.join(userDir, DONE_FILE);
  if (fs.existsSync(done)) return null;
  const files = [];
  for (const name of OLD_FILES) {
    try {
      fs.unlinkSync(path.join(userDir, name));
      files.push(name);
    } catch {
      // not there
    }
  }
  let task = false;
  if (platform === 'win32' && (await run(['/Query', '/TN', OLD_TASK_NAME])).ok) {
    const removed = await run(['/Delete', '/TN', OLD_TASK_NAME, '/F']);
    if (!removed.ok) return { task: false, files, error: `Windows could not remove the old Discord alerts task: ${removed.output}` };
    task = true;
  }
  fs.mkdirSync(userDir, { recursive: true });
  fs.writeFileSync(done, `${new Date().toISOString()}\n`);
  return { task, files };
}

module.exports = { OLD_TASK_NAME, OLD_FILES, DONE_FILE, removeOldDiscordAlerts };
