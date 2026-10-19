// Keeps the database's tables up to date, so a new version of the app (or of the plugin) never needs
// SQL run by hand. The first time the app connects (db/index.js), ensureDatabase():
//  - on an empty database, creates every table from db/schema.sql;
//  - on a database made before this existed, adds whatever database versions 1 to 9 would add
//    that is still missing (db/catch-up.sql), then records it as version 9;
//  - then applies each file of db/updates/ newer than the recorded version, in number order, each in
//    its own transaction together with its row in companion_schema_version.
// An advisory lock makes two copies of the app connecting at once take turns.
const fs = require('fs');
const path = require('path');

// The layout db/schema.sql and db/catch-up.sql lead to: database versions 1 to 9.
const BASELINE = 9;
const LOCK_KEY = 73104; // any fixed number; only this app takes this advisory lock
const DB_DIR = __dirname;

// The numbered files of `dir`, oldest first: [{ version, name, file }].
function listUpdates(dir = path.join(DB_DIR, 'updates')) {
  if (!fs.existsSync(dir)) return [];
  const updates = [];
  for (const file of fs.readdirSync(dir)) {
    const m = /^(\d+)_(.+)\.sql$/.exec(file);
    if (!m) continue;
    const version = Number(m[1]);
    if (version <= BASELINE) throw new Error(`db/updates/${file}: numbers up to ${BASELINE} are taken (the old scripts that came with the plugin)`);
    if (updates.some((u) => u.version === version)) throw new Error(`db/updates/: two files are number ${version}`);
    updates.push({ version, name: m[2], file: path.join(dir, file) });
  }
  return updates.sort((a, b) => a.version - b.version);
}

// The tables db/schema.sql creates, to tell an empty database from one with someone else's tables.
function schemaTables(schemaSql) {
  return [...schemaSql.matchAll(/^CREATE TABLE (\w+)/gm)].map((m) => m[1]);
}

// 'empty', 'current' (has companion_character_current), 'old' (still has the per-sync snapshot table,
// from before plugin 0.4.0) or 'partial' (some of this app's tables, but not the main one).
async function databaseLayout(client, tables) {
  const { rows: [r] } = await client.query(
    `SELECT to_regclass('companion_character_current') IS NOT NULL AS current,
            to_regclass('companion_character_snapshot') IS NOT NULL AS snapshot,
            EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = current_schema() AND tablename = ANY($1)) AS known`,
    [tables]);
  if (r.snapshot) return 'old';
  if (r.current) return 'current';
  return r.known ? 'partial' : 'empty';
}

// Runs a script of several statements; if it fails part way, ends its transaction before rethrowing.
async function runScript(client, sql) {
  try {
    await client.query(sql);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  }
}

function record(client, version, name, appVersion) {
  return client.query(
    `INSERT INTO companion_schema_version (version, name, app_version) VALUES ($1, $2, $3)
     ON CONFLICT (version) DO NOTHING`, [version, name, appVersion || null]);
}

const CREATE_VERSION_TABLE = `CREATE TABLE companion_schema_version (
    version     int         PRIMARY KEY,
    name        text        NOT NULL,
    applied_at  timestamptz NOT NULL DEFAULT now(),
    app_version text
)`;

// A message for the window when the login may not change the database.
function noRightsError(user, cause) {
  const err = new Error(
    `The database login${user ? ` "${user}"` : ''} is not allowed to change the tables, so the app cannot update them. ` +
    'In Settings, connect with the login that owns the tables, or have its owner run the update.');
  err.code = cause ? cause.code : '42501';
  err.cause = cause;
  return err;
}

// Brings the database up to date. Returns { version, latest, created, applied: [what changed],
// tracked: false when the login cannot create the version table (only allowed while nothing needs
// changing), newer: true when a newer app already updated it further }. Throws with a plain message
// when it cannot.
async function ensureDatabase(client, { appVersion, user, updatesDir, dbDir = DB_DIR } = {}) {
  const updates = listUpdates(updatesDir || path.join(dbDir, 'updates'));
  const latest = Math.max(BASELINE, ...updates.map((u) => u.version));
  const result = { version: null, latest, created: false, applied: [], tracked: true, newer: false };

  await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
  try {
    let version = null;
    let tracked = (await client.query(`SELECT to_regclass('companion_schema_version') IS NOT NULL AS t`)).rows[0].t;
    if (tracked) version = (await client.query('SELECT max(version) AS v FROM companion_schema_version')).rows[0].v;

    if (version === null) {
      const schemaSql = fs.readFileSync(path.join(dbDir, 'schema.sql'), 'utf8');
      const layout = await databaseLayout(client, schemaTables(schemaSql));
      if (layout === 'empty') {
        await runScript(client, schemaSql);
        await record(client, latest, 'new database', appVersion);
        result.created = true;
        result.applied.push('created every table');
        version = latest;
        tracked = true;
      } else if (layout === 'current') {
        const notices = [];
        const onNotice = (msg) => { if (/^added /.test(msg.message)) notices.push(msg.message); };
        client.on('notice', onNotice);
        try {
          await client.query(fs.readFileSync(path.join(dbDir, 'catch-up.sql'), 'utf8'));
        } finally {
          client.removeListener('notice', onNotice);
        }
        result.applied.push(...notices);
        if (!tracked) {
          try {
            await client.query(CREATE_VERSION_TABLE);
            tracked = true;
          } catch (err) {
            if (err.code !== '42501') throw err;
          }
        }
        if (tracked) await record(client, BASELINE, 'catch-up', appVersion);
        version = BASELINE;
      } else if (layout === 'old') {
        throw new Error('This database is from before plugin 0.4.0 (it still has the old companion_character_snapshot table), and the app can\'t bring one that old up to date. Make a new, empty database and connect the app and the plugin to it; the app sets it up.');
      } else {
        throw new Error('This database has some of the app\'s tables but not companion_character_current, so the app will not change it. Connect to an empty database or to the one the plugin writes to.');
      }
    }

    const pending = updates.filter((u) => u.version > version);
    if (pending.length > 0 && !tracked) throw noRightsError(user);
    for (const u of pending) {
      await client.query('BEGIN');
      try {
        await client.query(fs.readFileSync(u.file, 'utf8'));
        await record(client, u.version, u.name, appVersion);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        err.message = `Database update ${u.version} (${u.name}) failed, so nothing of it was applied: ${err.message}`;
        throw err;
      }
      result.applied.push(`update ${u.version}: ${u.name}`);
      version = u.version;
    }

    Object.assign(result, { version, tracked, newer: version > latest });
    return result;
  } catch (err) {
    if (err.code === '42501' && !/not allowed to change/.test(err.message)) throw noRightsError(user, err);
    throw err;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
  }
}

module.exports = { ensureDatabase, listUpdates, schemaTables, BASELINE };
