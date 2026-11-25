// Keeps the app's own PostgreSQL connections from piling up (1.13.1). Each call the window makes opens one connection
// and closes it when done (db/index.js withClient); if one is ever left open, it holds one of the database's slots
// (100 by default) until the app closes, and enough of them stop the plugins from connecting at all. So:
//   - every connection is named "XIV Fleet Companion app", so the database's list of connections says whose it is;
//   - the database itself closes one of the app's per-call connections that has sat idle for IDLE_LIMIT_MS
//     (PostgreSQL 14 and later: idle_session_timeout), whatever the app does or forgets;
//   - one still open after WARN_AFTER_MS is written to the app's log with the call that opened it and its last
//     question, so the cause can be found.
// No Electron here, so it can be tested on its own (tests/connection-guard.test.js).

const APP_NAME = 'XIV Fleet Companion app';
const IDLE_LIMIT_MS = Number(process.env.FLEET_IDLE_LIMIT_MS) || 10 * 60 * 1000;
const WARN_AFTER_MS = Number(process.env.FLEET_CONNECTION_WARN_MS) || 2 * 60 * 1000;

// Whether the database knows idle_session_timeout: null until the first connection finds out (then given at
// connect, with no extra question); false on PostgreSQL 13 and older, which would refuse it at connect.
let idleLimitKnown = null;

// The connection settings: the app's name, and the idle limit once it is known to work.
function clientConfig(config, { idleLimit = false } = {}) {
  const out = { application_name: APP_NAME, ...config };
  if (idleLimit && idleLimitKnown === true) out.options = `-c idle_session_timeout=${IDLE_LIMIT_MS}`;
  return out;
}

// After connecting: on the first connection with the idle limit asked for, set it and learn whether the database
// has it (later connections give it at connect). Never fails the connection.
async function afterConnect(client, { idleLimit = false } = {}) {
  if (!idleLimit || idleLimitKnown !== null) return;
  try {
    await client.query(`SET idle_session_timeout = ${IDLE_LIMIT_MS}`);
    idleLimitKnown = true;
  } catch {
    idleLimitKnown = false;
  }
}

// The app's own files on the call's way here (the ipc/ handler first), for the log.
function callerOf(stack) {
  const lines = String(stack || '').split('\n').slice(1)
    .map((l) => (l.match(/[\\/]((?:ipc|db|subs|characters|backups)[\\/][\w.-]+\.js):(\d+)/) || [])).filter((m) => m[1])
    .map((m) => `${m[1].replace(/\\/g, '/')}:${m[2]}`)
    .filter((l) => !l.startsWith('db/index.js') && !l.startsWith('db/connection-guard.js'));
  return [...new Set(lines)].slice(0, 4).join(' < ') || 'unknown';
}

// Watches one connection: remembers its last question, and logs it when it is still open after WARN_AFTER_MS (and
// how long it was open, if it closes after that). Closing it (client.end) stops the watch; so does done().
function watch(client, { stack = new Error().stack, log = console, setTimer = setTimeout, clearTimer = clearTimeout, now = Date.now } = {}) {
  const opened = now();
  const where = callerOf(stack);
  let last = '';
  const query = client.query.bind(client);
  client.query = (...args) => {
    const text = typeof args[0] === 'string' ? args[0] : args[0] && args[0].text;
    if (text) last = String(text).replace(/\s+/g, ' ').trim().slice(0, 120);
    return query(...args);
  };
  let warned = false;
  const timer = setTimer(() => {
    warned = true;
    log.warn(`A database connection is still open after ${Math.round(WARN_AFTER_MS / 1000)} seconds. Opened by: ${where}. Last question: ${last || '(none)'}`);
  }, WARN_AFTER_MS);
  if (timer && typeof timer.unref === 'function') timer.unref();
  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    clearTimer(timer);
    if (warned) log.warn(`That database connection (${where}) closed after ${Math.round((now() - opened) / 1000)} seconds.`);
  };
  const end = client.end.bind(client);
  client.end = (...args) => { done(); return end(...args); };
  return done;
}

const resetForTests = () => { idleLimitKnown = null; };

module.exports = { APP_NAME, IDLE_LIMIT_MS, WARN_AFTER_MS, clientConfig, afterConnect, callerOf, watch, resetForTests };
