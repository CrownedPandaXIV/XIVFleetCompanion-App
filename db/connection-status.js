// Whether the database can be reached, and plain-language error messages. db/index.js reports every call's
// outcome here. When a call fails because the database cannot be reached (no internet, VPN down,
// Postgres stopped), the app is marked offline: the window is told, keeps showing what it last loaded,
// and a quiet check runs every RECONNECT_MS until the database answers again. No Electron or pg here,
// so it can be tested on its own (tests/connection-status.test.js).

// Error codes Node and pg use when the server cannot be reached or the connection broke.
const CONNECTION_CODES = new Set([
  'ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'ENETDOWN', 'EHOSTDOWN',
  'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', 'ECONNABORTED', 'ESOCKETTIMEDOUT',
]);
// pg's own messages for a connect timeout or a connection that dropped mid-query (no code).
const CONNECTION_MESSAGES = /connection timeout|timeout expired|Connection terminated|Client has encountered a connection error/i;

function isConnectionError(err) {
  if (!err) return false;
  if (CONNECTION_CODES.has(err.code)) return true;
  // Node can report one failed attempt per address together (AggregateError).
  if (Array.isArray(err.errors) && err.errors.some(isConnectionError)) return true;
  return CONNECTION_MESSAGES.test(err.message || '');
}

// The message the window shows for a failed database call.
function describeError(err, config) {
  const where = config && config.host ? `${config.host}:${config.port || 5432}` : 'the database server';
  if (isConnectionError(err)) {
    return `Can't reach the database at ${where}. Check this PC is online and any VPN (such as Tailscale) is connected.`;
  }
  if (err && (err.code === '28P01' || err.code === '28000')) {
    return 'The database refused the username or password. Check them in Settings.';
  }
  if (err && err.code === '3D000') {
    return `The database "${(config && config.database) || ''}" does not exist on ${where}. Check the name in Settings.`;
  }
  return (err && err.message) || String(err);
}

// The connection state. `notify(status)` is called whenever online/offline changes; `probe()` is
// an async check that resolves when the database answers (it runs every reconnectMs while offline).
function createConnectionTracker({ notify, probe, reconnectMs = 30000, now = () => Date.now(), setTimer = setInterval, clearTimer = clearInterval }) {
  let state = { online: true, offlineSince: null, lastOkAt: null, message: null, retryEveryMs: reconnectMs };
  let timer = null;
  let probing = false;

  const snapshot = () => ({ ...state });

  function stopRetrying() {
    if (timer) clearTimer(timer);
    timer = null;
  }

  function markOnline() {
    const wasOffline = !state.online;
    state = { ...state, online: true, offlineSince: null, message: null, lastOkAt: now() };
    if (wasOffline) {
      stopRetrying();
      notify(snapshot());
    }
  }

  async function retry() {
    if (probing || state.online) return;
    probing = true;
    try {
      await probe();
      markOnline();
    } catch (err) {
      // probe() may attach the friendly text (it knows the host); otherwise describe it here.
      if (!state.online) state = { ...state, message: (err && err.friendlyMessage) || describeError(err) };
    } finally {
      probing = false;
    }
  }

  function markOffline(message) {
    if (state.online) {
      state = { ...state, online: false, offlineSince: now(), message };
      notify(snapshot());
      if (!timer) timer = setTimer(retry, reconnectMs);
    } else if (message !== state.message) {
      state = { ...state, message };
    }
  }

  return { markOnline, markOffline, status: snapshot, retryNow: retry, stop: stopRetrying };
}

module.exports = { isConnectionError, describeError, createConnectionTracker };
