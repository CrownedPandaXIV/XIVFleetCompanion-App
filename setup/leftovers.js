// Settings → Database → Leftovers from moving the database: what a move (setup/move-database.js) leaves in this PC's
// PostgreSQL, and removing it. Two kinds:
//  - the copy that was already here under the same name when the database moved here, kept as
//    <name>_before_move_<date>_<time>;
//  - the copy left behind when the database moved away from here (its note says 'moved').
// The database the app uses is never one of them. When nothing else is left in PostgreSQL and the app installed it,
// PostgreSQL itself can go too. No Electron here, so it can be tested on its own (tests/db/verify-leftovers.js).
const { readMoveNote } = require('../db/database-move');

const KEPT = /_before_move_\d{8}_\d{4}$/;

// admin: a connected client logged in as PostgreSQL's administrator on this PC. connectTo(database) returns a
// connected client to that database (as the administrator). current: the database the app uses, when it's on this
// PC. Returns { leftovers: [{ name, kind: 'kept' | 'moved-away', bytes, movedTo }], others: [names] }.
async function findLeftovers(admin, { connectTo, current }) {
  const { rows } = await admin.query(
    `SELECT datname AS name, pg_database_size(datname)::bigint AS bytes FROM pg_database
      WHERE NOT datistemplate AND datname <> 'postgres' ORDER BY datname`);
  const leftovers = [];
  const others = [];
  for (const { name, bytes } of rows) {
    if (name === current) {
      others.push(name);
      continue;
    }
    if (KEPT.test(name)) {
      leftovers.push({ name, kind: 'kept', bytes: Number(bytes), movedTo: null });
      continue;
    }
    let note = null;
    let c = null;
    try {
      c = await connectTo(name);
      note = await readMoveNote(c);
    } catch {
      note = null;
    } finally {
      if (c) await c.end().catch(() => {});
    }
    if (note && note.state === 'moved') leftovers.push({ name, kind: 'moved-away', bytes: Number(bytes), movedTo: `${note.host}:${note.port}` });
    else others.push(name);
  }
  return { leftovers, others };
}

// Whether PostgreSQL itself can go: only leftovers are in it, the app doesn't use a database in it, and the app
// installed it on this port (so nothing else was using it before). installed: setup/remove-everything.js readInstalled().
function postgresRemovable({ found, installed, port, current }) {
  return !current && found.others.length === 0 && !!installed.postgres && Number(installed.postgres.port) === Number(port);
}

// Removes one leftover, after finding the leftovers again (so only a database that is one right now can go).
// Returns { ok, error? }.
async function removeLeftover(admin, name, { connectTo, current }) {
  const found = await findLeftovers(admin, { connectTo, current });
  if (!found.leftovers.some((l) => l.name === name)) return { ok: false, error: `"${name}" isn't a leftover from a move, so it wasn't removed.` };
  await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [name]);
  const sql = (await admin.query(`SELECT format('DROP DATABASE %I', $1::text) AS s`, [name])).rows[0].s;
  await admin.query(sql);
  return { ok: true };
}

// For "Remove everything" (setup/remove-everything.js) on a PC the app's database moved away from: its old copy
// in this PC's PostgreSQL, found with the app's own login (a move keeps it). connect(port) returns a connected
// client to that database on this PC, as the app's login. Returns { port, movedTo } or null.
async function findMovedAwayCopy(ports, connect) {
  for (const port of ports) {
    let c = null;
    try {
      c = await connect(port);
      const note = await readMoveNote(c);
      if (note && note.state === 'moved') return { port, movedTo: `${note.host}:${note.port}` };
    } catch {
      // Not on this port, or this login isn't in it.
    } finally {
      if (c) await c.end().catch(() => {});
    }
  }
  return null;
}

// Codes for "nothing answered": no PostgreSQL running on this PC (or it has been removed).
const NOT_RUNNING = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EADDRNOTAVAIL']);

const errorCodes = (err) => [err && err.code, ...((err && err.errors) || []).map((e) => e.code)];

// Whether nothing answered at all (also used by setup/remove-everything.js).
function notRunning(err) {
  return errorCodes(err).some((c) => NOT_RUNNING.has(c));
}

// What to say when logging in to PostgreSQL on this PC failed, or null to use the general message
// (setup/help.js describeTestError).
function connectProblem(err) {
  if (errorCodes(err).includes('28P01')) return 'PostgreSQL refused the master password.';
  if (notRunning(err)) {
    return "PostgreSQL isn't running on this PC, or it has been removed, so there's nothing here to tidy up. Check the port if PostgreSQL is installed here.";
  }
  return null;
}

module.exports = { KEPT, findLeftovers, postgresRemovable, removeLeftover, findMovedAwayCopy, connectProblem, notRunning };
