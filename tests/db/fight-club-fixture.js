// The app's Fight Club import (ipc/fight-club.js), for the plugin's own import from the game to be checked against: a
// few made-up route spreadsheets with the awkward parts on purpose (merged cells, numbers typed as text, a stray note in
// a number column, blank rows, columns moved or missing, the route sheet not first, data not starting at A1), what the
// app reads from each, and the table after it imports the rows it would tick. Written to one file:
//
//   node tests/db/fight-club-fixture.js ../XIVFleetCompanion/tests/FleetWriterTests/fight-club-fixture.json
//
// The plugin's tests read the same files their own way, import the same rows into PostgreSQL and SQLite, and compare.
// Set PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE for a scratch server, as its administrator: it makes and drops a
// database named fleet_fight_club_check.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client } = require('pg');
const XLSX = require('xlsx');
const Module = require('module');

const handlers = new Map();
let picked = null;
const original = Module._load;
Module._load = function load(request, ...rest) {
  if (request === 'electron') {
    return {
      ipcMain: { handle(name, fn) { handlers.set(name, fn); } },
      dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [picked] }) },
      app: { getPath: () => '.', getVersion: () => '0' }, safeStorage: {}, BrowserWindow: { getAllWindows: () => [] },
    };
  }
  return original.call(this, request, ...rest);
};
const NAME = 'fight_club_check';
const db = require('../../db');
const config = { host: process.env.PGHOST, port: process.env.PGPORT, user: process.env.PGUSER, password: process.env.PGPASSWORD, database: `fleet_${NAME}` };
db.loadPostgresConfig = () => config;
db.createPgClient = () => new Client(config);
const { FIGHT_CLUB_COLUMNS } = require('../../ipc/fight-club');
Module._load = original;

const DB = path.join(__dirname, '..', '..', 'db');
const HEADERS = FIGHT_CLUB_COLUMNS.map((c) => c.csvHeader);

// A sheet from rows of cells (null: empty; an object: a cell as SheetJS writes it), with merges.
function sheet(rows, { merges = [], origin = 'A1' } = {}) {
  const ws = XLSX.utils.aoa_to_sheet(rows, { origin });
  // Its size as other programs write it: from the first cell used, not from A1.
  if (origin !== 'A1') ws['!ref'] = XLSX.utils.encode_range({ s: XLSX.utils.decode_cell(origin), e: XLSX.utils.decode_range(ws['!ref']).e });
  if (merges.length) ws['!merges'] = merges.map((m) => XLSX.utils.decode_range(m));
  return ws;
}
function book(sheets, opts = {}) {
  const wb = XLSX.utils.book_new();
  for (const [name, ws] of sheets) XLSX.utils.book_append_sheet(wb, ws, name);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', ...opts });
}

// The spreadsheet as Fight Club lays it out, with every awkward case.
function fullSheet() {
  const head = [...HEADERS.slice(2), 'Extra column', HEADERS[0], HEADERS[1]];
  const row = (values) => head.map((h) => (h in values ? values[h] : null));
  const rows = [head,
    row({ Route: 'MROJZ', Hours: 36.5, 'Rec Build (NOTES)': 'WSUC++', 'Gil/Hr': 4521.25, 'Gil/Sub': 118854, 'OJ 24h %': 0.1 + 0.2, 'Unmod Min Rank': 85, 'Repair Times': '6 (3)' }),
    row({ Route: 'OJ', Hours: 24, 'Gil/Hr': '3,333', 'Gil/Sub/Day': '12.5%', 'FC Points': 1e21, 'Avg EXP': 1.5e-7, Notes: '  needs   S+ bridge  ' }),
    row({ Route: 'JORZ', Hours: 'about 30', 'Gil/Hr': 'see note →', 'Gil/Day': '   ', 'Gil/Week': '0x1A', 'Gil/Month': '1e3', 'Gil/Year': '.5', 'Avg EXP/H': '+7', 'Min Rank Build': true }),
    row({}),
    row({ Route: null, Hours: 12, Notes: 'route left blank' }),
    row({ Route: 'MOVZ', 'GC iLvl/Day': -3, '~QVs/Day': 0, 'Fuel/Day': '-0', 'Gil/FC': 1234567.891, Notes: 'Ünïcödé · 「テスト」' }),
    row({ Route: 'ABCD', 'Rec Build (NOTES)': null }),
    row({ Route: 'EFGH', 'Gil/Hr': { t: 'n', v: 900, f: 'SUM(1,2)' }, Notes: { t: 'e', v: 0x07 } }),
    row({ Route: 1234, Hours: 0 }),
  ];
  // "WSUC++" merged down over the next build rows; a number merged across; the extra column merged with a note.
  const recCol = XLSX.utils.encode_col(head.indexOf('Rec Build (NOTES)'));
  const gilWeek = XLSX.utils.encode_col(head.indexOf('Gil/Week'));
  return sheet(rows, { merges: [`${recCol}2:${recCol}4`, `${recCol}8:${recCol}10`, `${gilWeek}9:${gilWeek}10`] });
}

const BOOKS = [
  ['route sheet second, shared strings', () => book([['Read me', sheet([['Notes about the sheet'], ['Route', 'not this one']])], ['Fight Club Comparisons', fullSheet()]], { bookSST: true })],
  ['one sheet, text written in the cells', () => book([['Sheet1', fullSheet()]], { bookSST: false })],
  ['some columns missing, a header twice', () => book([['Routes', sheet([
    ['Route', 'Gil/Hr', 'Hours', 'Gil/Hr', 42, null, 'Notes'],
    ['A', 1, 2, 3, null, null, 'x'],
    [null, null, null, null, null, null, null],
    ['B', '1,5', '', 'n/a', 7, 8, null],
  ])]])],
  ['no Route column', () => book([['Fight Club Comparisons', sheet([['Rout', 'Gil/Hr'], ['A', 1]])]])],
  ['data starting at B3', () => book([['Fight Club Comparisons', sheet([['Route', 'Hours', 'Notes'], ['A', 1, 'merged'], ['B', 2, null], ['C', 3, null]], { origin: 'B3', merges: ['D4:D5'] })]])],
  ['only a header', () => book([['Fight Club Comparisons', sheet([HEADERS])]])],
  ['an empty sheet', () => book([['Fight Club Comparisons', XLSX.utils.aoa_to_sheet([])]])],
];

const TABLE = `SELECT id, route, ${FIGHT_CLUB_COLUMNS.filter((c) => c.dbColumn !== 'route').map((c) => (c.type === 'numeric' ? `${c.dbColumn}::text AS ${c.dbColumn}` : c.dbColumn)).join(', ')}, patch_label
  FROM fight_club_routes ORDER BY id`;

(async () => {
  const out = process.argv[2];
  const admin = new Client();
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${config.database}`);
  await admin.query(`CREATE DATABASE ${config.database}`);
  const client = new Client(config);
  await client.connect();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fight-club-'));
  try {
    const schema = fs.readFileSync(path.join(DB, 'schema.sql'), 'utf8');
    await client.query(schema);
    await client.query(`INSERT INTO fight_club_routes (route) VALUES ('OLD1'), ('OLD2')`);
    const books = [];
    for (const [i, [about, make]] of BOOKS.entries()) {
      const bytes = make();
      picked = path.join(dir, `book${i}.xlsx`);
      fs.writeFileSync(picked, bytes);
      const read = await handlers.get('import-fight-club:pick-file')();
      let imported = null;
      if (read.success) {
        // The rows the app ticks (those without problems), with a patch label on every other book.
        const rows = read.rows.filter((r) => !r.hasIssue);
        const patchLabel = i % 2 === 0 ? `  Patch 7.${i} ` : '';
        const answer = await handlers.get('import-fight-club:commit')(null, { rows, patchLabel });
        imported = { rowNumbers: rows.map((r) => r.rowNumber), patchLabel, answer, table: (await client.query(TABLE)).rows };
      }
      books.push({ about, xlsx: Buffer.from(bytes).toString('base64'), read, imported });
      console.log(`${about}: ${read.success ? `${read.rows.length} rows, ${read.rows.filter((r) => r.hasIssue).length} flagged` : read.error}${imported ? `; imported ${imported.answer.imported}` : ''}`);
    }
    // Not a spreadsheet at all.
    picked = path.join(dir, 'not.xlsx');
    fs.writeFileSync(picked, 'just some text, not a spreadsheet');
    const bad = await handlers.get('import-fight-club:pick-file')();
    if (out) {
      fs.writeFileSync(out, `${JSON.stringify({
        about: 'Written by XIVFleetCompanion-App tests/db/fight-club-fixture.js: route spreadsheets, what the app reads from each, and the table after its import.',
        schema, sqliteTables: fs.readFileSync(path.join(DB, 'sqlite', 'tables.sql'), 'utf8'), table: TABLE,
        columns: FIGHT_CLUB_COLUMNS, books, notSpreadsheet: { success: bad.success, stage: bad.stage },
      })}\n`);
      console.log(`written to ${out}`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    await client.end();
    await admin.query(`DROP DATABASE IF EXISTS ${config.database}`);
    await admin.end();
  }
})().catch((e) => { console.error(e); process.exit(1); });
