// Copies a PostgreSQL fleet into a new fleet file (db/sqlite/tables.sql and views.sql, as the plugin makes it) and its
// game data into a game data file (all text, as the app keeps it), for the tests that run the app on the file
// (tests/db/verify-file-pages.js and the click-through tests). Times become Unix seconds, yes/no 1/0, lists one per
// line; a character's id stays a whole number and a Free Company's becomes text, as the plugin writes them.
const fs = require('fs');
const path = require('path');

process.removeAllListeners('warning');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..', '..');

async function copyIntoFile(pg, fleetFile, gameFile) {
  const lite = new DatabaseSync(fleetFile);
  lite.exec(fs.readFileSync(path.join(ROOT, 'db', 'sqlite', 'tables.sql'), 'utf8'));
  lite.exec(fs.readFileSync(path.join(ROOT, 'db', 'sqlite', 'views.sql'), 'utf8'));
  const pgTables = new Set((await pg.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`)).rows.map((r) => r.table_name));
  let rows = 0;
  for (const { name } of lite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite%'`).all()) {
    if (!pgTables.has(name)) continue;
    const cols = lite.prepare(`SELECT name, type FROM pragma_table_info(?)`).all(name);
    const pgCols = new Set((await pg.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, [name])).rows.map((r) => r.column_name));
    const both = cols.filter((c) => pgCols.has(c.name));
    lite.exec(`DELETE FROM ${name}`);
    const data = (await pg.query(`SELECT ${both.map((c) => `"${c.name}"`).join(', ')} FROM ${name}`)).rows;
    const stmt = lite.prepare(`INSERT INTO ${name} (${both.map((c) => `"${c.name}"`).join(', ')}) VALUES (${both.map(() => '?').join(', ')})`);
    lite.exec('BEGIN');
    for (const r of data) {
      stmt.run(...both.map((c) => {
        const v = r[c.name];
        if (v === null || v === undefined) return null;
        if (v instanceof Date) return v.getTime() / 1000;
        if (typeof v === 'boolean') return v ? 1 : 0;
        if (Array.isArray(v)) return v.join('\n');
        if (Buffer.isBuffer(v)) return v;
        if (typeof v === 'object') return JSON.stringify(v);
        const type = String(c.type).toUpperCase();
        // A Free Company's id is text in the file, a character's a whole number (subject_id holds either).
        if (c.name === 'subject_id') return r.subject_type === 'fc' ? String(v) : BigInt(v);
        if (type === 'INTEGER' && typeof v === 'string' && /^-?\d+$/.test(v)) return BigInt(v);
        if (type === 'INTEGER' && typeof v === 'string' && /^-?\d+\.0+$/.test(v)) return BigInt(v.replace(/\.0+$/, ''));
        if (type === 'REAL' && typeof v === 'string') return Number(v);
        if (type === 'TEXT') return String(v);
        return v;
      }));
      rows++;
    }
    lite.exec('COMMIT');
  }
  lite.close();
  // The game data: every ffxiv_ table, all text, as the app's game data file keeps it.
  const game = new DatabaseSync(gameFile);
  for (const table of [...pgTables].filter((t) => t.startsWith('ffxiv_')).sort()) {
    const cols = (await pg.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`, [table])).rows.map((r) => r.column_name);
    game.exec(`CREATE TABLE "${table}" (${cols.map((c) => `"${c}" TEXT`).join(', ')})`);
    const data = (await pg.query(`SELECT * FROM "${table}"`)).rows;
    const stmt = game.prepare(`INSERT INTO "${table}" VALUES (${cols.map(() => '?').join(', ')})`);
    game.exec('BEGIN');
    for (const r of data) stmt.run(...cols.map((c) => (r[c] === null ? null : String(r[c]))));
    game.exec('COMMIT');
  }
  game.close();
  return rows;
}


module.exports = { copyIntoFile };
