// The Roster's supply colours (characters/roster-warnings.js): the same rule as the plugin's (MainWindow.Lists.cs
// SupplyColor): red under half the warning, amber under it, green at or above it.
const test = require('node:test');
const assert = require('node:assert');
const { rosterWarnings, supplyTone } = require('../characters/roster-warnings');

test('supplyTone: red under half the warning, amber under it, green at or above it', () => {
  assert.strictEqual(supplyTone(49, 100, true), 'danger');
  assert.strictEqual(supplyTone(50, 100, true), 'warn');
  assert.strictEqual(supplyTone(99, 100, true), 'warn');
  assert.strictEqual(supplyTone(100, 100, true), 'good');
});

test('supplyTone: green with the warning off; no colour when it does not count or is unknown', () => {
  assert.strictEqual(supplyTone(0, 0, true), 'good');
  assert.strictEqual(supplyTone(10, 100, false), null);
  assert.strictEqual(supplyTone(null, 100, true), null);
});

test('rosterWarnings: tones leave out characters with no sub built or no longer synced', () => {
  const rows = [
    { cid: '1', ceruleum: 40, repair_kits: 8, subs_built: 2 },
    { cid: '2', ceruleum: 40, repair_kits: 8, subs_built: 0 },
    { cid: '3', ceruleum: 40, repair_kits: 8, subs_built: 2 },
  ];
  const out = rosterWarnings(rows, new Map([['3', 3600000]]), { ceruleum: 100, repairKits: 10 });
  assert.deepStrictEqual(out.map((r) => [r.ceruleum_tone, r.repair_tone]), [['danger', 'warn'], [null, null], [null, null]]);
});
