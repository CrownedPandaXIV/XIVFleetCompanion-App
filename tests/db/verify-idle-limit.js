// Against a scratch PostgreSQL (PGHOST etc.): the app's per-call connections, left open on purpose, are closed by the
// database itself once idle past the limit (db/connection-guard.js, 1.13.1), and are named "XIV Fleet Companion app".
// The first connection learns the limit with SET, later ones give it at connect. Uses a 2-second limit.
process.env.FLEET_IDLE_LIMIT_MS = '2000';
const { Client } = require('pg');
const guard = require('../../db/connection-guard');

const settings = () => ({ host: process.env.PGHOST || '127.0.0.1', port: Number(process.env.PGPORT || 5432), user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD, database: process.env.PGDATABASE || 'postgres' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const leaked = [];
  for (let i = 0; i < 3; i++) {
    const c = new Client(guard.clientConfig(settings(), { idleLimit: true }));
    c.on('error', () => {});
    await c.connect();
    await guard.afterConnect(c, { idleLimit: true });
    await c.query('SELECT 1');
    leaked.push(c); // never ended
  }
  const admin = new Client(settings());
  await admin.connect();
  const count = async () => Number((await admin.query(`SELECT count(*) AS n FROM pg_stat_activity WHERE application_name = $1`, [guard.APP_NAME])).rows[0].n);
  const before = await count();
  await sleep(4000);
  const after = await count();
  await admin.end();
  const ok = before === 3 && after === 0;
  console.log(`${ok ? 'PASS' : 'FAIL'} the app's connections left open: ${before} named "${guard.APP_NAME}" at first, ${after} after the idle limit`);
  process.exit(ok ? 0 : 1);
})().catch((err) => { console.log(`FAIL ${err.message}`); process.exit(1); });
