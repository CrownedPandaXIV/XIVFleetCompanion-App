// At a release: adds the views' new columns to db/released-view-columns.txt, the list of every view column a release
// has had (older plugins on other PCs read them by name, so they must stay; tests/db/verify-sqlite-views.js checks it).
// Lines already there are kept as they are; nothing is ever taken out.
//
//   node tests/db/released-view-columns.js
//
// Set PGHOST, PGPORT, PGUSER, PGPASSWORD for a scratch server, as its administrator: it makes and drops a database named
// fleet_released_columns.
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const DB = path.join(__dirname, '..', '..', 'db');
const FILE = path.join(DB, 'released-view-columns.txt');
const NAME = 'fleet_released_columns';
const server = { host: process.env.PGHOST, port: process.env.PGPORT, user: process.env.PGUSER, password: process.env.PGPASSWORD };

(async () => {
  const admin = new Client({ ...server, database: 'postgres' });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${NAME}`);
  await admin.query(`CREATE DATABASE ${NAME}`);
  const pg = new Client({ ...server, database: NAME });
  await pg.connect();
  try {
    await pg.query(fs.readFileSync(path.join(DB, 'schema.sql'), 'utf8'));
    await pg.query(fs.readFileSync(path.join(DB, 'views.sql'), 'utf8'));
    const now = (await pg.query(`SELECT table_name || '.' || column_name || ':' || data_type AS line FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name LIKE 'fleet\\_%'
        AND table_name IN (SELECT table_name FROM information_schema.views WHERE table_schema = current_schema()) ORDER BY 1`)).rows.map((r) => r.line);
    const lines = fs.readFileSync(FILE, 'utf8').split(/\r?\n/).filter(Boolean);
    const header = lines.filter((l) => l.startsWith('#'));
    const released = new Set(lines.filter((l) => !l.startsWith('#')));
    const added = now.filter((l) => !released.has(l));
    fs.writeFileSync(FILE, [...header, ...[...released, ...added].sort()].join('\n') + '\n');
    console.log(added.length ? `added ${added.length}:\n${added.join('\n')}` : 'nothing new');
  } finally {
    await pg.end();
    await admin.query(`DROP DATABASE IF EXISTS ${NAME}`);
    await admin.end();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
