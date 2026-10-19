const test = require('node:test');
const assert = require('node:assert');
const { gilByAccount, listingAges } = require('../characters/market');

test('gil per account: characters and their retainers; a retainer of an untracked character is left out', () => {
  const g = gilByAccount(
    [{ cid: '1', account_label: 'A', gil: 1000 }, { cid: '2', account_label: 'A', gil: 500 }, { cid: '3', account_label: null, gil: 7 }],
    [{ owner_cid: '1', gil: 200 }, { owner_cid: '3', gil: 3 }, { owner_cid: '99', gil: 1e9 }]);
  assert.deepStrictEqual(g.accounts.map((a) => [a.label, a.characters, a.characterGil, a.retainers, a.retainerGil, a.total]),
    [['A', 2, 1500, 1, 200, 1700], ['Ungrouped', 1, 7, 1, 3, 10]]);
  assert.deepStrictEqual([g.fleet.characters, g.fleet.retainers, g.fleet.total], [3, 2, 1710]);
});

test('listings up for at least N days, oldest first, with their value', () => {
  const now = Date.parse('2026-10-07T12:00:00Z');
  const ago = (days) => new Date(now - days * 86400000).toISOString();
  const { stale, totals } = listingAges([
    { item_id: 1, quantity: 10, unit_price: 100, first_seen_at: ago(2) },
    { item_id: 2, quantity: 1, unit_price: 5000, first_seen_at: ago(9) },
    { item_id: 3, quantity: 2, unit_price: 50, first_seen_at: ago(30) },
  ], 7, now);
  assert.deepStrictEqual(stale.map((l) => [l.item_id, Math.round(l.ageDays), l.value]), [[3, 30, 100], [2, 9, 5000]]);
  assert.deepStrictEqual(totals, { listings: 3, value: 1000 + 5000 + 100, stale: 2, staleValue: 5100 });
});
