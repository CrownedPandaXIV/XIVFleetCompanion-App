const test = require('node:test');
const assert = require('node:assert');
const { retainerSummary } = require('../characters/retainer-summary');

test('retainers right now: without a venture, ready to collect, out, back within an hour', () => {
  const now = Date.parse('2026-10-07T12:00:00Z');
  const s = (min) => Math.floor((now + min * 60000) / 1000);
  const r = retainerSummary([
    { owner_name: 'Bex', retainer_name: 'Zed', sort_index: 2, has_venture: false },
    { owner_name: 'Aki', retainer_name: 'Mo', sort_index: 1, has_venture: false },
    { owner_name: 'Aki', retainer_name: 'Ann', sort_index: 1, has_venture: true, venture_ends_at: s(-5) },
    { owner_name: 'Aki', retainer_name: 'Bo', sort_index: 1, has_venture: true, venture_ends_at: s(30) },
    { owner_name: 'Aki', retainer_name: 'Cy', sort_index: 1, has_venture: true, venture_ends_at: s(600) },
  ], now);
  assert.deepStrictEqual([r.total, r.ready, r.away, r.soon], [5, 1, 2, 1]);
  assert.deepStrictEqual(r.idle.map((x) => x.retainer_name), ['Mo', 'Zed'], 'idle retainers in roster order');
});
