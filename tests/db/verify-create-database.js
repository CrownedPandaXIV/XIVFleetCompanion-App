// Checks "New database on this PC" (setup/create-database.js), and removing it again (Remove everything,
// setup/remove-everything.js), against a real Postgres. Set PGHOST, PGPORT,
// PGUSER, PGPASSWORD, PGDATABASE for a scratch server, as its administrator: it makes and drops a database
// named newdb_check and logins named newdb_app and newdb_plain.
const { Client } = require('pg');
const assert = require('node:assert');
const { createDatabase } = require('../../setup/create-database');
const { dropDatabase } = require('../../setup/remove-everything');
const { ensureDatabase } = require('../../db/apply-updates');

let n = 0;
async function scenario(name, fn) {
  try { await fn(); console.log(`PASS ${++n}. ${name}`); } catch (e) { console.log(`FAIL ${++n}. ${name}\n   ${e.stack}`); process.exitCode = 1; }
}

const admin = new Client();
const PASSWORD = "it's a long one";
async function cleanUp() {
  await admin.query('DROP DATABASE IF EXISTS newdb_check');
  await admin.query('DROP ROLE IF EXISTS newdb_app');
  await admin.query('DROP ROLE IF EXISTS newdb_plain');
}

(async () => {
  await admin.connect();
  await cleanUp();

  await scenario('the database and its login are made; the login owns it and is not an administrator', async () => {
    const r = await createDatabase(admin, { database: 'newdb_check', user: 'newdb_app', password: PASSWORD });
    assert.deepStrictEqual(r, { ok: true });
    const [row] = (await admin.query(`SELECT pg_get_userbyid(datdba) AS owner, r.rolsuper, r.rolcreatedb, r.rolcanlogin
      FROM pg_database d, pg_roles r WHERE d.datname = 'newdb_check' AND r.rolname = 'newdb_app'`)).rows;
    assert.deepStrictEqual(row, { owner: 'newdb_app', rolsuper: false, rolcreatedb: false, rolcanlogin: true });
  });

  await scenario('the new login signs in with its password (quote and spaces included) and the app sets up its tables', async () => {
    const c = new Client({ database: 'newdb_check', user: 'newdb_app', password: PASSWORD });
    await c.connect();
    const r = await ensureDatabase(c, { appVersion: 'test', user: 'newdb_app' });
    assert.strictEqual(r.created, true);
    const tables = (await c.query(`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public' AND tableowner = 'newdb_app'`)).rows[0].n;
    assert.ok(tables > 20, `the app's tables are made, owned by its login (${tables})`);
    await c.end();
  });

  await scenario('an existing database or login is refused, and nothing changes', async () => {
    const db = await createDatabase(admin, { database: 'newdb_check', user: 'newdb_other', password: PASSWORD });
    assert.match(db.error, /A database called "newdb_check" already exists/);
    const login = await createDatabase(admin, { database: 'newdb_other', user: 'newdb_app', password: PASSWORD });
    assert.match(login.error, /A login called "newdb_app" already exists/);
    const left = (await admin.query(`SELECT (SELECT count(*) FROM pg_database WHERE datname = 'newdb_other')::int AS d,
      (SELECT count(*) FROM pg_roles WHERE rolname = 'newdb_other')::int AS r`)).rows[0];
    assert.deepStrictEqual(left, { d: 0, r: 0 });
  });

  await scenario("a login that isn't PostgreSQL's administrator is refused", async () => {
    await admin.query("CREATE ROLE newdb_plain LOGIN PASSWORD 'plain password'");
    const c = new Client({ database: 'postgres', user: 'newdb_plain', password: 'plain password' });
    await c.connect();
    const r = await createDatabase(c, { database: 'newdb_other', user: 'newdb_other', password: PASSWORD });
    await c.end();
    assert.match(r.error, /isn't PostgreSQL's administrator/);
  });

  await scenario('a bad name is refused before anything is sent', async () => {
    const r = await createDatabase({ query: () => { throw new Error('nothing should be sent'); } }, { database: 'x"; DROP', user: 'u', password: PASSWORD });
    assert.match(r.error, /database name/);
  });

  await scenario('Remove everything drops the database and its login, even while the app is still connected', async () => {
    const c = new Client({ database: 'newdb_check', user: 'newdb_app', password: PASSWORD });
    await c.connect();
    c.on('error', () => {});
    const r = await dropDatabase(admin, { database: 'newdb_check', user: 'newdb_app' });
    assert.deepStrictEqual(r, { ok: true, note: null });
    const left = (await admin.query(`SELECT (SELECT count(*) FROM pg_database WHERE datname = 'newdb_check')::int AS d,
      (SELECT count(*) FROM pg_roles WHERE rolname = 'newdb_app')::int AS r`)).rows[0];
    assert.deepStrictEqual(left, { d: 0, r: 0 });
    await c.end().catch(() => {});
    assert.deepStrictEqual(await dropDatabase(admin, { database: 'newdb_check', user: 'newdb_app' }), { ok: true, note: null }, 'running it again is fine');
  });

  await scenario("PostgreSQL's own databases, administrator logins, and a login that isn't the administrator are refused or left", async () => {
    assert.match((await dropDatabase(admin, { database: 'postgres', user: 'x' })).error, /isn't a database the app can remove/);
    const me = (await admin.query('SELECT current_user AS u')).rows[0].u;
    await admin.query('CREATE DATABASE newdb_check');
    const r = await dropDatabase(admin, { database: 'newdb_check', user: me });
    assert.match(r.note, /one of PostgreSQL's administrators, so it was left/);
    assert.strictEqual((await admin.query('SELECT count(*)::int AS n FROM pg_roles WHERE rolname = $1', [me])).rows[0].n, 1);
    const c = new Client({ database: 'postgres', user: 'newdb_plain', password: 'plain password' });
    await c.connect();
    assert.match((await dropDatabase(c, { database: 'newdb_check', user: 'newdb_plain' })).error, /isn't PostgreSQL's administrator/);
    await c.end();
  });

  await cleanUp();
  await admin.end();
  console.log(process.exitCode ? '\nSOME CHECKS FAILED' : '\nALL CHECKS PASSED');
})();
