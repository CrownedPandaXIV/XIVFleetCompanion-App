// "New game data is available" (db/game-data-notice.js): what is asked of GitHub, and what the window shows.
const test = require('node:test');
const assert = require('node:assert');
const { fileChanges, noticeFrom, COMMITS_URL } = require('../db/game-data-notice');

// Stands in for GitHub: answers each request from `dates` ({ File: date }), and notes what was asked.
function fakeGitHub(dates) {
  const asked = [];
  const fetch = async (url) => {
    asked.push(url.replace(COMMITS_URL, ''));
    const since = /since=([^&]+)/.exec(url);
    const after = (d) => !since || new Date(d) >= new Date(decodeURIComponent(since[1]));
    const file = /path=csv\/en\/([^.&]+)\.csv/.exec(url);
    const list = file ? (dates[file[1]] ? [dates[file[1]]] : []) : Object.values(dates);
    return list.filter(after).map((date) => ({ commit: { committer: { date } } }));
  };
  return { fetch, asked };
}

test('nothing changed since the last update: one small request, nothing found', async () => {
  const gh = fakeGitHub({ Item: '2026-10-01T00:00:00Z', World: '2026-09-01T00:00:00Z' });
  assert.deepStrictEqual(await fileChanges({ since: '2026-10-01T00:00:00Z', files: ['Item', 'World'], fetch: gh.fetch }), {});
  assert.deepStrictEqual(gh.asked, ['?path=csv/en&per_page=1&since=2026-10-01T00%3A00%3A01.000Z'], 'only the folder is asked about, from just after the last update');
});

test('something changed: each file the app uses is asked about, and only the changed ones are listed', async () => {
  const gh = fakeGitHub({ Item: '2026-11-04T10:00:00Z', World: '2026-09-01T00:00:00Z' });
  assert.deepStrictEqual(await fileChanges({ since: '2026-10-01T00:00:00Z', files: ['Item', 'World'], fetch: gh.fetch }), { Item: '2026-11-04T10:00:00Z' });
  assert.strictEqual(gh.asked.length, 3);
  assert.ok(gh.asked[1].startsWith('?path=csv/en/Item.csv&per_page=1&since='));
});

test('with no record of the last update, every file is asked about', async () => {
  const gh = fakeGitHub({ Item: '2026-11-04T10:00:00Z' });
  assert.deepStrictEqual(await fileChanges({ since: null, files: ['Item', 'World'], fetch: gh.fetch }), { Item: '2026-11-04T10:00:00Z' });
  assert.deepStrictEqual(gh.asked, ['?path=csv/en/Item.csv&per_page=1', '?path=csv/en/World.csv&per_page=1']);
});

test('what the window shows: changed files and the latest change, until Later on that change', () => {
  const changes = { World: '2026-11-03T00:00:00Z', Item: '2026-11-04T10:00:00Z' };
  assert.deepStrictEqual(noticeFrom({ changes }), { available: true, files: ['Item', 'World'], newest: '2026-11-04T10:00:00.000Z' });
  assert.strictEqual(noticeFrom({ changes, dismissed: '2026-11-04T10:00:00.000Z' }).available, false, 'Later hides it');
  assert.strictEqual(noticeFrom({ changes, dismissed: '2026-11-03T00:00:00.000Z' }).available, true, 'something newer shows it again');
  assert.deepStrictEqual(noticeFrom({ changes: {} }), { available: false, files: [], newest: null });
});
