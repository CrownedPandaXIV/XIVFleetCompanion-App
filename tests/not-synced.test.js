const test = require('node:test');
const assert = require('node:assert');
const { notSyncedCharacters } = require('../characters/not-synced');

const MIN = 60 * 1000;
const now = Date.UTC(2026, 9, 7, 12);

test('characters behind the newest of their own account by the setting or more', () => {
  const behind = notSyncedCharacters([
    { cid: 1, account_label: 'A', last_synced_at: new Date(now) },
    { cid: 2, account_label: 'A', last_synced_at: new Date(now - 29 * MIN) },
    { cid: 3, account_label: 'A', last_synced_at: new Date(now - 30 * MIN).toISOString() },
    { cid: 4, account_label: 'B', last_synced_at: new Date(now - 10 * 24 * 60 * MIN) },
    { cid: 5, account_label: null, last_synced_at: new Date(now - 60 * MIN) },
    { cid: 6, account_label: null, last_synced_at: null },
  ], 30);
  assert.deepStrictEqual([...behind.entries()], [['3', 30 * MIN]], 'a whole account that stopped (B) and one alone in its group are not behind');
});
