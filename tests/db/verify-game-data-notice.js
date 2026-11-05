// Checks "New game data is available" (db/game-data-notice.js) on a real Postgres: only one PC asks GitHub each
// day, a failed ask is tried again in an hour, and changes from before the game data was last brought up to date
// don't count. Set PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE for a scratch server, as its administrator: it
// makes and drops a database named game_data_notice_check.
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const assert = require('node:assert');
const { refresh, claimCheck, markUpToDate, upToDateAsOf, noticeFrom } = require('../../db/game-data-notice');
const { recordUpdate } = require('../../db/game-data');

let n = 0;
async function scenario(name, fn) {
  try { await fn(); console.log(`PASS ${++n}. ${name}`); } catch (e) { console.log(`FAIL ${++n}. ${name}\n   ${e.stack}`); process.exitCode = 1; }
}

// Stands in for GitHub: every file the app uses last changed at `date` (null: nothing changed). Counts requests.
function gitHub(date) {
  const gh = { asked: 0, down: false };
  gh.fetch = async (url) => {
    gh.asked++;
    if (gh.down) throw new Error('getaddrinfo ENOTFOUND api.github.com');
    const since = /since=([^&]+)/.exec(url);
    return date && (!since || new Date(date) >= new Date(decodeURIComponent(since[1]))) ? [{ commit: { committer: { date } } }] : [];
  };
  return gh;
}

const NAME = 'game_data_notice_check';
const hours = (h) => new Date(Date.parse('2026-11-05T12:00:00Z') + h * 3600 * 1000);
(async () => {
  const admin = new Client();
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${NAME}`);
  await admin.query(`CREATE DATABASE ${NAME}`);
  const client = new Client({ host: process.env.PGHOST, port: process.env.PGPORT, user: process.env.PGUSER, password: process.env.PGPASSWORD, database: NAME });
  await client.connect();
  try {
    await client.query(fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'schema.sql'), 'utf8'));
    await recordUpdate(client, { sha: 'abc', date: '2026-10-01T00:00:00Z' }, []);

    await scenario('nothing new since the last update: nothing to show, after one request', async () => {
      const gh = gitHub('2026-09-20T00:00:00Z');
      const found = await refresh(client, { fetch: gh.fetch, now: hours(0) });
      assert.deepStrictEqual(found.changes, {});
      assert.strictEqual(gh.asked, 1);
    });

    await scenario('a second PC the same day does not ask GitHub again; the next day one does', async () => {
      const gh = gitHub('2026-11-04T10:00:00Z');
      await refresh(client, { fetch: gh.fetch, now: hours(5) });
      assert.strictEqual(gh.asked, 0, 'asked within the day');
      const found = await refresh(client, { fetch: gh.fetch, now: hours(25) });
      assert.ok(gh.asked > 1, 'asked about the folder, then each file');
      assert.strictEqual(Object.keys(found.changes).length, 22, 'every file the app uses changed');
      assert.strictEqual(noticeFrom({ changes: found.changes }).newest, '2026-11-04T10:00:00.000Z');
      const again = await refresh(client, { fetch: gitHub(null).fetch, now: hours(26) });
      assert.deepStrictEqual(again.changes, found.changes, 'another PC reads what was found');
    });

    await scenario('only one of two PCs asking at the same moment gets the turn', async () => {
      const turns = await Promise.all([claimCheck(client, hours(60)), claimCheck(client, hours(60))]);
      assert.deepStrictEqual(turns.filter(Boolean).length, 1);
    });

    await scenario("GitHub can't be reached: tried again in an hour, and what was found before still stands", async () => {
      const gh = gitHub('2026-11-04T10:00:00Z');
      gh.down = true;
      const found = await refresh(client, { fetch: gh.fetch, now: hours(90) });
      assert.ok(found.error && Object.keys(found.changes).length === 22);
      gh.down = false;
      gh.asked = 0;
      await refresh(client, { fetch: gh.fetch, now: hours(90.5) });
      assert.strictEqual(gh.asked, 0, 'not within the hour');
      await refresh(client, { fetch: gh.fetch, now: hours(91.1) });
      assert.ok(gh.asked > 0, 'asked again after an hour');
    });

    await scenario('once the game data is updated (or Settings finds nothing to change), older changes no longer count', async () => {
      await markUpToDate(client, '2026-11-04T10:00:00Z');
      assert.strictEqual(await upToDateAsOf(client), '2026-11-04T10:00:00.000Z');
      const found = await refresh(client, { fetch: gitHub(null).fetch, now: hours(91.2) });
      assert.deepStrictEqual(found.changes, {});
      await markUpToDate(client, '2026-10-15T00:00:00Z');
      assert.strictEqual(await upToDateAsOf(client), '2026-11-04T10:00:00.000Z', 'an older check never moves it back');
      await recordUpdate(client, { sha: 'def', date: '2026-11-06T00:00:00Z' }, []);
      assert.strictEqual(await upToDateAsOf(client), '2026-11-06T00:00:00.000Z', 'an update moves it on');
    });

    await scenario('a database whose game data was never updated from the app: every changed file counts', async () => {
      await client.query('DELETE FROM companion_game_data_log; DELETE FROM companion_game_data_check');
      assert.strictEqual(await upToDateAsOf(client), null);
      const found = await refresh(client, { fetch: gitHub('2026-01-01T00:00:00Z').fetch, now: hours(200) });
      assert.strictEqual(Object.keys(found.changes).length, 22);
    });
  } finally {
    await client.end();
    await admin.query(`DROP DATABASE IF EXISTS ${NAME}`);
    await admin.end();
  }
})();
