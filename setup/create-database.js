// "New database on this PC" (Settings → Database): makes the database and the app's own login, using
// PostgreSQL's administrator login (usually "postgres", whose password was chosen when PostgreSQL was
// installed). That password is only used for this and never saved. The new login owns the new database,
// so the app can set up and update its tables in it. No Electron here, so it can be tested on its own
// (tests/db/verify-create-database.js).

// PostgreSQL names the app accepts: lower-case letters, digits and _, starting with a letter or _.
const NAME = /^[a-z_][a-z0-9_]{0,62}$/;

function checkRequest({ database, user, password }) {
  if (!NAME.test(database || '')) return 'The database name can only use lower-case letters, numbers and _, and must start with a letter.';
  if (!NAME.test(user || '')) return 'The username can only use lower-case letters, numbers and _, and must start with a letter.';
  if (['postgres', 'template0', 'template1'].includes(database)) return `"${database}" is one of PostgreSQL's own databases. Choose another name.`;
  if (user === 'postgres') return 'Choose a username other than "postgres" for the app.';
  if (!password || password.length < 8) return "The app's password needs at least 8 characters.";
  return null;
}

// admin: a connected client logged in as PostgreSQL's administrator. Returns { ok: true } or { ok: false, error }.
async function createDatabase(admin, request) {
  const problem = checkRequest(request);
  if (problem) return { ok: false, error: problem };
  const { database, user, password } = request;
  if ((await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [database])).rows.length) {
    return { ok: false, error: `A database called "${database}" already exists. To use it, enter its details above instead.` };
  }
  if ((await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [user])).rows.length) {
    return { ok: false, error: `A login called "${user}" already exists. Choose another username.` };
  }
  const can = (await admin.query('SELECT rolsuper OR (rolcreaterole AND rolcreatedb) AS ok FROM pg_roles WHERE rolname = current_user')).rows[0];
  if (!can || !can.ok) return { ok: false, error: "That login isn't PostgreSQL's administrator. Use \"postgres\" and the password chosen when PostgreSQL was installed." };

  // Names and the password go in through format(), which quotes them safely.
  // `template` is always one of the fixed strings below.
  const formatted = async (template, ...values) => (await admin.query(
    `SELECT format('${template}', ${values.map((_, i) => `$${i + 1}::text`).join(', ')}) AS s`, values)).rows[0].s;
  await admin.query(await formatted('CREATE ROLE %I LOGIN PASSWORD %L', user, password));
  try {
    await admin.query(await formatted('CREATE DATABASE %I OWNER %I', database, user));
  } catch (err) {
    await admin.query(await formatted('DROP ROLE IF EXISTS %I', user)).catch(() => {});
    return { ok: false, error: `The database couldn't be made: ${err.message}` };
  }
  return { ok: true };
}

module.exports = { checkRequest, createDatabase };
