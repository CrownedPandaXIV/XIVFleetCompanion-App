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

test('characters with no account label count with the others of the PC they last logged in on', () => {
  const now = Date.UTC(2026, 10, 21, 12);
  const at = (minutesAgo) => new Date(now - minutesAgo * 60000).toISOString();
  const characters = [
    { cid: '1', account_label: '', last_synced_at: at(1) },     // PC A, syncing
    { cid: '2', account_label: '', last_synced_at: at(240) },   // PC B, its game closed 4 hours ago
    { cid: '3', account_label: '', last_synced_at: at(245) },   // PC B too
    { cid: '4', account_label: '', last_synced_at: at(90) },    // PC A, unticked there
  ];
  const pcs = new Map([['1', 'PC-A'], ['2', 'PC-B'], ['3', 'PC-B'], ['4', 'PC-A']]);
  assert.deepStrictEqual([...notSyncedCharacters(characters, 30, pcs).keys()].sort(), ['4'], "PC B's game being closed isn't its characters falling behind");
  assert.deepStrictEqual([...notSyncedCharacters(characters, 30).keys()].sort(), ['2', '3', '4'], 'without the logins, all unlabelled count as one account');
});
