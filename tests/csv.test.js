const test = require('node:test');
const assert = require('node:assert');
const { csvCell, toCsv, csvFileName } = require('../shared/csv');

test('cells are quoted only when needed, and formulas are not run by a spreadsheet', () => {
  assert.strictEqual(csvCell('Aki Main'), 'Aki Main');
  assert.strictEqual(csvCell('12,345'), '"12,345"');
  assert.strictEqual(csvCell('say "hi"'), '"say ""hi"""');
  assert.strictEqual(csvCell('two\nlines'), '"two\nlines"');
  assert.strictEqual(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.strictEqual(csvCell('-1,234'), '"-1,234"', 'a negative number stays a number');
  assert.strictEqual(csvCell('+5%'), '+5%');
  assert.strictEqual(csvCell(null), '');
});

test('a table becomes CSV with a UTF-8 marker and Windows line ends', () => {
  assert.strictEqual(toCsv([['Name', 'Gil'], ['Aki', '1,000']]), '﻿Name,Gil\r\nAki,"1,000"\r\n');
});

test('file names are safe and dated', () => {
  assert.strictEqual(csvFileName('Supplies: Ceruleum / FC', new Date(2026, 9, 7)), 'Supplies Ceruleum FC 2026-10-07.csv');
  assert.strictEqual(csvFileName('', new Date(2026, 0, 2)), 'Table 2026-01-02.csv');
});
