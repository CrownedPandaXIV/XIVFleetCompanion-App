// Moving the database to another PC (Settings → Database → Move the database to this PC, setup/move-database.js)
// leaves a note in the database (companion_database_move, database update 10): 'pausing' while it copies
// everything, then 'moved' in the old database with the new PC's address, and 'arrived' in the new one. Every
// app and plugin that finds 'moved' switches to the new address by itself, keeping the same database name,
// login and password. No Electron here, so it can be tested on its own (tests/database-move.test.js).

// The name the plugin (0.14.0 and newer) gives its connections, so a move can wait for a sync to finish.
const PLUGIN_APPLICATION_NAME = 'XIV Fleet Companion plugin';

// The note, or null when there is none (or the database doesn't have update 10 yet). fresh: the app moving it
// said it was still working in the last 5 minutes, by the database's clock.
async function readMoveNote(client) {
  try {
    const { rows } = await client.query(
      `SELECT state, host, port, from_host, moved_at, updated_at > now() - interval '5 minutes' AS fresh
         FROM companion_database_move WHERE id = 1`);
    return rows[0] || null;
  } catch (err) {
    if (err.code === '42P01') return null;
    throw err;
  }
}

// The saved connection with the new address, when this database has moved; otherwise null.
function movedConnection(note, config) {
  if (!note || note.state !== 'moved' || !String(note.host || '').trim() || !(Number(note.port) > 0)) return null;
  return { ...config, host: String(note.host).trim(), port: Number(note.port) };
}

// Whether this database has moved, and whether this PC can reach where it went. tryConnect(config) resolves
// when the new address answers. Returns null (not moved), { to, config } (switch to config) or
// { to, error } (moved, but this PC can't reach it yet).
async function followMove(client, config, { tryConnect }) {
  const next = movedConnection(await readMoveNote(client), config);
  if (!next) return null;
  const to = `${next.host}:${next.port}`;
  try {
    await tryConnect(next);
  } catch (err) {
    return { to, error: err.message };
  }
  return { to, config: next };
}

module.exports = { PLUGIN_APPLICATION_NAME, readMoveNote, movedConnection, followMove };
