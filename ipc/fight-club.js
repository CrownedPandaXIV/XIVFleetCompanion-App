// Fight Club import: read the route spreadsheet, check it, and replace the stored copy.
const { ipcMain, dialog } = require('electron');
const XLSX = require('xlsx');
const { createPgClient, loadPostgresConfig } = require('../db');

// Maps each expected Fight Club CSV header to its Postgres column + type.
// "required: true" means the row is unusable without it (only Route
// qualifies - everything else can legitimately be blank on some rows,
// e.g. a route with no Notes). Used both for header validation (does
// the file have a matching column for each of these?) and row validation
// (does a NUMERIC-typed cell actually contain a number?).
const FIGHT_CLUB_COLUMNS = [
  { csvHeader: 'OJ 24h %',        dbColumn: 'oj_24h_pct',      type: 'numeric', required: false },
  { csvHeader: 'Gil/Sub/Day',     dbColumn: 'gil_sub_day',     type: 'numeric', required: false },
  { csvHeader: 'Route',           dbColumn: 'route',           type: 'text',    required: true  },
  { csvHeader: 'Hours',           dbColumn: 'hours',           type: 'numeric', required: false },
  { csvHeader: 'Rec Build (NOTES)', dbColumn: 'rec_build_notes', type: 'text',  required: false },
  { csvHeader: 'Unmod Min Rank',  dbColumn: 'unmod_min_rank',  type: 'text',    required: false },
  { csvHeader: 'Min Rank Build',  dbColumn: 'min_rank_build',  type: 'text',    required: false },
  { csvHeader: 'Gil/Sub',         dbColumn: 'gil_sub',         type: 'numeric', required: false },
  { csvHeader: 'Gil/FC',          dbColumn: 'gil_fc',          type: 'numeric', required: false },
  { csvHeader: 'Gil/Hr',          dbColumn: 'gil_hr',          type: 'numeric', required: false },
  { csvHeader: 'Gil/Day',         dbColumn: 'gil_day',         type: 'numeric', required: false },
  { csvHeader: 'Gil/Week',        dbColumn: 'gil_week',        type: 'numeric', required: false },
  { csvHeader: 'Gil/Month',       dbColumn: 'gil_month',       type: 'numeric', required: false },
  { csvHeader: 'Gil/Year',        dbColumn: 'gil_year',        type: 'numeric', required: false },
  { csvHeader: 'Avg EXP',         dbColumn: 'avg_exp',         type: 'numeric', required: false },
  { csvHeader: 'Avg EXP/H',       dbColumn: 'avg_exp_hr',      type: 'numeric', required: false },
  { csvHeader: 'Repair Times',    dbColumn: 'repair_times',    type: 'text',    required: false },
  { csvHeader: 'Notes',           dbColumn: 'notes',           type: 'text',    required: false },
  { csvHeader: 'FC Points',       dbColumn: 'fc_points',       type: 'numeric', required: false },
  { csvHeader: 'GC iLvl/Day',     dbColumn: 'gc_ilvl_day',     type: 'numeric', required: false },
  { csvHeader: '~QVs/Day',        dbColumn: 'qvs_day',         type: 'numeric', required: false },
  { csvHeader: 'Fuel/Day',        dbColumn: 'fuel_day',        type: 'numeric', required: false },
];

// Reads and validates a Fight Club Excel export against the columns we
// know how to store. Reading the real .xlsx (rather than a CSV export)
// means merged cells can be detected and forward-filled correctly - a
// merged cell like "WSUC++" spanning rows 26-34 only has its value in
// the merge's TOP-LEFT cell in the underlying file; every other cell it
// visually covers is genuinely empty. CSV export has no way to represent
// that at all, which is exactly what silently dropped that value on
// rows 27-34 before. It also means numeric cells arrive as real numbers,
// not display-formatted text ("118,854", "3.33m"), so the comma/suffix
// parsing problem goes away too.
function parseAndValidateFightClubFile(filePath) {
  const workbook = XLSX.readFile(filePath);

  // Prefer the sheet this project actually uses; fall back to the first
  // sheet so a differently-named single-sheet export still works.
  const sheetName = workbook.SheetNames.includes('Fight Club Comparisons')
    ? 'Fight Club Comparisons'
    : workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  // Raw grid, one array per row. Missing cells come back as null rather
  // than undefined so the index math below is always safe.
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });

  // Forward-fill merged cells: a merge's value only lives in its
  // top-left cell (grid[s.r][s.c]) - every other cell it spans is null
  // in the raw grid. Copying that value across the whole range restores
  // what the sheet actually displays.
  const merges = sheet['!merges'] || [];
  for (const range of merges) {
    const value = grid[range.s.r] ? grid[range.s.r][range.s.c] : null;
    if (value === null || value === undefined) continue;
    for (let r = range.s.r; r <= range.e.r; r++) {
      if (!grid[r]) continue;
      for (let c = range.s.c; c <= range.e.c; c++) {
        grid[r][c] = value;
      }
    }
  }

  const headerRow = grid[0] || [];
  const actualHeaders = headerRow.filter((h) => h !== null && h !== undefined).map(String);

  const missingRequired = FIGHT_CLUB_COLUMNS.filter(
    (c) => c.required && !actualHeaders.includes(c.csvHeader)
  );
  const missingOptional = FIGHT_CLUB_COLUMNS.filter(
    (c) => !c.required && !actualHeaders.includes(c.csvHeader)
  );

  if (missingRequired.length > 0) {
    return {
      success: false,
      stage: 'structural',
      error: `Missing required column(s): ${missingRequired.map((c) => c.csvHeader).join(', ')}`,
      actualHeaders
    };
  }

  // Maps each expected header to its column INDEX in this file - headers
  // can shift position between exports (a column added/removed), so this
  // is looked up once per column rather than assumed fixed.
  const colIndexByHeader = {};
  headerRow.forEach((h, i) => {
    if (h !== null && h !== undefined) colIndexByHeader[String(h)] = i;
  });

  // Row numbers need to reflect the REAL position in the sheet (so "row
  // 34" in the preview matches row 34 if you open the file yourself) -
  // captured here, before any filtering, so dropping blank rows below
  // doesn't shift the numbering.
  const rows = grid
    .slice(1)
    .map((row, i) => ({ row, sheetRowNumber: i + 2 }))
    .filter(({ row }) => row.some((cell) => cell !== null && cell !== undefined && cell !== ''))
    .map(({ row, sheetRowNumber }) => {
      const data = {};
      const issues = [];

      for (const col of FIGHT_CLUB_COLUMNS) {
        const colIndex = colIndexByHeader[col.csvHeader];
        const rawValue = colIndex !== undefined ? row[colIndex] : null;

        if (col.type === 'numeric') {
          if (rawValue === null || rawValue === undefined || rawValue === '') {
            data[col.dbColumn] = null;
          } else if (typeof rawValue === 'number') {
            data[col.dbColumn] = rawValue;
          } else {
            // A stray string in a numeric column - shouldn't happen for
            // real Fight Club data now that real cell values are used
            // directly, but a stray note (like row 34's comment) can
            // still land here, so this stays as a safety net.
            const n = Number(String(rawValue).replace(/,/g, '').replace(/%$/, ''));
            if (Number.isNaN(n)) {
              issues.push(`"${col.csvHeader}" contains a non-numeric value: "${rawValue}"`);
              data[col.dbColumn] = null;
            } else {
              data[col.dbColumn] = n;
            }
          }
        } else {
          data[col.dbColumn] =
            rawValue === null || rawValue === undefined || rawValue === '' ? null : String(rawValue).trim();
        }
      }

      if (!data.route) {
        issues.push('Route is blank on this row.');
      }

      return { rowNumber: sheetRowNumber, data, issues, hasIssue: issues.length > 0 };
    });

  return {
    success: true,
    actualHeaders,
    missingOptional: missingOptional.map((c) => c.csvHeader),
    rows
  };
}

ipcMain.handle('import-fight-club:pick-file', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select Fight Club Excel Export',
    filters: [{ name: 'Excel Files', extensions: ['xlsx', 'xls'] }],
    properties: ['openFile']
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, canceled: true };
  }

  try {
    return parseAndValidateFightClubFile(result.filePaths[0]);
  } catch (err) {
    return { success: false, stage: 'read', error: err.message };
  }
});
// Commits a confirmed set of rows (already filtered by the person in the
// preview screen - only rows they left checked arrive here) as one atomic
// replace: the whole table is emptied and reloaded inside a single
// transaction, so a failure partway through leaves the OLD data intact
// rather than a half-imported table.
ipcMain.handle('import-fight-club:commit', async (event, { rows, patchLabel }) => {
  const config = loadPostgresConfig();
  const client = createPgClient(config);

  const dbColumns = FIGHT_CLUB_COLUMNS.map((c) => c.dbColumn);

  try {
    await client.connect();
    await client.query('BEGIN');
    await client.query('TRUNCATE TABLE fight_club_routes RESTART IDENTITY');

    for (const row of rows) {
      const values = dbColumns.map((col) => row.data[col]);
      const placeholders = dbColumns.map((_, i) => `$${i + 1}`).join(', ');
      const patchPlaceholder = `$${dbColumns.length + 1}`;

      await client.query(
        `INSERT INTO fight_club_routes (${dbColumns.join(', ')}, patch_label)
         VALUES (${placeholders}, ${patchPlaceholder})`,
        [...values, patchLabel || null]
      );
    }

    await client.query('COMMIT');
    return { success: true, imported: rows.length };
  } catch (err) {
    await client.query('ROLLBACK');
    return { success: false, error: err.message };
  } finally {
    await client.end();
  }
});
