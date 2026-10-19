// The Windows scheduled task that runs the alert check every 5 minutes on this PC: it starts the app
// itself with --fleet-alerts (Electron opens no window and no console, so nothing flashes on screen).
// Made with schtasks.exe for the signed-in Windows user, so no administrator rights are needed; like
// the nightly backup, it runs while that user is signed in.
const { execFile } = require('child_process');

const TASK_NAME = 'Fleet Companion alerts';
const EVERY_MINUTES = 5;

// schtasks' own limit for the command it runs.
const MAX_COMMAND = 261;

// appDir: the app's folder when run from source (electron.exe <folder>); null for the installed app, whose
// own .exe is started.
function taskCommand(electronPath, appDir) {
  return appDir ? `"${electronPath}" "${appDir}" --fleet-alerts` : `"${electronPath}" --fleet-alerts`;
}

function createArgs(electronPath, appDir) {
  return ['/Create', '/TN', TASK_NAME, '/SC', 'MINUTE', '/MO', String(EVERY_MINUTES), '/TR', taskCommand(electronPath, appDir), '/F'];
}

function run(args) {
  return new Promise((resolve) => {
    execFile('schtasks.exe', args, { windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, output: String(stderr || stdout || (err && err.message) || '').trim() });
    });
  });
}

const supported = () => process.platform === 'win32';

// The command a task runs, from `schtasks /Query /V /FO LIST` ("Task To Run: ..."); null when it is not
// there (Windows in another language words the line differently).
function taskToRun(output) {
  const line = String(output || '').split(/\r?\n/).find((l) => /^\s*Task To Run:/i.test(l));
  return line ? line.replace(/^\s*Task To Run:\s*/i, '').trim() : null;
}

// expectedCommand: what this copy of the app would schedule (taskCommand). `current` is false when the
// task starts another copy (the app was moved, or installed after running from source), null when unknown.
async function scheduleStatus(expectedCommand) {
  if (!supported()) return { supported: false, installed: false };
  const result = await run(['/Query', '/TN', TASK_NAME, '/V', '/FO', 'LIST']);
  if (!result.ok) return { supported: true, installed: false };
  const command = taskToRun(result.output);
  return { supported: true, installed: true, current: command && expectedCommand ? command === expectedCommand : null };
}

async function installSchedule(electronPath, appDir) {
  if (!supported()) return { ok: false, error: 'Alerts can only be scheduled on Windows.' };
  const command = taskCommand(electronPath, appDir);
  if (command.length > MAX_COMMAND) {
    return { ok: false, error: `The app's folder path is too long for a Windows scheduled task (${command.length} of ${MAX_COMMAND} characters). Move the app to a shorter folder, such as C:\\Fleet.` };
  }
  const result = await run(createArgs(electronPath, appDir));
  return result.ok ? { ok: true } : { ok: false, error: `Windows could not create the scheduled task: ${result.output}` };
}

async function removeSchedule() {
  if (!supported()) return { ok: true };
  const result = await run(['/Delete', '/TN', TASK_NAME, '/F']);
  return result.ok ? { ok: true } : { ok: false, error: `Windows could not remove the scheduled task: ${result.output}` };
}

module.exports = { TASK_NAME, EVERY_MINUTES, taskCommand, taskToRun, createArgs, scheduleStatus, installSchedule, removeSchedule };
