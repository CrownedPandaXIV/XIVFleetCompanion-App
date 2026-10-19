// Game data update: refreshes the ffxiv_* reference tables from the CSV files in the
// xivapi/ffxiv-datamining repository on GitHub. Kept free of Electron so it can be tested
// directly against a database.
//
// Two steps, so nothing changes without a look first:
//   checkAll()  downloads the files and compares them with the tables (changes nothing)
//   applyAll()  loads the tables that changed, each in its own all-or-nothing transaction
//
// Existing columns are matched to CSV headers by name with case and punctuation ignored
// ("ItemResult", "item_result" and "Item[Result]" all match), so this works with however the
// tables were first loaded.

const Papa = require('papaparse');

const DEFAULT_BASE_URL = 'https://raw.githubusercontent.com/xivapi/ffxiv-datamining/master/csv/en/';
const COMMIT_URL = 'https://api.github.com/repos/xivapi/ffxiv-datamining/commits/master';

// CSV file name -> table. Every table gets every column of its file.
const TABLES = [
  ['BaseParam', 'ffxiv_baseparam'],
  ['ClassJob', 'ffxiv_classjob'],
  ['ClassJobCategory', 'ffxiv_classjobcategory'],
  ['CompanyCraftPart', 'ffxiv_companycraftpart'],
  ['CompanyCraftProcess', 'ffxiv_companycraftprocess'],
  ['CompanyCraftSequence', 'ffxiv_companycraftsequence'],
  ['CompanyCraftSupplyItem', 'ffxiv_companycraftsupplyitem'],
  ['EquipSlotCategory', 'ffxiv_equipslotcategory'],
  ['GilShopItem', 'ffxiv_gilshopitem'],
  ['HousingLandSet', 'ffxiv_housinglandset'],
  ['Item', 'ffxiv_item'],
  ['PlaceName', 'ffxiv_placename'],
  ['Recipe', 'ffxiv_recipe'],
  ['RetainerTask', 'ffxiv_retainertask'],
  ['RetainerTaskNormal', 'ffxiv_retainertasknormal'],
  ['RetainerTaskRandom', 'ffxiv_retainertaskrandom'],
  ['SubmarineExploration', 'ffxiv_submarineexploration'],
  ['SubmarineMap', 'ffxiv_submarinemap'],
  ['SubmarinePart', 'ffxiv_submarinepart'],
  ['SubmarineRank', 'ffxiv_submarinerank'],
  ['TerritoryType', 'ffxiv_territorytype'],
  ['World', 'ffxiv_world'],
].map(([file, table]) => ({ file, table }));

const INSERT_BATCH_ROWS = 5000;
const MAX_ROW_DROP = 0.5; // a file with less than half the rows we have is treated as a bad download
const LOG_TABLE = 'companion_game_data_log';

const quoteIdent = (name) => '"' + String(name).replace(/"/g, '""') + '"';

// Header (or column) -> comparison key: lowercase letters and digits only. The CSV's "#" column is the id.
function normalizeKey(name) {
  if (name === '#') return 'id';
  return String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Name for a column that does not exist yet: "RetainerTaskParameter" -> retainer_task_parameter,
// "Ingredient[0]" -> ingredient0, "LandSet[3].MapRange" -> land_set3_map_range.
function newColumnName(header) {
  if (header === '#') return 'id';
  const name = String(header)
    .replace(/\[(\d+)\]/g, '$1')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return name.slice(0, 63) || 'column';
}

function parseCsv(text) {
  const parsed = Papa.parse(text.replace(/^﻿/, ''), { skipEmptyLines: true });
  const [headers = [], ...rows] = parsed.data;
  return { headers, rows };
}

// Compares one file with one table and decides what would happen. Pure: no database access.
//   headers    the CSV header row
//   dbColumns  the table's current column names, in order
//   rowCount   rows the CSV has / rowsBefore rows the table has
function planTable({ table, file, headers, csvRowCount, dbColumns, rowsBefore }) {
  const plan = { table, file, status: 'ok', reason: null, rowsBefore, rowsAfter: csvRowCount, matches: [], added: [], kept: [], renames: [] };
  const block = (reason) => { plan.status = 'blocked'; plan.reason = reason; return plan; };

  if (!dbColumns.length) return block('the table does not exist in the database');
  if (!headers.length || csvRowCount === 0) return block('the downloaded file is empty');
  if (!headers.includes('#')) return block('the file has no "#" (id) column');

  const dbByKey = new Map();
  for (const column of dbColumns) {
    const key = normalizeKey(column);
    if (dbByKey.has(key)) return block(`two columns in the table look alike: "${dbByKey.get(key)}" and "${column}"`);
    dbByKey.set(key, column);
  }
  // An older loader named a column "order" as "order_field" (a reserved word); treat that as the same column.
  const aliasByKey = new Map();
  for (const column of dbColumns) {
    if (!/_field$/.test(column)) continue;
    const alias = normalizeKey(column.replace(/_field$/, ''));
    if (!dbByKey.has(alias)) aliasByKey.set(alias, column);
  }
  const seen = new Set();
  const used = new Set();
  const takenNames = new Set(dbColumns);
  headers.forEach((header, index) => {
    const key = normalizeKey(header);
    if (seen.has(key) && !plan.reason) block(`two columns in the file look alike (including "${header}")`);
    seen.add(key);
    const existing = dbByKey.get(key) || aliasByKey.get(key);
    if (existing) {
      plan.matches.push({ header, index, column: existing });
      used.add(existing);
    } else {
      let name = newColumnName(header);
      for (let n = 2; takenNames.has(name); n++) name = `${newColumnName(header).slice(0, 58)}_${n}`;
      takenNames.add(name);
      plan.added.push({ header, index, column: name });
    }
  });
  if (plan.status === 'blocked') return plan;
  plan.kept = dbColumns.filter((c) => !used.has(c));

  // A placeholder column ("unknown0") that the repository has since given a real name: rename it in place
  // when the file's new column sits in the same position. Nothing else may be relied on by name.
  for (const gone of plan.kept.slice()) {
    if (!/^unknown\d*$/i.test(gone)) continue;
    const target = plan.added.find((a) => a.index === dbColumns.indexOf(gone));
    if (!target) continue;
    plan.renames.push({ from: gone, to: target.column, header: target.header, index: target.index });
    plan.matches.push({ header: target.header, index: target.index, column: target.column });
    plan.kept = plan.kept.filter((c) => c !== gone);
    plan.added = plan.added.filter((a) => a !== target);
  }

  if (!plan.matches.some((m) => m.column === dbByKey.get('id'))) return block('the id column could not be matched');
  if (plan.kept.length && plan.added.length) {
    return block(`looks like a column was renamed (gone: ${plan.kept.join(', ')}; new: ${plan.added.map((a) => a.header).join(', ')}); the app may depend on the old name`);
  }
  if (rowsBefore > 0 && csvRowCount < rowsBefore * MAX_ROW_DROP) {
    return block(`the file has far fewer rows (${csvRowCount}) than the table (${rowsBefore})`);
  }
  return plan;
}

async function downloadText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120000), headers: { 'User-Agent': 'fleet-companion' } });
  if (!response.ok) throw new Error(`download failed (${response.status}) for ${url}`);
  return response.text();
}

// Which repository version the files come from (best effort; the update works without it).
async function fetchSourceVersion(fetchJson) {
  try {
    const commit = await fetchJson(COMMIT_URL);
    return { sha: String(commit.sha).slice(0, 10), date: commit.commit.committer.date, message: String(commit.commit.message).split('\n')[0] };
  } catch (err) {
    return null;
  }
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'fleet-companion', Accept: 'application/vnd.github+json' } });
  if (!response.ok) throw new Error(`request failed (${response.status})`);
  return response.json();
}

async function readTable(client, table) {
  const cols = await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
    [table]
  );
  const dbColumns = cols.rows.map((r) => r.column_name);
  if (!dbColumns.length) return { dbColumns, rowsBefore: 0 };
  const count = await client.query(`SELECT count(*)::bigint AS n FROM ${quoteIdent(table)}`);
  return { dbColumns, rowsBefore: Number(count.rows[0].n) };
}

// How the table stores an empty cell: if it holds empty strings and no NULLs, keep doing that;
// otherwise NULL (what a psql \copy of a CSV produces).
async function emptyStyleOf(client, table, dbColumns) {
  const blanks = dbColumns.map((c) => `count(*) FILTER (WHERE ${quoteIdent(c)}::text = '')`).join(' + ');
  const nulls = dbColumns.map((c) => `count(*) FILTER (WHERE ${quoteIdent(c)} IS NULL)`).join(' + ');
  const r = await client.query(`SELECT (${blanks})::bigint AS blanks, (${nulls})::bigint AS nulls FROM ${quoteIdent(table)}`);
  return Number(r.rows[0].blanks) > 0 && Number(r.rows[0].nulls) === 0 ? 'blank' : 'null';
}

const cellValue = (value, emptyStyle) => (value === '' || value === undefined ? (emptyStyle === 'blank' ? '' : null) : value);

// True when the table already holds exactly the file's rows (same values, same order).
async function tableMatchesFile(client, plan, rows, emptyStyle) {
  if (plan.added.length || plan.renames.length || plan.rowsBefore !== rows.length) return false;
  const cols = plan.matches.map((m) => quoteIdent(m.column)).join(', ');
  const idPos = plan.matches.findIndex((m) => normalizeKey(m.column) === 'id');
  const result = await client.query(`SELECT ${cols} FROM ${quoteIdent(plan.table)}`);
  const existing = new Map();
  for (const row of result.rows) {
    const values = plan.matches.map((m) => row[m.column]);
    existing.set(values[idPos], values);
  }
  if (existing.size !== rows.length) return false;
  for (const csvRow of rows) {
    const values = plan.matches.map((m) => cellValue(csvRow[m.index], emptyStyle));
    const have = existing.get(values[idPos]);
    if (!have) return false;
    for (let i = 0; i < values.length; i++) if ((have[i] ?? null) !== (values[i] ?? null)) return false;
  }
  return true;
}

// Downloads everything and works out what would change. Changes nothing in the database.
//   client   a connected pg client
//   options  { baseUrl, tables, fetchText, fetchSourceVersion }  (all optional; for tests)
async function checkAll(client, options = {}) {
  const baseUrl = options.baseUrl || DEFAULT_BASE_URL;
  const tables = options.tables || TABLES;
  const fetchText = options.fetchText || downloadText;

  const version = options.fetchSourceVersion === false ? null : await fetchSourceVersion(options.fetchJson || fetchJson);
  const results = [];
  const pending = new Map();
  for (const { file, table } of tables) {
    let plan;
    try {
      const text = await fetchText(baseUrl + file + '.csv');
      const { headers, rows } = parseCsv(text);
      const { dbColumns, rowsBefore } = await readTable(client, table);
      // A table the app has started using since the database was set up (such as the FC workshop
      // tables) is made on the first update, starting from just its id column like the others.
      const create = dbColumns.length === 0;
      plan = planTable({ table, file, headers, csvRowCount: rows.length, dbColumns: create ? ['id'] : dbColumns, rowsBefore });
      plan.create = create;
      if (plan.status === 'ok') {
        const emptyStyle = rowsBefore > 0 ? await emptyStyleOf(client, table, dbColumns) : 'null';
        plan.emptyStyle = emptyStyle;
        if (await tableMatchesFile(client, plan, rows, emptyStyle)) plan.status = 'unchanged';
        else pending.set(table, { plan, rows });
      }
    } catch (err) {
      plan = { table, file, status: 'blocked', reason: err.message, rowsBefore: 0, rowsAfter: 0, matches: [], added: [], kept: [], renames: [] };
    }
    results.push(plan);
  }
  return { version, tables: results, pending };
}

// Loads one table from the file inside a single transaction: on any failure the table is left as it was.
async function applyTable(client, plan, rows) {
  const targets = [...plan.matches, ...plan.added];
  await client.query('BEGIN');
  try {
    if (plan.create) await client.query(`CREATE TABLE IF NOT EXISTS ${quoteIdent(plan.table)} (id text)`);
    for (const r of plan.renames) {
      await client.query(`ALTER TABLE ${quoteIdent(plan.table)} RENAME COLUMN ${quoteIdent(r.from)} TO ${quoteIdent(r.to)}`);
    }
    for (const a of plan.added) {
      await client.query(`ALTER TABLE ${quoteIdent(plan.table)} ADD COLUMN ${quoteIdent(a.column)} text`);
    }
    await client.query(`TRUNCATE ${quoteIdent(plan.table)}`);
    const columnList = targets.map((t) => quoteIdent(t.column)).join(', ');
    const unnestArgs = targets.map((_, i) => `$${i + 1}::text[]`).join(', ');
    const insert = `INSERT INTO ${quoteIdent(plan.table)} (${columnList}) SELECT * FROM unnest(${unnestArgs})`;
    for (let start = 0; start < rows.length; start += INSERT_BATCH_ROWS) {
      const batch = rows.slice(start, start + INSERT_BATCH_ROWS);
      const params = targets.map((t) => batch.map((row) => cellValue(row[t.index], plan.emptyStyle)));
      await client.query(insert, params);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  }
}

// After tables were reloaded: their indexes and fresh statistics. Best effort: the data itself is
// already in place, and the app works (more slowly) without either.
async function afterLoad(client, tableNames) {
  if (!tableNames.length) return;
  try {
    await ensureIndexes(client, { tables: tableNames.map((table) => ({ table })) });
    await analyzeTables(client, tableNames);
  } catch (err) {
    console.error('Game tables were loaded, but their indexes or statistics could not be updated:', err.message);
  }
}

// Applies every table that the check found changed. Returns one result per table.
async function applyAll(client, checked) {
  const results = [];
  for (const plan of checked.tables) {
    if (plan.status !== 'ok') {
      results.push({ table: plan.table, status: plan.status, reason: plan.reason, rowsBefore: plan.rowsBefore, rowsAfter: plan.rowsBefore });
      continue;
    }
    const entry = checked.pending.get(plan.table);
    try {
      await applyTable(client, plan, entry.rows);
      results.push({ table: plan.table, status: 'updated', rowsBefore: plan.rowsBefore, rowsAfter: plan.rowsAfter, added: plan.added.map((a) => a.column), renamed: plan.renames });
    } catch (err) {
      results.push({ table: plan.table, status: 'failed', reason: err.message, rowsBefore: plan.rowsBefore, rowsAfter: plan.rowsBefore });
    }
  }
  await afterLoad(client, results.filter((r) => r.status === 'updated').map((r) => r.table));
  return results;
}

// ---- Indexes and planner statistics for the game tables ----
// The app looks game rows up by id (item names, jobs, worlds, retainer tasks...) and recipes by the
// item they make. Without an index each lookup reads the whole table (52,000 items). An update empties
// and refills tables (TRUNCATE + INSERT), which keeps indexes; a restore of a missing table recreates
// it without them, so they are made again after both, and checked when the app starts.
const EXTRA_INDEXES = [{ table: 'ffxiv_recipe', column: 'item_result' }];

// True when some index on the table starts with this column.
async function hasIndexOn(client, table, column) {
  const r = await client.query(
    `SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
     WHERE i.indrelid = to_regclass($1) AND a.attname = $2 LIMIT 1`,
    [`public.${quoteIdent(table)}`, column]
  );
  return r.rows.length > 0;
}

// Makes the missing indexes: a unique one on each table's id column (a plain one if the ids repeat),
// plus EXTRA_INDEXES. Returns the indexes made, as "table.column".
async function ensureIndexes(client, { tables = TABLES } = {}) {
  const made = [];
  for (const { table } of tables) {
    const columns = await columnsOf(client, 'public', table);
    if (!columns.length) continue;
    const wanted = [];
    const idColumn = columns.find((c) => normalizeKey(c) === 'id');
    if (idColumn) wanted.push({ column: idColumn, unique: true });
    for (const extra of EXTRA_INDEXES) {
      if (extra.table === table && columns.includes(extra.column)) wanted.push({ column: extra.column, unique: false });
    }
    for (const { column, unique } of wanted) {
      if (await hasIndexOn(client, table, column)) continue;
      const name = quoteIdent(`${table}_${column}_idx`.slice(0, 63));
      const target = `public.${quoteIdent(table)} (${quoteIdent(column)})`;
      try {
        await client.query(`CREATE ${unique ? 'UNIQUE ' : ''}INDEX ${name} ON ${target}`);
      } catch (err) {
        if (!unique) throw err;
        await client.query(`CREATE INDEX ${name} ON ${target}`);
      }
      made.push(`${table}.${column}`);
    }
  }
  return made;
}

// Refreshes the planner's statistics (row counts, value spread) for the given tables, so Postgres
// picks good plans for queries on freshly loaded data. Only tables that exist are analysed.
async function analyzeTables(client, tableNames) {
  for (const table of tableNames) {
    const exists = await client.query('SELECT to_regclass($1) IS NOT NULL AS ok', [`public.${quoteIdent(table)}`]);
    if (exists.rows[0].ok) await client.query(`ANALYZE public.${quoteIdent(table)}`);
  }
}

// At app start: the indexes, and statistics for any game table Postgres has never analysed.
async function prepareTables(client, { tables = TABLES } = {}) {
  const made = await ensureIndexes(client, { tables });
  const names = tables.map((t) => t.table);
  const r = await client.query(
    `SELECT relname FROM pg_stat_user_tables
     WHERE schemaname = 'public' AND relname = ANY($1) AND last_analyze IS NULL AND last_autoanalyze IS NULL`,
    [names]
  );
  const analyzed = r.rows.map((row) => row.relname);
  await analyzeTables(client, analyzed);
  return { indexesMade: made, analyzed };
}

// A small history of updates, shown in Settings. Best effort: never stops an update.
async function recordUpdate(client, version, results) {
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS ${LOG_TABLE} (id serial PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now(), source jsonb, summary jsonb)`);
    await client.query(`INSERT INTO ${LOG_TABLE} (source, summary) VALUES ($1, $2)`, [JSON.stringify(version), JSON.stringify(results)]);
  } catch (err) {
    // ignore
  }
}

async function lastUpdate(client) {
  try {
    const r = await client.query(`SELECT applied_at, source, summary FROM ${LOG_TABLE} ORDER BY id DESC LIMIT 1`);
    return r.rows[0] || null;
  } catch (err) {
    return null;
  }
}

// ---- Filling in a new database ----
// A database that has never had the game data loaded (no update recorded, no items) is filled in by itself
// the first time the app connects to it (db/index.js), so a new user never has to look for the button.
async function needsFilling(client, { probeTable = 'ffxiv_item' } = {}) {
  if (await lastUpdate(client)) return false;
  try {
    return (await client.query(`SELECT NOT EXISTS (SELECT 1 FROM ${quoteIdent(probeTable)}) AS empty`)).rows[0].empty;
  } catch {
    return false;
  }
}

// Downloads and loads every game table, as Settings → Data → Game Data → Update does (no backup: there is
// nothing to keep). Returns { updated, failed: [{ table, reason }] }.
async function fillGameData(client, options = {}) {
  const checked = await checkAll(client, options);
  const results = await applyAll(client, checked);
  if (results.some((r) => r.status === 'updated')) await recordUpdate(client, checked.version, results.filter((r) => r.status !== 'unchanged'));
  const failed = results
    .filter((r) => r.status === 'blocked' || r.status === 'failed')
    .map((r) => ({ table: r.table, reason: r.reason || r.error || 'unknown' }));
  return { updated: results.filter((r) => r.status === 'updated').length, failed };
}

// ---- Backups of the game tables ----
// A backup is a copy of the ffxiv_* tables in their own schema (gdbackup_YYYYMMDD_HHMMSS_mmm) in the
// same database, made before an update so it can be undone. Only the newest KEEP_BACKUPS are kept.
const BACKUP_NAME = /^gdbackup_\d{8}_\d{6}_\d{3}$/;
const KEEP_BACKUPS = 8;

function newBackupName(now = new Date()) {
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `gdbackup_${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}_` +
    `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}_${pad(now.getUTCMilliseconds(), 3)}`;
}

async function listBackups(client) {
  const r = await client.query(`
    SELECT n.nspname AS name, obj_description(n.oid, 'pg_namespace') AS comment,
           (SELECT coalesce(sum(pg_total_relation_size(c.oid)), 0) FROM pg_class c
             WHERE c.relnamespace = n.oid AND c.relkind = 'r')::bigint AS bytes
    FROM pg_namespace n
    WHERE n.nspname LIKE 'gdbackup\_%'
    ORDER BY n.nspname DESC`);
  return r.rows.filter((row) => BACKUP_NAME.test(row.name)).map((row) => {
    let meta = {};
    try { meta = JSON.parse(row.comment || '{}'); } catch (err) { /* ignore */ }
    const m = row.name.match(/^gdbackup_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_(\d{3})$/);
    const createdAt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7])).toISOString();
    return { name: row.name, createdAt, label: meta.label || '', tables: meta.tables || [], bytes: Number(row.bytes) };
  });
}

async function pruneBackups(client, keep, protectedNames = []) {
  const all = await listBackups(client);
  for (const backup of all.slice(keep)) {
    if (protectedNames.includes(backup.name)) continue;
    await client.query(`DROP SCHEMA ${quoteIdent(backup.name)} CASCADE`);
  }
}

// Copies every existing game table into a new backup schema, all or nothing.
async function createBackup(client, { label = '', tables = TABLES, keep = KEEP_BACKUPS, protect = [] } = {}) {
  const name = newBackupName();
  const saved = [];
  await client.query('BEGIN');
  try {
    await client.query(`CREATE SCHEMA ${quoteIdent(name)}`);
    for (const { table } of tables) {
      const exists = await client.query('SELECT to_regclass($1) IS NOT NULL AS ok', [`public.${quoteIdent(table)}`]);
      if (!exists.rows[0].ok) continue;
      await client.query(`CREATE TABLE ${quoteIdent(name)}.${quoteIdent(table)} AS TABLE public.${quoteIdent(table)}`);
      const count = await client.query(`SELECT count(*)::bigint AS n FROM ${quoteIdent(name)}.${quoteIdent(table)}`);
      saved.push({ table, rows: Number(count.rows[0].n) });
    }
    const meta = JSON.stringify({ label, tables: saved }).replace(/'/g, "''");
    await client.query(`COMMENT ON SCHEMA ${quoteIdent(name)} IS '${meta}'`);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  }
  await pruneBackups(client, keep, [name, ...protect]).catch(() => {});
  return { name, tables: saved };
}

async function columnsOf(client, schema, table) {
  const r = await client.query(
    'SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position',
    [schema, table]
  );
  return r.rows.map((x) => x.column_name);
}

// Puts the game tables back the way a backup has them. The current state is backed up first, so a
// restore can itself be undone. Each table is restored all or nothing.
async function restoreBackup(client, name, { tables = TABLES } = {}) {
  if (!BACKUP_NAME.test(String(name))) throw new Error('That is not a valid backup name.');
  const backups = await listBackups(client);
  const backup = backups.find((b) => b.name === name);
  if (!backup) throw new Error('That backup no longer exists.');

  const safety = await createBackup(client, { label: `before restoring ${name}`, tables, protect: [name] });
  const results = [];
  for (const { table } of tables) {
    if (!backup.tables.some((t) => t.table === table)) continue;
    try {
      const backupColumns = await columnsOf(client, name, table);
      const liveColumns = await columnsOf(client, 'public', table);
      await client.query('BEGIN');
      try {
        if (!liveColumns.length) {
          await client.query(`CREATE TABLE public.${quoteIdent(table)} AS TABLE ${quoteIdent(name)}.${quoteIdent(table)}`);
        } else {
          for (const column of backupColumns.filter((c) => !liveColumns.includes(c))) {
            await client.query(`ALTER TABLE public.${quoteIdent(table)} ADD COLUMN ${quoteIdent(column)} text`);
          }
          const list = backupColumns.map(quoteIdent).join(', ');
          await client.query(`TRUNCATE public.${quoteIdent(table)}`);
          await client.query(`INSERT INTO public.${quoteIdent(table)} (${list}) SELECT ${list} FROM ${quoteIdent(name)}.${quoteIdent(table)}`);
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      }
      results.push({ table, status: 'restored', rows: backup.tables.find((t) => t.table === table).rows });
    } catch (err) {
      results.push({ table, status: 'failed', reason: err.message });
    }
  }
  await afterLoad(client, results.filter((r) => r.status === 'restored').map((r) => r.table));
  return { results, safetyBackup: safety.name };
}

async function deleteBackup(client, name) {
  if (!BACKUP_NAME.test(String(name))) throw new Error('That is not a valid backup name.');
  await client.query(`DROP SCHEMA IF EXISTS ${quoteIdent(name)} CASCADE`);
}

module.exports = {
  TABLES,
  DEFAULT_BASE_URL,
  normalizeKey,
  newColumnName,
  parseCsv,
  planTable,
  checkAll,
  applyAll,
  applyTable,
  recordUpdate,
  lastUpdate,
  needsFilling,
  fillGameData,
  KEEP_BACKUPS,
  listBackups,
  createBackup,
  restoreBackup,
  deleteBackup,
  ensureIndexes,
  analyzeTables,
  prepareTables,
};
