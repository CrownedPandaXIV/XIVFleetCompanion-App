// Settings → Database → Connections in use: how many of the database's connection slots are taken, by this app, the
// plugins and anything else, and from which PC. Every slot taken stops one more connection: when they run out, the
// plugins can't sync at all (the 1.13.0 outage). PostgreSQL only; the fleet file has no connections.
//
// The app and the plugins name their connections (db/connection-guard.js, the plugin's DatabaseMove.ApplicationName),
// so the database's own list (pg_stat_activity) says whose each one is. Its address is only shown for connections made
// with the same login as this app's (every PC set up by the app shares one); others, such as pgAdmin signed in as
// postgres, are counted as another login. No Electron here, so it can be tested on its own
// (tests/connections-in-use.test.js, tests/db/verify-connections-in-use.js).
const { APP_NAME } = require('./connection-guard');

const PLUGIN_NAME = 'XIV Fleet Companion plugin';
// The share of the slots in use from which the count is shown as a warning.
const WARN_SHARE = 0.8;

// Client connections only (not the database's own workers): for another login's sessions the database hides the
// kind, so those count when they are connected to a database. The one asking (this check) is left out.
const LIST_SQL = `SELECT application_name AS name, host(client_addr) AS addr, usename = current_user AS mine
  FROM pg_stat_activity
  WHERE (backend_type = 'client backend' OR (backend_type IS NULL AND datid IS NOT NULL)) AND pid <> pg_backend_pid()`;

// The slots an ordinary login may use: max_connections less those kept for superusers (and, PostgreSQL 16 and later,
// for roles given pg_use_reserved_connections).
const LIMIT_SQL = `SELECT current_setting('max_connections')::int AS max,
  current_setting('superuser_reserved_connections')::int AS superuser,
  COALESCE(NULLIF(current_setting('reserved_connections', true), ''), '0')::int AS reserved,
  host(inet_client_addr()) AS me`;

const isLoopback = (addr) => addr === '127.0.0.1' || addr === '::1' || /^::ffff:127\./.test(String(addr));

function kindOf(name) {
  if (name === APP_NAME) return 'app';
  if (name === PLUGIN_NAME) return 'plugins';
  return 'other';
}

// Where a connection comes from: { key, label }. A connection through the database PC's own socket has no address.
function placeOf(row, me) {
  if (!row.mine) return { key: 'hidden', label: 'Another login (its PC isn\'t shown)' };
  const local = !row.addr || isLoopback(row.addr);
  const meLocal = !me || isLoopback(me);
  if (local && meLocal) return { key: 'this', label: 'This PC (the database\'s PC)' };
  if (local) return { key: 'database', label: 'The database\'s PC' };
  if (row.addr === me) return { key: 'this', label: 'This PC' };
  return { key: row.addr, label: row.addr };
}

const ORDER = { this: 0, database: 1, hidden: 3 };

// rows: LIST_SQL's; limits: LIMIT_SQL's one row. { inUse, limit, share, warn, app, plugins, other, pcs: [{ key, label,
// app, plugins, other, total }] }, the asking connection counted in (it is one of the slots, if only for a moment).
function summarize(rows, limits) {
  const limit = Math.max(1, Number(limits.max) - Number(limits.superuser || 0) - Number(limits.reserved || 0));
  const totals = { app: 1, plugins: 0, other: 0 };
  const pcs = new Map();
  const add = (place, kind) => {
    if (!pcs.has(place.key)) pcs.set(place.key, { key: place.key, label: place.label, app: 0, plugins: 0, other: 0, total: 0 });
    const pc = pcs.get(place.key);
    pc[kind]++;
    pc.total++;
  };
  add(placeOf({ mine: true, addr: limits.me }, limits.me), 'app');
  for (const row of rows) {
    const kind = kindOf(row.name);
    totals[kind]++;
    add(placeOf(row, limits.me), kind);
  }
  const inUse = totals.app + totals.plugins + totals.other;
  const share = inUse / limit;
  const list = [...pcs.values()].sort((a, b) => (ORDER[a.key] ?? 2) - (ORDER[b.key] ?? 2) || b.total - a.total || a.label.localeCompare(b.label, undefined, { numeric: true }));
  return { inUse, limit, share, warn: share >= WARN_SHARE, ...totals, pcs: list };
}

async function connectionsInUse(client) {
  if (client.dialect === 'sqlite') return null;
  const [list, limits] = await Promise.all([client.query(LIST_SQL), client.query(LIMIT_SQL)]);
  return summarize(list.rows, limits.rows[0]);
}

module.exports = { PLUGIN_NAME, WARN_SHARE, LIST_SQL, LIMIT_SQL, kindOf, placeOf, summarize, connectionsInUse };
