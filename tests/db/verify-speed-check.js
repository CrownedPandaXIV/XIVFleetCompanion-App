// Checks Settings → Database → Speed check's database side (db/speed-check.js) against a real Postgres: a new
// database as the app makes it (no character history table) and one that still has the history table. Set
// PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE for a scratch server, as its administrator: it makes and drops
// databases named speed_check_new and speed_check_old.
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const assert = require('node:assert');
const { measureDatabase, speedFindings } = require('../../db/speed-check');

let n = 0;
async function scenario(name, fn) {
  try { await fn(); console.log(`PASS ${++n}. ${name}`); } catch (e) { console.log(`FAIL ${++n}. ${name}\n   ${e.stack}`); process.exitCode = 1; }
}

const schema = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'schema.sql'), 'utf8');
const admin = new Client();
const config = (database) => ({ host: process.env.PGHOST, port: process.env.PGPORT, user: process.env.PGUSER, password: process.env.PGPASSWORD, database });
const createClient = (c) => new Client(c);

async function freshDatabase(name, extraSql = '') {
  await admin.query(`DROP DATABASE IF EXISTS ${name}`);
  await admin.query(`CREATE DATABASE ${name}`);
  const c = new Client(config(name));
  await c.connect();
  try {
    await c.query(schema);
    if (extraSql) await c.query(extraSql);
  } finally {
    await c.end();
  }
}

(async () => {
  await admin.connect();
  try {
    await scenario("a new database (no history table): it runs, and characters are read the fast way", async () => {
      await freshDatabase('speed_check_new', `INSERT INTO companion_character_current (cid, name, world, last_synced_at)
        VALUES (1, 'Test Character', 'Test World', now())`);
      const m = await measureDatabase(config('speed_check_new'), { createClient });
      assert.strictEqual(m.connectMs.length, 3);
      assert.ok(m.roundTripMs >= 0);
      assert.strictEqual(m.source.useCurrent, true);
      assert.ok(m.source.currentAt instanceof Date);
      assert.strictEqual(m.source.historyAt, null);
      assert.ok(m.sizes.totalBytes > 0 && m.sizes.biggest.length > 0);
      assert.deepStrictEqual(Object.keys(m.busy), ['active', 'backups']);
      const findings = speedFindings({ ...m, tailscale: null }, []);
      assert.ok(findings.some((f) => /current table, the fast way/.test(f.text)), JSON.stringify(findings));
    });

    await scenario('a database that still has the history table, an hour ahead of the current table: the slow way, and why', async () => {
      await freshDatabase('speed_check_old', `
        INSERT INTO companion_character_current (cid, name, world, last_synced_at) VALUES (1, 'Test Character', 'Test World', now() - interval '1 hour');
        CREATE TABLE companion_character_snapshot (cid bigint, snapshot_at timestamptz);
        INSERT INTO companion_character_snapshot VALUES (1, now());`);
      const m = await measureDatabase(config('speed_check_old'), { createClient });
      assert.strictEqual(m.source.useCurrent, false);
      assert.ok(m.source.historyAt instanceof Date);
      const findings = speedFindings({ ...m, tailscale: null }, []);
      assert.ok(findings.some((f) => /slow way, from the whole history, because the plugin's current table is 60 minutes behind/.test(f.text)), JSON.stringify(findings));
    });
  } finally {
    await admin.query('DROP DATABASE IF EXISTS speed_check_new');
    await admin.query('DROP DATABASE IF EXISTS speed_check_old');
    await admin.end();
  }
})();
