// The installed app's update check as the window shows it (Settings → General → Updates) and the log records it:
// what electron-updater last said, turned into one status. No Electron here, so it can be tested on its own
// (tests/update-status.test.js); updater.js feeds it the events.
//
// status: { state, version?, percent?, message?, checkedAt? } with state one of
//   'idle'        not looked yet (or a copy run from source, which never looks: source: true)
//   'checking'    looking now
//   'downloading' found `version`, `percent` downloaded
//   'ready'       `version` downloaded, installed on restart (stays until then)
//   'up-to-date'  nothing newer, at `checkedAt`
//   'error'       the last look failed, `message` says why in plain words

// Errors that only mean the internet (or GitHub) couldn't be reached.
const OFFLINE = /ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ERR_NETWORK|ERR_TIMED_OUT|ENOTFOUND|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|socket hang up/i;

function plainError(err) {
  const text = String((err && err.message) || err || '');
  if (OFFLINE.test(text)) return "Couldn't reach GitHub to look for updates. Check this PC is online; it tries again later.";
  const first = text.split(/\r?\n/)[0].trim();
  return `Looking for updates failed: ${first.length > 200 ? `${first.slice(0, 200)}...` : first || 'no reason given'}`;
}

// The status after one of electron-updater's events ('checking-for-update', 'update-available',
// 'update-not-available', 'download-progress', 'update-downloaded', 'error'). A downloaded version stays ready
// until the app restarts, whatever later checks say.
function nextStatus(status, event, data = {}, now = Date.now()) {
  if (status.state === 'ready' && event !== 'update-downloaded') return status;
  switch (event) {
    case 'checking-for-update':
      return { state: 'checking' };
    case 'update-available':
      return { state: 'downloading', version: data.version, percent: 0 };
    case 'download-progress':
      return { state: 'downloading', version: status.version, percent: Math.floor(Number(data.percent) || 0) };
    case 'update-downloaded':
      return { state: 'ready', version: data.version };
    case 'update-not-available':
      return { state: 'up-to-date', checkedAt: now };
    case 'error':
      return { state: 'error', message: plainError(data), checkedAt: now };
    default:
      return status;
  }
}

const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

// One line for the window.
function statusText(status, { now = Date.now() } = {}) {
  switch (status.state) {
    case 'checking': return 'Looking for a new version...';
    case 'downloading': return `Downloading version ${status.version} (${status.percent || 0}%)...`;
    case 'ready': return `Version ${status.version} is downloaded. It's installed when you click Restart to update, or the next time you close the app.`;
    case 'up-to-date': return `Up to date. Last looked ${now - status.checkedAt < 60 * 1000 ? 'just now' : `at ${clock(status.checkedAt)}`}.`;
    case 'error': return status.message;
    default: return status.source ? 'This copy runs from source, so it doesn\'t update itself (use git pull).' : 'Not looked yet.';
  }
}

// What goes in the app's log when the status settles somewhere new (null: nothing worth a line). `before` is the
// last settled status, not 'checking', so an hourly check that finds nothing new adds nothing.
function logLine(before, after) {
  if (after.state === 'checking') return null;
  if (after.state === before.state && after.version === before.version && after.message === before.message) return null;
  switch (after.state) {
    case 'downloading': return before.state === 'downloading' ? null : `Update: found version ${after.version}, downloading it.`;
    case 'ready': return `Update: version ${after.version} is downloaded and ready to install.`;
    case 'up-to-date': return 'Update: up to date.';
    case 'error': return `Update: ${after.message}`;
    default: return null;
  }
}

module.exports = { nextStatus, statusText, logLine, plainError };
