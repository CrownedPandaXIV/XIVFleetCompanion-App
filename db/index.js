// Postgres connection: the saved (encrypted) connection details, one connected client per
// call, and where to read each character's current name/world/account from.
const { app, safeStorage, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { Client } = require('pg');
const { isConnectionError, describeError, createConnectionTracker } = require('./connection-status');
const { ensureDatabase } = require('./apply-updates');
const { followMove } = require('./database-move');
const gameData = require('./game-data');

// Give up on connecting after this long instead of the operating system's ~20 seconds, so a
// refresh while the database cannot be reached fails quickly. keepAlive notices a connection that
// silently died (for example a VPN dropping) instead of waiting on it forever.
const CONNECT_TIMEOUT_MS = 8000;

// Every Postgres client in this file goes through here instead of `new
// Client(config)` directly. pg's Client is an EventEmitter - if the
// connection drops AFTER connecting (network blip, VPN drop, Postgres
// restart), it emits an 'error' event on the client itself, which is
// separate from a query promise rejecting. try/catch around
// connect()/query() does NOT catch this. With no listener, Node's
// default behavior for an unhandled 'error' event is to crash the whole
// process - confirmed as the real cause of the "Uncaught Exception:
// read ECONNRESET" crash dialog. Attaching a no-op listener here just
// logs it instead, letting the existing try/catch/finally in each
// handler continue to handle the error gracefully as before.
function createPgClient(config) {
  const client = new Client({ connectionTimeoutMillis: CONNECT_TIMEOUT_MS, keepAlive: true, ...config });
  client.on('error', (err) => {
    console.error('Postgres client connection error (non-fatal):', err.message);
  });
  return client;
}

// Where the ENCRYPTED Postgres connection details live: Electron's own per-app data folder (not the
// program folder), so they're never zipped up, committed or copied between machines by accident.
const CREDENTIAL_FILE = path.join(app.getPath('userData'), 'pg-credentials.enc');

// Reads the encrypted credential file and decrypts it back into a plain
// { host, port, database, user, password } object. safeStorage uses the
// OS's own credential encryption (Windows DPAPI under the hood) - the
// SAME underlying mechanism Windows Credential Manager uses, so this is
// genuinely as secure as what the companion plugin already does, just
// through Electron's own API instead of the Meziantou package it uses.
function loadPostgresConfig() {
  if (!fs.existsSync(CREDENTIAL_FILE)) {
    throw new Error(
      'No Postgres connection configured yet. Open Settings and fill in your connection details.'
    );
  }

  const encrypted = fs.readFileSync(CREDENTIAL_FILE);
  const decrypted = safeStorage.decryptString(encrypted);
  return JSON.parse(decrypted);
}

// Whether the database can be reached (see connection-status.js). Every open window is told when
// that changes; while it cannot be reached, a quiet check runs every 30 seconds.
const connection = createConnectionTracker({
  reconnectMs: Number(process.env.FLEET_RECONNECT_MS) || 30000,
  notify: (status) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('connection-status', status);
    }
  },
  probe: async () => {
    let config = null;
    let client = null;
    try {
      config = loadPostgresConfig();
      client = createPgClient(config);
      await client.connect();
      await client.query('SELECT 1');
    } catch (err) {
      err.friendlyMessage = describeError(err, config);
      throw err;
    } finally {
      if (client) await client.end().catch(() => {});
    }
  },
});

// Database updates (db/apply-updates.js): checked on the first connection of each run, and again after the
// connection details change. A database with no game data yet (a new one) then has it filled in
// (db/game-data.js), which takes a minute or two. Everything else waits for both, so nothing reads a table
// mid-update and no screen shows an error for missing game data. If it
// fails for any reason but the database being unreachable, the app carries on as it is, the window
// says why, and it is tried again RETRY_DATABASE_CHECK_MS later.
const RETRY_DATABASE_CHECK_MS = 5 * 60 * 1000;
let databaseCheck = null;
let databaseState = null;

function setDatabaseState(state) {
  databaseState = { ...state, move: moveState };
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('database-status', databaseState);
  }
}

function checkDatabase(client, config) {
  if (!databaseCheck) {
    databaseCheck = ensureDatabase(client, { appVersion: app.getVersion(), user: config.user })
      .then((result) => {
        if (result.applied.length > 0) console.log('Database updated:', result.applied.join('; '));
        setDatabaseState({ ok: true, ...result });
        return fillGameDataIfEmpty(client, result);
      })
      .catch((err) => {
        if (isConnectionError(err)) {
          databaseCheck = null;
          throw err;
        }
        console.error('Could not update the database:', err.message);
        setDatabaseState({ ok: false, message: err.message });
        setTimeout(() => { databaseCheck = null; }, RETRY_DATABASE_CHECK_MS);
      });
  }
  return databaseCheck;
}

// The game data for a database that has none. Never fails the check: without it the app still works, and
// the window says what to do. The UI tests skip it (XIV_FLEET_SKIP_GAME_DATA_FILL), having no internet.
async function fillGameDataIfEmpty(client, result) {
  if (process.env.XIV_FLEET_SKIP_GAME_DATA_FILL) return;
  try {
    if (!(await gameData.needsFilling(client))) return;
    setDatabaseState({ ok: true, ...result, gameData: 'filling' });
    const filled = await gameData.fillGameData(client);
    if (filled.failed.length) console.error('Game data: some tables could not be filled:', filled.failed.map((f) => `${f.table}: ${f.reason}`).join('; '));
    setDatabaseState({ ok: true, ...result, gameData: filled.failed.length ? 'partial' : 'filled' });
  } catch (err) {
    console.error('Could not fill in the game data:', err.message);
    setDatabaseState({ ok: true, ...result, gameData: 'failed', gameDataProblem: err.message });
  }
}

// Runs `work(client)` against a fresh, connected Postgres client and always
// closes it. `onError(err, client)` supplies the handler's error result. Config is
// loaded outside the try on purpose: a missing connection config still
// rejects the IPC call, exactly as it did before this helper existed.
// The outcome is reported to the connection tracker, and a handler's plain `{ error: err.message }`
// result is given the plain-language message instead (plus `offline: true` when the database could
// not be reached, which lets the window keep showing what it last loaded).
async function withClient(work, onError, hops = 0) {
  const config = loadPostgresConfig();
  const client = createPgClient(config);
  try {
    await client.connect();
    await checkDatabase(client, config);
    // The database moved to another PC and this one has switched to it: start again there.
    if (hops < 3 && await followIfMoved(client, config)) {
      await client.end().catch(() => {});
      return withClient(work, onError, hops + 1);
    }
    const result = await work(client);
    connection.markOnline();
    return result;
  } catch (err) {
    const offline = isConnectionError(err);
    const message = describeError(err, config);
    if (offline) connection.markOffline(message);
    const result = await onError(err, client);
    if (result && typeof result === 'object') {
      if (result.error === err.message) result.error = message;
      if (offline) result.offline = true;
    }
    return result;
  } finally {
    await client.end().catch(() => {});
  }
}

// Moving the database to another PC (db/database-move.js): at most once a minute, whether the database this
// PC uses has moved. If it has and the new address answers, the saved connection switches to it (same database,
// login and password) and the window is told; if it doesn't answer yet, the window says so and it's tried
// again. Also run before a backup and an alert check (followMoveNow), so a PC left running follows too.
const MOVE_CHECK_MS = Number(process.env.FLEET_MOVE_CHECK_MS) || 60 * 1000;
let moveCheckedAt = 0;
let moveState = null;

function setMoveState(state) {
  moveState = state;
  if (databaseState) setDatabaseState(databaseState);
  else for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('database-status', { ok: true, move: moveState });
}

async function tryConnect(config) {
  const client = createPgClient({ ...config, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    await client.query('SELECT 1');
  } catch (err) {
    throw new Error(describeError(err, config));
  } finally {
    await client.end().catch(() => {});
  }
}

// True when it switched to the new address.
async function followIfMoved(client, config, { force = false } = {}) {
  if (!force && Date.now() - moveCheckedAt < MOVE_CHECK_MS) return false;
  moveCheckedAt = Date.now();
  let r;
  try {
    r = await followMove(client, config, { tryConnect });
  } catch (err) {
    console.error('Could not check whether the database moved:', err.message);
    return false;
  }
  if (!r) {
    if (moveState && moveState.error) setMoveState(null);
    return false;
  }
  if (r.error) {
    if (!moveState || moveState.error !== r.error || moveState.to !== r.to) setMoveState({ to: r.to, error: r.error });
    return false;
  }
  savePostgresConfig(r.config);
  moveCheckedAt = 0;
  console.log(`The database moved from ${config.host}:${config.port || 5432} to ${r.to}; this PC switched to it.`);
  setMoveState({ to: r.to, followed: true, from: `${config.host}:${config.port || 5432}` });
  return true;
}

// The same check right now, on a connection of its own (a backup or an alert check about to start).
async function followMoveNow() {
  let config;
  try { config = loadPostgresConfig(); } catch { return false; }
  const client = createPgClient(config);
  try {
    await client.connect();
    return await followIfMoved(client, config, { force: true });
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

// The Roster, Subs, Parts, Inventory, Retainers and Free Companies views all
// need a character's CURRENT name/world/account. snapshotFragments() returns two
// constant SQL fragments that yield the latest row per character, and per (Free
// Company, character) pair, so each query can join to them.
//
// Three forms exist (see snapshot-fragments.js):
//  - The current-state table (plugin 0.3.0 and database version 4): one row per character,
//    nothing to search. Used whenever the plugin keeps it up to date.
//  - Otherwise the append-only companion_character_snapshot history. With the
//    recommended index, each character's latest row is fetched directly through it
//    (a "skip scan"); without it, DISTINCT ON reads and sorts the whole table. The
//    skip-scan form must NOT be used without its index, where it is far slower.
// Nothing user-supplied is ever interpolated into these strings.
//
// Which form to use is checked at most once a minute, so running the SQL script or
// adding indexes takes effect without restarting the app. If the check fails for
// any reason, the safe (no-index history) form is used.
const { buildSnapshotFragments, chooseSnapshotSource } = require('./snapshot-fragments');
const SNAPSHOT_SOURCE_RECHECK_MS = 60 * 1000;
let snapshotSourceState = { checkedAt: 0, useCurrent: false, hasCidIndex: false, hasFcIndex: false };

async function snapshotFragments(client) {
  const now = Date.now();
  if (now - snapshotSourceState.checkedAt > SNAPSHOT_SOURCE_RECHECK_MS) {
    let state = { useCurrent: false, hasCidIndex: false, hasFcIndex: false };
    try {
      state = await chooseSnapshotSource(client);
    } catch (err) {
      console.error('Could not check where to read characters from (using the no-index form):', err.message);
    }
    snapshotSourceState = { checkedAt: now, ...state };
  }
  return buildSnapshotFragments(snapshotSourceState);
}

// Encrypts and saves a new connection config, overwriting whatever was there before.
function savePostgresConfig(config) {
  const json = JSON.stringify(config);
  const encrypted = safeStorage.encryptString(json);
  fs.writeFileSync(CREDENTIAL_FILE, encrypted);
  // A different database (or login) may need updating.
  databaseCheck = null;
}

module.exports = {
  createPgClient, loadPostgresConfig, savePostgresConfig, withClient, snapshotFragments, followMoveNow,
  connectionStatus: () => connection.status(),
  databaseStatus: () => databaseState || (moveState ? { ok: true, move: moveState } : null),
  // After restoring a backup: check for database updates again on the next connection.
  recheckDatabase: () => { databaseCheck = null; },
};
