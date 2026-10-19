const test = require('node:test');
const assert = require('node:assert');
const { DAY, changesInWindow } = require('../subs/supply-runway');
const { characterIncome, shareClass } = require('../subs/income');

const now = Date.UTC(2026, 9, 20);
const at = (daysAgo) => now - daysAgo * DAY;
const prices = { 22500: 8000, 22504: 27000 };

test('changesInWindow counts rises and drops separately, inside the window only', () => {
  const points = [{ at: at(20), value: 0 }, { at: at(15), value: 50 }, { at: at(5), value: 10 }, { at: at(2), value: 30 }];
  assert.deepStrictEqual(changesInWindow(points, at(10), now), { rose: 20, fell: 40, spanDays: 10 });
});

test('salvage that came in, less repair kits used, against expected', () => {
  // 7 days: 10 + 5 pieces of 22500 (sold 12 in between, not counted) and 2 of 22504; 6 kits used.
  const salvage = new Map([
    ['22500', [{ at: at(9), value: 3 }, { at: at(6), value: 13 }, { at: at(4), value: 1 }, { at: at(1), value: 6 }]],
    ['22504', [{ at: at(8), value: 0 }, { at: at(3), value: 2 }]],
  ]);
  const kits = [{ at: at(10), value: 100 }, { at: at(5), value: 97 }, { at: at(2), value: 200 }, { at: at(1), value: 197 }];
  const r = characterIncome({ salvage, kits, prices, kitCost: 1000, expectedPerDay: 30000, windowStart: at(7), end: now });
  assert.strictEqual(r.enough, true);
  assert.strictEqual(r.spanDays, 7);
  assert.strictEqual(r.pieces, 17);
  assert.strictEqual(r.salvageGil, 15 * 8000 + 2 * 27000);
  assert.strictEqual(r.kitsUsed, 6, 'the restock to 200 is not use');
  assert.strictEqual(r.net, 174000 - 6000);
  assert.strictEqual(r.perDay, 24000);
  assert.strictEqual(r.expected, 210000);
  assert.strictEqual(r.differencePerDay, -6000);
  assert.strictEqual(r.share, 0.8);
  assert.strictEqual(shareClass(r.share), 'income-warn');
});

test('a window longer than the salvage history is cut to it, kits and expected included', () => {
  // Salvage recorded from 4 days ago only; a kit drop 6 days ago is before that and not counted.
  const salvage = new Map([['22500', [{ at: at(4), value: 0 }, { at: at(1), value: 4 }]]]);
  const kits = [{ at: at(8), value: 50 }, { at: at(6), value: 40 }, { at: at(2), value: 38 }];
  const r = characterIncome({ salvage, kits, prices, kitCost: 500, expectedPerDay: 10000, windowStart: at(14), end: now });
  assert.strictEqual(r.spanDays, 4);
  assert.strictEqual(r.kitsUsed, 2);
  assert.strictEqual(r.net, 32000 - 1000);
  assert.strictEqual(r.expected, 40000);
});

test('less than a day of salvage history is not enough', () => {
  const salvage = new Map([['22500', [{ at: now - DAY / 2, value: 0 }, { at: now, value: 9 }]]]);
  const r = characterIncome({ salvage, kits: [], prices, kitCost: 0, expectedPerDay: 5000, windowStart: at(7), end: now });
  assert.strictEqual(r.enough, false);
  assert.strictEqual(r.expectedPerDay, 5000, 'expected is still shown');
  const none = characterIncome({ salvage: new Map([['22500', []]]), kits: [], prices, kitCost: 0, expectedPerDay: null, windowStart: at(7), end: now });
  assert.strictEqual(none.enough, false);
});

test('no Fight Club match: no expected, no comparison', () => {
  const salvage = new Map([['22500', [{ at: at(3), value: 0 }, { at: at(1), value: 2 }]]]);
  const r = characterIncome({ salvage, kits: [], prices, kitCost: 0, expectedPerDay: null, windowStart: at(7), end: now });
  assert.strictEqual(r.expected, null);
  assert.strictEqual(r.share, null);
  assert.strictEqual(shareClass(r.share), '');
});

test('amber under 90% of expected, red under 75%', () => {
  assert.strictEqual(shareClass(0.95), '');
  assert.strictEqual(shareClass(0.9), '');
  assert.strictEqual(shareClass(0.89), 'income-warn');
  assert.strictEqual(shareClass(0.74), 'income-danger');
});

test('salvage taken out of the FC chest, or seen for the first time, is not income', () => {
  const { chestDrops } = require('../subs/income');
  // 22500: +10 from a voyage (day 5), +4 taken from the chest (day 3, the chest dropped 6 then),
  // +7 when a retainer was first stored (day 2, inventory_sources went 2 -> 3).
  const salvage = new Map([['22500', [{ at: at(8), value: 0 }, { at: at(5), value: 10 }, { at: at(3), value: 14 }, { at: at(2), value: 21 }]]]);
  const drops = chestDrops(new Map([['22500', [{ at: at(9), value: 20 }, { at: at(3), value: 14 }]]]));
  const sources = [{ at: at(9), value: 2 }, { at: at(2), value: 3 }];
  const r = characterIncome({ salvage, kits: [], prices, kitCost: 0, expectedPerDay: null, windowStart: at(7), end: now, drops, sources });
  assert.deepStrictEqual([r.pieces, r.fromChest, r.firstStored, r.salvageGil], [10, 4, 7, 80000]);
  // The chest's drop of 6 had 4 used; a second character in the same FC can match only the 2 left.
  const other = characterIncome({ salvage: new Map([['22500', [{ at: at(8), value: 0 }, { at: at(3), value: 5 }]]]), kits: [], prices, kitCost: 0,
    expectedPerDay: null, windowStart: at(7), end: now, drops });
  assert.deepStrictEqual([other.pieces, other.fromChest], [3, 2]);
});

test('repair kits come from bags and retainers when that history covers the window', () => {
  const { kitSeries } = require('../subs/income');
  const salvage = new Map([['22500', [{ at: at(8), value: 0 }, { at: at(1), value: 1 }]]]);
  // Bags: 100 -> 90 (10 moved to a retainer) -> 87; bags and retainers: 100 -> 100 -> 97.
  const kits = [{ at: at(8), value: 100 }, { at: at(4), value: 90 }, { at: at(2), value: 87 }];
  const kitsTotal = [{ at: at(8), value: 100 }, { at: at(4), value: 100 }, { at: at(2), value: 97 }];
  const r = characterIncome({ salvage, kits, kitsTotal, prices, kitCost: 1000, expectedPerDay: null, windowStart: at(7), end: now });
  assert.strictEqual(r.kitsUsed, 3, 'kits moved to a retainer are not used');
  assert.strictEqual(kitSeries(kits, [{ at: at(3), value: 97 }], at(7)), kits, 'a shorter total history falls back to the bags');
});
