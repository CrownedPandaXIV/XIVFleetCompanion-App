// Checks Settings → Database → Leftovers from moving the database (setup/leftovers.js) against a real PostgreSQL:
// only the copies a move leaves behind are found and can be removed, never the database the app uses or any other.
// Set PGHOST, PGPORT, PGUSER, PGPASSWORD for a scratch server, as its administrator: it makes and drops databases
// named lo_*.
const { Client } = require('pg');
const assert = require('node:assert');
const { findLeftovers, removeLeftover, findMovedAwayCopy } = require('../../setup/leftovers');

let n = 0;
async function scenario(name, fn) {
  try { await fn(); console.log(`PASS ${++n}. ${name}`); } catch (e) { console.log(`FAIL ${++n}. ${name}\n   ${e.stack}`); process.exitCode = 1; }
}

const DATABASES = ['lo_live', 'lo_live_before_move_20261018_2302', 'lo_away', 'lo_arrived', 'lo_other'];
const connectTo = async (database) => {
  const c = new Client({ database });
  await c.connect();
  return c;
};
// The move table as database update 10 makes it.
const MOVE_TABLE = require('fs').readFileSync(require('path').join(__dirname, '../../db/updates/010_database_move.sql'), 'utf8')
  .split('-- The login each PC')[0];
const note = (state) => `${MOVE_TABLE};
  INSERT INTO companion_database_move (state, host, port) VALUES ('${state}', '100.64.0.9', 5432)`;

(async () => {
  const admin = new Client({ database: 'postgres' });
  await admin.connect();
  const dropAll = async () => {
    for (const d of DATABASES) {
      await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [d]);
      await admin.query(`DROP DATABASE IF EXISTS ${d}`);
    }
  };
  await dropAll();
  for (const d of DATABASES) await admin.query(`CREATE DATABASE ${d}`);
  for (const [d, state] of [['lo_live', 'arrived'], ['lo_live_before_move_20261018_2302', 'moved'], ['lo_away', 'moved'], ['lo_arrived', 'arrived']]) {
    const c = await connectTo(d);
    await c.query(note(state));
    await c.end();
  }

  await scenario('the copies a move left behind are found; the database in use and any other are not', async () => {
    const found = await findLeftovers(admin, { connectTo, current: 'lo_live' });
    const ours = found.leftovers.filter((l) => l.name.startsWith('lo_'));
    assert.deepStrictEqual(ours.map((l) => [l.name, l.kind, l.movedTo]), [
      ['lo_away', 'moved-away', '100.64.0.9:5432'],
      ['lo_live_before_move_20261018_2302', 'kept', null],
    ]);
    assert.ok(ours.every((l) => l.bytes > 0), 'with their size');
    for (const d of ['lo_live', 'lo_arrived', 'lo_other']) assert.ok(found.others.includes(d), `${d} is not a leftover`);
  });

  await scenario('a database the app uses is never a leftover, even one whose note says it moved', async () => {
    const found = await findLeftovers(admin, { connectTo, current: 'lo_away' });
    assert.ok(!found.leftovers.some((l) => l.name === 'lo_away'));
    const r = await removeLeftover(admin, 'lo_away', { connectTo, current: 'lo_away' });
    assert.deepStrictEqual(r, { ok: false, error: '"lo_away" isn\'t a leftover from a move, so it wasn\'t removed.' });
  });

  await scenario('only a leftover can be removed', async () => {
    for (const d of ['lo_live', 'lo_other', 'lo_arrived', 'postgres', 'no_such_database']) {
      const r = await removeLeftover(admin, d, { connectTo, current: 'lo_live' });
      assert.strictEqual(r.ok, false, d);
    }
    const left = (await admin.query(`SELECT datname FROM pg_database WHERE datname LIKE 'lo_%' ORDER BY 1`)).rows.map((r) => r.datname);
    assert.deepStrictEqual(left, ['lo_arrived', 'lo_away', 'lo_live', 'lo_live_before_move_20261018_2302', 'lo_other']);
  });

  await scenario('"Remove everything" finds the copy a move left on this PC, on whichever port it is, and nothing else', async () => {
    const port = Number(process.env.PGPORT || 5432);
    const on = (database) => async (p) => {
      const c = new Client({ database, port: p, connectionTimeoutMillis: 3000 });
      await c.connect();
      return c;
    };
    assert.deepStrictEqual(await findMovedAwayCopy([1, port], on('lo_away')), { port, movedTo: '100.64.0.9:5432' });
    for (const d of ['lo_live', 'lo_other', 'no_such_database']) assert.strictEqual(await findMovedAwayCopy([port], on(d)), null, d);
  });

  await scenario('removing leftovers deletes just them, even with someone connected to one', async () => {
    const open = await connectTo('lo_live_before_move_20261018_2302');
    open.on('error', () => {});
    assert.deepStrictEqual(await removeLeftover(admin, 'lo_live_before_move_20261018_2302', { connectTo, current: 'lo_live' }), { ok: true });
    assert.deepStrictEqual(await removeLeftover(admin, 'lo_away', { connectTo, current: 'lo_live' }), { ok: true });
    await open.end().catch(() => {});
    const left = (await admin.query(`SELECT datname FROM pg_database WHERE datname LIKE 'lo_%' ORDER BY 1`)).rows.map((r) => r.datname);
    assert.deepStrictEqual(left, ['lo_arrived', 'lo_live', 'lo_other']);
    const found = await findLeftovers(admin, { connectTo, current: 'lo_live' });
    assert.ok(!found.leftovers.some((l) => l.name.startsWith('lo_')), 'nothing left over');
  });

  await dropAll();
  await admin.end();
})().catch((e) => { console.error(e); process.exitCode = 1; });
