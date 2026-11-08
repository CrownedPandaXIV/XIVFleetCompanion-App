// The game data for a PC that keeps its fleet in the plugin's file: the same tables as a database's (db/game-data.js,
// from the same files), in a file of the app's own (game-data.db beside the app's settings), which the fleet file's
// queries see by name (db/sqlite-client.js attaches it). Every column is text, named as a new database names them,
// so the same queries read them.
//
// There is nothing to keep from one load to the next (it all comes from the files), so an update loads every table
// again, each all or nothing; a table that fails keeps what it had.
const fs = require('fs');
const path = require('path');
const gameData = require('./game-data');

process.removeAllListeners('warning'); // node:sqlite's "experimental" notice
const { DatabaseSync } = require('node:sqlite');

const LOG = 'game_data_log';
// Looked up by id everywhere, and recipes by what they make (as db/game-data.js indexes them on a database).
const EXTRA_INDEXES = [{ table: 'ffxiv_recipe', column: 'item_result' }];
const quote = (name) => `"${String(name).replace(/"/g, '""')}"`;

function open(file) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file, { timeout: 15000 });
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(`CREATE TABLE IF NOT EXISTS ${LOG} (id INTEGER PRIMARY KEY, applied_at REAL NOT NULL, source TEXT, summary TEXT)`);
  return db;
}

// The columns a file's headers become: "#" is id, the rest named as a new database names them (db/game-data.js).
function columnsFor(headers) {
  const taken = new Set();
  return headers.map((header) => {
    if (header === '#') { taken.add('id'); return 'id'; }
    let name = gameData.newColumnName(header);
    for (let n = 2; taken.has(name); n++) name = `${gameData.newColumnName(header).slice(0, 58)}_${n}`;
    taken.add(name);
    return name;
  });
}

// One table from one file's text, all or nothing. Returns the rows loaded.
function loadTable(db, table, text) {
  const { headers, rows } = gameData.parseCsv(text);
  if (!headers.length || !rows.length) throw new Error('the downloaded file is empty');
  if (!headers.includes('#')) throw new Error('the file has no "#" (id) column');
  const columns = columnsFor(headers);
  db.exec('BEGIN');
  try {
    db.exec(`DROP TABLE IF EXISTS ${quote(table)}`);
    db.exec(`CREATE TABLE ${quote(table)} (${columns.map((c) => `${quote(c)} TEXT`).join(', ')})`);
    const insert = db.prepare(`INSERT INTO ${quote(table)} VALUES (${columns.map(() => '?').join(', ')})`);
    for (const row of rows) insert.run(...columns.map((_, i) => (row[i] === '' || row[i] === undefined ? null : row[i])));
    db.exec(`CREATE INDEX ${quote(`${table}_id_idx`)} ON ${quote(table)} (id)`);
    for (const extra of EXTRA_INDEXES) {
      if (extra.table === table && columns.includes(extra.column)) db.exec(`CREATE INDEX ${quote(`${table}_${extra.column}_idx`)} ON ${quote(table)} (${quote(extra.column)})`);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return rows.length;
}

// Downloads and loads every table. options: { tables, baseUrl, fetchText, fetchJson, onProgress } (for the tests and
// the window). Returns { updated, failed: [{ table, reason }], results }.
async function loadAll(file, options = {}) {
  const tables = options.tables || gameData.TABLES;
  const baseUrl = options.baseUrl || gameData.DEFAULT_BASE_URL;
  const fetchText = options.fetchText || (async (url) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(120000), headers: { 'User-Agent': 'fleet-companion' } });
    if (!response.ok) throw new Error(`download failed (${response.status}) for ${url}`);
    return response.text();
  });
  const db = open(file);
  const results = [];
  try {
    for (const [i, { file: name, table }] of tables.entries()) {
      if (options.onProgress) options.onProgress({ table, done: i, of: tables.length });
      let before = 0;
      try { before = db.prepare(`SELECT count(*) AS n FROM ${quote(table)}`).get().n; } catch { /* not there yet */ }
      try {
        const text = await fetchText(baseUrl + name + '.csv');
        const rows = loadTable(db, table, text);
        results.push({ table, status: 'updated', rowsBefore: Number(before), rowsAfter: rows });
      } catch (err) {
        results.push({ table, status: 'failed', reason: err.message, rowsBefore: Number(before), rowsAfter: Number(before) });
      }
    }
    if (results.some((r) => r.status === 'updated')) {
      const source = options.fetchJson === false ? null : await sourceVersion(options.fetchJson);
      db.prepare(`INSERT INTO ${LOG} (applied_at, source, summary) VALUES (?, ?, ?)`).run(Date.now() / 1000, JSON.stringify(source), JSON.stringify(results));
    }
  } finally {
    db.close();
  }
  const failed = results.filter((r) => r.status === 'failed').map((r) => ({ table: r.table, reason: r.reason }));
  return { updated: results.filter((r) => r.status === 'updated').length, failed, results };
}

async function sourceVersion(fetchJson) {
  try {
    const get = fetchJson || (async (url) => {
      const response = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'fleet-companion', Accept: 'application/vnd.github+json' } });
      if (!response.ok) throw new Error(`request failed (${response.status})`);
      return response.json();
    });
    const commit = await get('https://api.github.com/repos/xivapi/ffxiv-datamining/commits/master');
    return { sha: String(commit.sha).slice(0, 10), date: commit.commit.committer.date, message: String(commit.commit.message).split('\n')[0] };
  } catch {
    return null;
  }
}

// The last load: { applied_at (Date), source, summary }, or null.
function lastUpdate(file) {
  if (!fs.existsSync(file)) return null;
  const db = open(file);
  try {
    const row = db.prepare(`SELECT applied_at, source, summary FROM ${LOG} ORDER BY id DESC LIMIT 1`).get();
    return row ? { applied_at: new Date(row.applied_at * 1000), source: JSON.parse(row.source), summary: JSON.parse(row.summary) } : null;
  } finally {
    db.close();
  }
}

// Loads everything when nothing has been loaded yet. onState({ gameData: 'filling' | 'filled' | 'partial' }) for the
// window. Returns the load's result, or null when there was nothing to do.
async function fillIfEmpty(file, { onState = () => {}, ...options } = {}) {
  if (lastUpdate(file)) return null;
  onState({ gameData: 'filling' });
  const result = await loadAll(file, options);
  if (result.failed.length) console.error('Game data: some tables could not be filled:', result.failed.map((f) => `${f.table}: ${f.reason}`).join('; '));
  onState({ gameData: result.failed.length ? 'partial' : 'filled' });
  return result;
}

module.exports = { loadAll, loadTable, lastUpdate, fillIfEmpty, columnsFor };
