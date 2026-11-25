// Against a scratch PostgreSQL (PGHOST etc.): Settings → Database → Connections in use (db/connections-in-use.js) counts
// the app's, the plugins' and other connections by their names, leaves out the database's own workers, and reads the
// slots an ordinary login may use. Opens 2 "plugin" connections and 1 other, then closes them.
const { Client } = require('pg');
const { connectionsInUse, PLUGIN_NAME } = require('../../db/connections-in-use');
const { APP_NAME } = require('../../db/connection-guard');

const settings = (name) => ({ host: process.env.PGHOST || '127.0.0.1', port: Number(process.env.PGPORT || 5432), user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD, database: process.env.PGDATABASE || 'postgres', application_name: name });

(async () => {
  const open = [];
  for (const name of [PLUGIN_NAME, PLUGIN_NAME, 'pgAdmin 4']) {
    const c = new Client(settings(name));
    await c.connect();
    open.push(c);
  }
  const me = new Client(settings(APP_NAME));
  await me.connect();
  const max = Number((await me.query('SHOW max_connections')).rows[0].max_connections);
  const su = Number((await me.query('SHOW superuser_reserved_connections')).rows[0].superuser_reserved_connections);
  const c = await connectionsInUse(me);
  await Promise.all([...open, me].map((x) => x.end()));
  const checks = [
    ['2 plugin connections', c.plugins === 2],
    ['the asking app connection counted once', c.app === 1],
    ['at least the other one (nothing of the database\'s own)', c.other >= 1 && c.inUse === c.app + c.plugins + c.other],
    [`the limit is ${max} less ${su} kept for superusers (and reserved_connections)`, c.limit <= max - su && c.limit > 0],
    ['every connection is on a PC row', c.pcs.reduce((n, p) => n + p.total, 0) === c.inUse],
  ];
  for (const [what, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`);
  console.log(JSON.stringify(c));
  process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
})().catch((err) => { console.log(`FAIL ${err.message}`); process.exit(1); });
