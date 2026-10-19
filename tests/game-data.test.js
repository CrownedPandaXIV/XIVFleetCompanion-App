const test = require('node:test');
const assert = require('node:assert');
const g = require('../db/game-data');

test('normalizeKey ignores case and punctuation, and maps # to id', () => {
  assert.strictEqual(g.normalizeKey('#'), 'id');
  assert.strictEqual(g.normalizeKey('ItemResult'), 'itemresult');
  assert.strictEqual(g.normalizeKey('item_result'), 'itemresult');
  assert.strictEqual(g.normalizeKey('Ingredient[0]'), g.normalizeKey('ingredient0'));
  assert.strictEqual(g.normalizeKey('LandSet[3].MapRange'), g.normalizeKey('land_set3_map_range'));
});

test('newColumnName makes snake_case names', () => {
  assert.strictEqual(g.newColumnName('#'), 'id');
  assert.strictEqual(g.newColumnName('RetainerTaskParameter'), 'retainer_task_parameter');
  assert.strictEqual(g.newColumnName('Unknown0'), 'unknown0');
  assert.strictEqual(g.newColumnName('IsRandom'), 'is_random');
  assert.strictEqual(g.newColumnName('Ingredient[0]'), 'ingredient0');
  assert.strictEqual(g.newColumnName('LandSet[3].MapRange'), 'land_set3_map_range');
  assert.ok(g.newColumnName('X'.repeat(100)).length <= 63);
});

test('parseCsv reads headers, rows, quotes and a byte-order mark', () => {
  const { headers, rows } = g.parseCsv('﻿#,Name,Note\n1,"a, b",x\n2,c,"say ""hi"""\n');
  assert.deepStrictEqual(headers, ['#', 'Name', 'Note']);
  assert.deepStrictEqual(rows, [['1', 'a, b', 'x'], ['2', 'c', 'say "hi"']]);
});

const base = { table: 't', file: 'T', csvRowCount: 10, rowsBefore: 10 };

test('planTable matches existing columns by name and adds new ones', () => {
  const plan = g.planTable({ ...base, headers: ['#', 'ItemResult', 'Brand New'], dbColumns: ['id', 'item_result'] });
  assert.strictEqual(plan.status, 'ok');
  assert.deepStrictEqual(plan.matches.map((m) => m.column), ['id', 'item_result']);
  assert.deepStrictEqual(plan.added.map((a) => a.column), ['brand_new']);
});

test('planTable keeps a column that disappeared from the file', () => {
  const plan = g.planTable({ ...base, headers: ['#', 'A'], dbColumns: ['id', 'a', 'old_extra'] });
  assert.strictEqual(plan.status, 'ok');
  assert.deepStrictEqual(plan.kept, ['old_extra']);
});

test('planTable blocks a probable rename (one gone, one new)', () => {
  const plan = g.planTable({ ...base, headers: ['#', 'NewName'], dbColumns: ['id', 'old_name'] });
  assert.strictEqual(plan.status, 'blocked');
  assert.match(plan.reason, /renamed/);
});

test('planTable blocks a missing table, an empty file, a missing id and a big row drop', () => {
  assert.strictEqual(g.planTable({ ...base, headers: ['#'], dbColumns: [] }).status, 'blocked');
  assert.strictEqual(g.planTable({ ...base, headers: [], csvRowCount: 0, dbColumns: ['id'] }).status, 'blocked');
  assert.strictEqual(g.planTable({ ...base, headers: ['Name'], dbColumns: ['name'] }).status, 'blocked');
  const drop = g.planTable({ ...base, csvRowCount: 3, headers: ['#'], dbColumns: ['id'] });
  assert.strictEqual(drop.status, 'blocked');
  assert.match(drop.reason, /fewer rows/);
});

test('planTable blocks headers or columns that look alike', () => {
  assert.strictEqual(g.planTable({ ...base, headers: ['#', 'A_B', 'AB'], dbColumns: ['id'] }).status, 'blocked');
  assert.strictEqual(g.planTable({ ...base, headers: ['#'], dbColumns: ['id', 'a_b', 'ab'] }).status, 'blocked');
});

test('planTable treats a "_field" column as the file\'s reserved-word column', () => {
  const plan = g.planTable({ ...base, headers: ['#', 'Order'], dbColumns: ['id', 'order_field'] });
  assert.strictEqual(plan.status, 'ok');
  assert.deepStrictEqual(plan.added, []);
  assert.deepStrictEqual(plan.matches.map((m) => m.column), ['id', 'order_field']);
});

test('planTable renames a placeholder column the file has now named, at the same position', () => {
  const plan = g.planTable({ ...base, headers: ['#', 'BST', 'Name'], dbColumns: ['id', 'unknown0', 'name'] });
  assert.strictEqual(plan.status, 'ok');
  assert.deepStrictEqual(plan.renames.map((r) => [r.from, r.to]), [['unknown0', 'bst']]);
  assert.deepStrictEqual(plan.added, []);
  assert.deepStrictEqual(plan.kept, []);
});

test('planTable still blocks a rename of a real column, or of a placeholder at a different position', () => {
  assert.strictEqual(g.planTable({ ...base, headers: ['#', 'NewName'], dbColumns: ['id', 'old_name'] }).status, 'blocked');
  assert.strictEqual(g.planTable({ ...base, headers: ['#', 'Name', 'BST'], dbColumns: ['id', 'unknown0', 'name'] }).status, 'blocked');
});
