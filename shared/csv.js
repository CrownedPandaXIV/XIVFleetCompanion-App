// CSV for "Export this table to CSV" (right-click any table): rows of cell text -> CSV that Excel and
// Google Sheets open as is. No Electron here, so it can be tested on its own (tests/csv.test.js).

// One cell: quoted when it holds a comma, quote or line break; a cell that starts like a formula
// (=, +, -, @) gets a leading apostrophe so a spreadsheet shows it as text instead of running it,
// unless it is a plain number such as -1,234.
function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@]/.test(text) && !/^[+-]?[\d,.]+%?$/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// rows: [[cell, ...], ...] -> CSV text, with a byte order mark so Excel reads it as UTF-8 (names with
// accents, the − sign).
function toCsv(rows) {
  return '﻿' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

// A file name from a title: "Supplies - Ceruleum from FC Credits 2026-10-07.csv".
function csvFileName(title, date = new Date()) {
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const safe = String(title || 'Table').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || 'Table';
  return `${safe} ${day}.csv`;
}

module.exports = { csvCell, toCsv, csvFileName };
