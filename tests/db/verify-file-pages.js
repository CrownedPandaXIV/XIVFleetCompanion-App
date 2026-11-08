// The app on the fleet file (the plugin's "Just this PC", db/sqlite-client.js) against the app on PostgreSQL: the same
// fleet in both, every page's call made on each, and every answer compared. Then the edits are made on both and the
// answers compared again.
//
// The fleet is the click-through tests' (a new database as the app makes it, tests/db/generate-metric-history.sql and
// tests/ui/fixtures.sql), copied into a new fleet file (db/sqlite/tables.sql and views.sql) and its game
// data into a game data file, the way the app keeps them.
//
//   node tests/db/verify-file-pages.js                 check
//   node tests/db/verify-file-pages.js --write-types   also rewrite db/sqlite/result-types.js from PostgreSQL's answers
//
// Set PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE for a scratch server, as its administrator: it makes and drops a
// database named fleet_file_pages. psql must be on the PATH (or in PG_BIN_DIR).
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const { Client, types } = require('pg');
const Module = require('module');

process.removeAllListeners('warning');
const { DatabaseSync } = require('node:sqlite');

const NAME = 'fleet_file_pages';
const ROOT = path.join(__dirname, '..', '..');
const WRITE_TYPES = process.argv.includes('--write-types');

// ---- The app's calls, loaded with Electron stood in for ----
const handlers = new Map();
const original = Module._load;
Module._load = function load(request, ...rest) {
  if (request === 'electron') {
    return { ipcMain: { handle(name, fn) { handlers.set(name, fn); } }, app: { getPath: () => os.tmpdir(), getVersion: () => '9.9.9' },
      safeStorage: {}, BrowserWindow: { getAllWindows: () => [] }, dialog: {}, shell: {} };
  }
  return original.call(this, request, ...rest);
};
const db = require('../../db');
let current = null;
db.withClient = async (work, onError) => { try { return await work(current); } catch (err) { return onError(err, current); } };
// Trends opens clients of its own (and ends them): this script's, left open.
db.openClient = async () => new Proxy(current, { get: (t, k) => (k === 'end' ? async () => {} : typeof t[k] === 'function' ? t[k].bind(t) : t[k]) });
db.fleetLocation = () => (current && current.dialect === 'sqlite' ? 'file' : 'database');
for (const file of ['parts', 'subs', 'retainers', 'roster', 'details', 'income', 'shopping', 'settings', 'universalis', 'supplies',
  'inventory', 'trends', 'play-style', 'fight-club']) require(`../../ipc/${file}`);
Module._load = original;
// No live prices or anything else from the internet: both sides the same.
global.fetch = async () => { throw new Error('no internet in this test'); };

const { SqliteClient } = require('../../db/sqlite-client');

// ---- Kinds of values, from PostgreSQL's answers ----
const KIND_BY_OID = {
  20: 'text', 1700: 'text', /* bigint and numeric come back as text, like text */ 21: 'number', 23: 'number', 26: 'number', 700: 'number', 701: 'number',
  16: 'bool', 1082: 'time', 1114: 'time', 1184: 'time', 114: 'json', 3802: 'json', 17: 'bytes',
  25: 'text', 1043: 'text', 19: 'text', 18: 'text', 1042: 'text',
  1000: 'array', 1005: 'array', 1007: 'array', 1009: 'array', 1015: 'array', 1016: 'array', 1021: 'array', 1022: 'array', 1231: 'array', 1182: 'array', 1185: 'array',
};
const seenKinds = new Map(); // column name -> Map(kind -> example query)
let watching = false; // only the pages' own queries count

function watch(client) {
  const query = client.query.bind(client);
  client.query = async (...args) => {
    const r = await query(...args);
    if (!watching) return r;
    for (const res of Array.isArray(r) ? r : [r]) {
      for (const f of res.fields || []) {
        const kind = KIND_BY_OID[f.dataTypeID] || `oid ${f.dataTypeID}`;
        if (!seenKinds.has(f.name)) seenKinds.set(f.name, new Map());
        if (!seenKinds.get(f.name).has(kind)) seenKinds.get(f.name).set(kind, String(args[0]).replace(/\s+/g, ' ').trim().slice(0, 160));
      }
    }
    return r;
  };
  return client;
}

// ---- Comparing answers ----
// Numbers within a hundred-thousandth (PostgreSQL's numeric and SQLite's floating point, and rates per day worked out
// a moment apart), times to the millisecond,
// numbers written as text compared as numbers.
function differences(a, b, at = '', out = []) {
  if (out.length > 12) return out;
  const num = (x) => (typeof x === 'number' ? x : typeof x === 'string' && /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(x) ? Number(x) : null);
  if (a instanceof Date || b instanceof Date) {
    const ta = a instanceof Date ? a.getTime() : a; const tb = b instanceof Date ? b.getTime() : b;
    if (!(a instanceof Date && b instanceof Date) || Math.abs(ta - tb) > 1) out.push(`${at}: PostgreSQL ${JSON.stringify(a)}, file ${JSON.stringify(b)}`);
    return out;
  }
  if (Buffer.isBuffer(a) || Buffer.isBuffer(b)) {
    if (!(Buffer.isBuffer(a) && Buffer.isBuffer(b) && a.equals(b))) out.push(`${at}: bytes differ`);
    return out;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    if (Array.isArray(a) !== Array.isArray(b)) { out.push(`${at}: list vs not`); return out; }
    if (Array.isArray(a) && a.length !== b.length) { out.push(`${at}: ${a.length} items on PostgreSQL, ${b.length} on the file`); return out; }
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) differences(a[k], b[k], `${at}.${k}`, out);
    return out;
  }
  if (typeof a !== typeof b && !(num(a) !== null && num(b) !== null)) {
    out.push(`${at}: PostgreSQL ${JSON.stringify(a)} (${typeof a}), file ${JSON.stringify(b)} (${typeof b})`);
    return out;
  }
  const [na, nb] = [num(a), num(b)];
  if (na !== null && nb !== null) {
    if (typeof a !== typeof b) out.push(`${at}: PostgreSQL ${JSON.stringify(a)} (${typeof a}), file ${JSON.stringify(b)} (${typeof b})`);
    else if (Math.abs(na - nb) > 1e-5 * Math.max(1, Math.abs(na))) out.push(`${at}: PostgreSQL ${a}, file ${b}`);
    return out;
  }
  if (a !== b) out.push(`${at}: PostgreSQL ${JSON.stringify(a)}, file ${JSON.stringify(b)}`);
  return out;
}

// ---- Copying the fleet into a file ----
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

// ---- The calls ----
// Reads: [call, ...arguments]. Each is made on both and the answers compared.
const READS = [
  ['get-roster'], ['get-data-freshness'], ['get-pcs'], ['get-loot'], ['get-market'],
  ['get-parts-needed', {}], ['get-sub-build-rules'],
  ['settings:get-auto-refresh-interval'], ['settings:get-repair-kit-cost'], ['settings:get-low-thresholds'],
  ['get-retainer-summary'], ['get-retainer-targets'],
  ['get-supplies'], ['get-metric-catalog'], ['get-metric-subjects'],
  ['get-play-style'], ['get-universalis-setting'],
  ['get-submarines'], ['get-forecast-accuracy'], ['get-fleet-warnings'],
  ['get-salvage'], ['get-fc-list'], ['get-fc-directory'], ['get-house-warnings'], ['get-fleet-inventory-summary'],
  ['find-items', 'test'], ['find-items', 'salvage item'], ['find-items', 'zzz'],
  ['get-income'], ['get-shopping-list', {}],
];

let failures = 0;
let n = 0;
function report(name, problems) {
  n++;
  if (!problems.length) { console.log(`PASS ${n}. ${name}`); return; }
  failures++;
  console.log(`FAIL ${n}. ${name}\n   ${problems.slice(0, 12).join('\n   ')}`);
}

// Calls whose rows come in no particular order (the window sorts them): compared as sorted lists.
const UNORDERED = new Set(['get-character-inventory', 'get-fc-inventory', 'get-supplies', 'get-income']);
const sortRows = (r) => (r && Array.isArray(r.rows) ? { ...r, rows: [...r.rows].sort((x, y) => (JSON.stringify(x) < JSON.stringify(y) ? -1 : 1)) } : r);

async function both(pg, file, call, args) {
  const fn = handlers.get(call);
  assert.ok(fn, `no call named ${call}`);
  current = pg;
  watching = true;
  const a = await fn({}, ...args).finally(() => { watching = false; });
  current = file;
  const b = await fn({}, ...args);
  return UNORDERED.has(call) ? [sortRows(a), sortRows(b)] : [a, b];
}

// The calls that need the fleet's own ids, and the charts, as the window makes them.
async function moreReads(pg) {
  const cids = (await pg.query('SELECT cid::text AS cid FROM companion_character_current ORDER BY cid LIMIT 6')).rows.map((r) => r.cid);
  const fcs = (await pg.query('SELECT DISTINCT fc_id::text AS fc_id FROM companion_fc_inventory_snapshot ORDER BY 1 LIMIT 4')).rows.map((r) => r.fc_id);
  const DAY = 86400000;
  const now = Date.now();
  const ago = (ms) => new Date(now - ms).toISOString();
  const at = new Date(now).toISOString();
  const salvage = [22500, 22501, 22502, 22503, 22504, 22505, 22506, 22507];
  const catalog = require('../../shared/column-catalog').catalogForInterface();
  return [
    ['get-character-inventory', cids], ['get-character-inventory', []], ['get-fc-inventory', fcs],
    ['get-parts-needed', { aheadDays: 14 }],
    ['get-shopping-list', { buyFromVendors: true, aheadDays: 7, priceScope: 'fleet' }],
    ['get-gear-suggestions', { jobAbbreviation: 'BSM', targetMode: 'level', targetValue: 90, onlyCrafted: false, slotLabel: 'Main Hand' }],
    ['get-gear-suggestions', { jobAbbreviation: 'BSM', targetMode: 'ilvl', targetValue: 600, onlyCrafted: true, slotLabel: 'Main Hand' }],
    ['get-column-extras', { subject: 'character', ids: cids, columns: catalog.character.map((c) => c.key) }],
    ['get-column-extras', { subject: 'fc', ids: fcs, columns: catalog.fc.map((c) => c.key) }],
    ['get-metric-series', { from: ago(30 * DAY), to: at, points: 150, parts: [{ metric: 'gil', subjectType: 'character' }] }],
    ['get-metric-series', { from: ago(7 * DAY), to: at, points: 168, parts: [{ metric: 'gil', subjectType: 'character' }], subjectIds: [...cids.slice(0, 3), '18014498578999999'] }],
    ['get-metric-series', { from: ago(DAY), to: at, points: 144, parts: [{ metric: 'ceruleum', subjectType: 'character' }] }],
    ['get-metric-series', { from: ago(365 * DAY), to: at, points: 150,
      parts: [...salvage.map((id) => ({ metric: `item_qty:${id}`, subjectType: 'character', weight: 2 })), ...salvage.map((id) => ({ metric: `item_qty:${id}`, subjectType: 'fc', weight: 3 }))] }],
    ['get-metric-series', { from: ago(7 * DAY), to: at, points: 168, parts: salvage.map((id) => ({ metric: `item_qty:${id}`, subjectType: 'fc' })), subjectIds: fcs }],
    ['get-metric-series', { from: ago(30 * DAY), to: at, points: 30, parts: [{ metric: 'retainer_count', subjectType: 'character' }] }],
    ['get-metric-series', { from: new Date(now - 3 * DAY - 7777).toISOString(), to: new Date(now - 3 * DAY + 20 * 60000 - 7777).toISOString(), points: 150, parts: [{ metric: 'gil', subjectType: 'character' }] }],
    ['get-metric-series', { from: ago(DAY), to: ago(2 * DAY), points: 20, parts: [{ metric: 'gil', subjectType: 'character' }] }],
  ];
}

// The edits (tests/db/edits-list.js, and some on this fleet's own characters, retainers and subs), each made on
// both: the answers must match, and afterwards every table.
async function edits(pg) {
  const { EDITS } = require('./edits-list');
  const cids = (await pg.query('SELECT cid::text AS cid FROM companion_character_current ORDER BY cid LIMIT 5')).rows.map((r) => r.cid);
  const retainers = (await pg.query('SELECT retainer_id::text AS id FROM companion_retainer_lookup ORDER BY retainer_id LIMIT 3')).rows.map((r) => r.id);
  const sub = (await pg.query('SELECT cid::text AS cid, sub_name FROM companion_submarine_snapshot ORDER BY cid, sub_name LIMIT 1')).rows[0];
  const pc = (await pg.query('SELECT pc_name, account_label FROM companion_pc_status ORDER BY pc_name LIMIT 1')).rows[0];
  return [
    ...EDITS,
    ['update-sort-order', [cids[2], cids[0], cids[1]]],
    ['set-craft-enabled', { cid: sub.cid, subName: sub.sub_name, enabled: false }],
    ['set-craft-enabled', { cid: sub.cid, subName: sub.sub_name, enabled: true }],
    ['save-retainer-target', { retainerId: retainers[0], targetMode: 'level', targetValue: 90, onlyCrafted: true }],
    ['save-retainer-target', { retainerId: retainers[1], targetMode: 'ilvl', targetValue: 640, onlyCrafted: false }],
    ['delete-retainer-target', retainers[1]],
    ['add-sub-build-rule', { rank: 50, cid_override: cids[3], sub_filter: 'Sub1', hull: 'S', stern: 'U', bow: 'W', bridge: 'C' }],
    ...(pc ? [['remove-pc', pc.pc_name, pc.account_label]] : []),
    ['remove-character', cids[4]],
    ['remove-character', 'not a number'],
    ['import-fight-club:commit', { patchLabel: '7.1', rows: [
      { data: { route: 'OJ', hours: 24, gil_sub_day: 120000, rec_build_notes: '90: SSUC' } },
      { data: { route: 'MROJZ', hours: 36.5, gil_sub_day: 250000, rec_build_notes: '' } }] }],
  ];
}

// Every fleet table's rows, the same way from both: times as Unix seconds, yes/no as 1/0, numbers as numbers, ids
// exact as text, sorted.
async function tableRows(pg, file) {
  const out = { pg: {}, file: {} };
  const lite = file.db;
  for (const { name } of lite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite%'`).all()) {
    const cols = lite.prepare('SELECT name FROM pragma_table_info(?)').all(name).map((c) => c.name);
    const pgCols = new Set((await pg.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, [name])).rows.map((r) => r.column_name));
    // (not the times each side worked out from its own moment: when it was saved, and the Next Rank date)
    const both = cols.filter((c) => pgCols.has(c) && !/updated_at|imported_at|predicted_at/.test(c));
    if (!both.length) continue;
    const plain = (v) => {
      if (v === null || v === undefined) return null;
      if (v instanceof Date) return Math.round(v.getTime() / 1000);
      if (typeof v === 'boolean') return v ? 1 : 0;
      if (Array.isArray(v)) return v.join('\n');
      if (Buffer.isBuffer(v) || v instanceof Uint8Array) return Buffer.from(v).toString('hex');
      if (typeof v === 'bigint') return Number.isSafeInteger(Number(v)) ? Number(v) : v.toString();
      if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) return Number.isSafeInteger(Number(v)) || v.includes('.') ? Number(v) : v;
      if (typeof v === 'number') return Number.isInteger(v) ? v : Number(v.toPrecision(10));
      return v;
    };
    const sorted = (rows) => rows.map((r) => JSON.stringify(both.map((c) => plain(r[c])))).sort();
    const timeCols = new Set(['first_seen_at', 'last_synced_at', 'recorded_at', 'made_at', 'predicted_at', 'returned_at', 'received_at', 'logged_in_at',
      'last_sync_at', 'last_read_at', 'check_at', 'house_last_visited', 'fc_founding_date', 'fc_eligibility_override', 'items_seen_at', 'eligible_at']);
    const pgRows = (await pg.query(`SELECT ${both.map((c) => `"${c}"`).join(', ')} FROM ${name}`)).rows;
    const stmt = lite.prepare(`SELECT ${both.map((c) => `"${c}"`).join(', ')} FROM ${name}`);
    stmt.setReadBigInts(true);
    const fileRows = stmt.all().map((r) => Object.fromEntries(both.map((c) => [c, timeCols.has(c) && r[c] !== null ? new Date(Number(r[c]) * 1000) : r[c]])));
    out.pg[name] = sorted(pgRows);
    out.file[name] = sorted(fileRows);
  }
  return out;
}

// One round: every read on both, the edits on both (answers and then every table), every read again.
async function round(name, pg, file) {
    const reads = [...READS, ...await moreReads(pg)];
  const readAll = async (when) => {
    for (const [call, ...args] of reads) {
      let problems;
      try {
        const [a, b] = await both(pg, file, call, args);
        problems = differences(a, b, call);
        if (!problems.length && a && a.success === false && !/must be before the end|game data for crafting is not loaded/.test(a.error)) problems = [`both failed: ${a.error}`];
      } catch (err) {
        problems = [err.stack];
      }
      report(`${call}${args.length ? ` ${JSON.stringify(args).slice(0, 90)}` : ''}: the same on the file (${name}${when})`, problems);
    }
  };
  await readAll('');

  // ---- The edits ----
  for (const [call, ...args] of await edits(pg)) {
    let problems;
    try {
      const [a, b] = await both(pg, file, call, args);
      problems = differences(a, b, call);
    } catch (err) {
      problems = [err.stack];
    }
    report(`${call} ${JSON.stringify(args).slice(0, 90)}: the same answer on the file (${name})`, problems);
  }
  const after = await tableRows(pg, file);
  for (const table of Object.keys(after.pg).sort()) {
    const [a, b] = [after.pg[table], after.file[table]];
    // (as counted lists: the same rows, as many times)
    const count = (rows) => rows.reduce((m, r) => m.set(r, (m.get(r) || 0) + 1), new Map());
    const [ca, cb] = [count(a), count(b)];
    const onlyPg = [...ca].filter(([r, k]) => cb.get(r) !== k).map(([r]) => r);
    const onlyFile = [...cb].filter(([r, k]) => ca.get(r) !== k).map(([r]) => r);
    report(`after the edits, ${table} is the same (${name}, ${a.length} rows)`,
      onlyPg.length || onlyFile.length ? [...onlyPg.slice(0, 4).map((r) => `only on PostgreSQL: ${r}`), ...onlyFile.slice(0, 4).map((r) => `only on the file: ${r}`)] : []);
  }
  await readAll(', after the edits');

}

(async () => {
  const admin = new Client();
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
  // Text sorted character by character, as SQLite sorts it, whatever the server's language setting: then any order
  // that still differs is a real difference, not the two sorting names differently.
  await admin.query(`CREATE DATABASE ${NAME} TEMPLATE template0 LOCALE 'C'`);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'file-pages-'));
  const psql = (args) => execFileSync(process.env.PG_BIN_DIR ? path.join(process.env.PG_BIN_DIR, 'psql') : 'psql',
    ['-q', '-v', 'ON_ERROR_STOP=1', '-d', NAME, ...args], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
  const pg = watch(new Client({ database: NAME }));
  let file = null;
  try {
    // A new database as the app makes it, then the click-through tests' fleet. That fleet also has the history table
    // plugins before 0.4.0 wrote, which the file never has: without it both read the current-state table.
    await pg.connect();
    await require('../../db/apply-updates').ensureDatabase(pg, { appVersion: '9.9.9', user: process.env.PGUSER || 'postgres' });
    psql(['-v', 'days=30', '-f', 'tests/db/generate-metric-history.sql']);
    psql(['-f', 'tests/ui/fixtures.sql']);
    await pg.query('DROP TABLE companion_character_snapshot');

    const fleetFile = path.join(folder, 'fleet.db');
    const gameFile = path.join(folder, 'game-data.db');
    const copied = await copyIntoFile(pg, fleetFile, gameFile);
    console.log(`Copied ${copied} rows into the fleet file.`);
    file = new SqliteClient(fleetFile, { gameData: gameFile });

    await round('the click-through fleet', pg, file);
    await file.end();

    // ---- A made-up fleet with real-sized Free Company ids and the awkward cases (tests/db/made-up-fleet.js) ----
    // (Its sub parts have no workshop recipes in the game data here, so the Shopping List says so on both.)
    const { insert, fleet } = require('./made-up-fleet');
    const data = fleet(42, Date.now() / 1000);
    const latest = new Map();
    for (const r of data.companion_metric_history) {
      const key = `${r.subject_type}|${r.subject_id}|${r.metric}`;
      if (!latest.has(key) || latest.get(key).recorded_at <= r.recorded_at) latest.set(key, r);
    }
    data.companion_metric_latest = [...latest.values()].map(({ subject_type, subject_id, metric, value, recorded_at }) => ({ subject_type, subject_id, metric, value, recorded_at }));
    data.fleet_economics_settings = [['low_ceruleum_threshold', 100], ['low_repair_kit_threshold', 10], ['supply_window_days', 14], ['restock_target_days', 14],
      ['income_window_days', 7], ['market_stale_days', 7]].map(([setting_key, setting_value]) => ({ setting_key, setting_value }));
    const madeUpFile = path.join(folder, 'made-up.db');
    const lite = new DatabaseSync(madeUpFile);
    lite.exec(fs.readFileSync(path.join(ROOT, 'db', 'sqlite', 'tables.sql'), 'utf8'));
    lite.exec(fs.readFileSync(path.join(ROOT, 'db', 'sqlite', 'views.sql'), 'utf8'));
    const fleetTables = lite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite%' AND name NOT IN ('housing_key_city_lookup', 'companion_inventory_type_lookup')`).all().map((r) => r.name);
    for (const table of fleetTables) {
      if ((await pg.query('SELECT to_regclass($1) IS NOT NULL AS ok', [table])).rows[0].ok) await pg.query(`TRUNCATE ${table}`);
      lite.exec(`DELETE FROM ${table}`);
    }
    for (const [table, rows] of Object.entries(data)) await insert(pg, lite, table, rows);
    // (numbered tables carry on after the rows put in with their numbers, as the plugin's own copy leaves them)
    for (const table of ['sub_build_rules', 'fight_club_routes']) {
      await pg.query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), coalesce((SELECT max(id) FROM ${table}), 0) + 1, false)`);
    }
    lite.close();
    file = new SqliteClient(madeUpFile, { gameData: gameFile });
    await round('a made-up fleet', pg, file);

    // ---- What PostgreSQL gave for each column name ----
    // Game data is text in both (its tables are all text): a name that is also a number elsewhere stays a number.
    const types = Object.fromEntries([...seenKinds].sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, kinds]) => {
      const list = [...kinds.keys()];
      if (list.length === 2 && list.includes('number') && list.includes('text') && /ffxiv_/.test(kinds.get('text'))) return [name, ['number']];
      return [name, list];
    }));
    const mixed = Object.entries(types).filter(([, kinds]) => kinds.length > 1);
    const { RESULT_TYPES } = require('../../db/sqlite/result-types');
    const missing = Object.entries(types).filter(([name, kinds]) => kinds.length === 1 && RESULT_TYPES[name] !== kinds[0]);
    if (WRITE_TYPES) {
      const body = Object.entries(types).filter(([, kinds]) => kinds.length === 1).map(([name, [kind]]) => `  ${/^[a-z_][a-z0-9_]*$/i.test(name) ? name : JSON.stringify(name)}: '${kind}',`).join('\n');
      const text = fs.readFileSync(path.join(ROOT, 'db', 'sqlite', 'result-types.js'), 'utf8').replace(/const RESULT_TYPES = \{[\s\S]*?\n\};/, `const RESULT_TYPES = {\n${body}\n};`);
      fs.writeFileSync(path.join(ROOT, 'db', 'sqlite', 'result-types.js'), text);
      console.log(`Wrote ${Object.keys(types).length - mixed.length} column kinds.`);
    }
    report('every column the pages read has its kind in db/sqlite/result-types.js', WRITE_TYPES ? [] : missing.map(([name, kinds]) => `${name}: ${kinds[0]} (have ${RESULT_TYPES[name] || 'none'})`));
    report('no column name comes back as two kinds', mixed.map(([name, kinds]) => `${name}: ${kinds.map((k) => `${k} (${seenKinds.get(name).get(k)})`).join(' / ')}`));
  } finally {
    if (file) await file.end();
    await pg.end().catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
    await admin.end();
    if (process.env.KEEP_FILES) console.log(`Files kept in ${folder}`);
    else fs.rmSync(folder, { recursive: true, force: true });
  }
  console.log(failures ? `${failures} of ${n} failed` : `All ${n} passed`);
  process.exitCode = failures ? 1 : 0;
})().catch((err) => { console.error(err); process.exitCode = 1; });
