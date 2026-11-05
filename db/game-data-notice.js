// "New game data is available": once a day the app asks GitHub whether any of the game data files it uses
// (db/game-data.js TABLES) have changed since the game data was last updated, so people hear about it
// without going into Settings. Only the dates the files last changed are asked for (a few kilobytes), never
// the files themselves; nothing is changed until someone clicks Update now.
//
// The answer is kept in the database (companion_game_data_check, database update 12), so with the app open on
// several PCs only one of them asks each day. Kept free of Electron so it can be tested directly against a
// database (tests/db/verify-game-data-notice.js) and without one (tests/game-data-notice.test.js).

const { TABLES, lastUpdate } = require('./game-data');

const COMMITS_URL = 'https://api.github.com/repos/xivapi/ffxiv-datamining/commits';
const CSV_PATH = 'csv/en';
const CHECK_EVERY_HOURS = 24;
const RETRY_AFTER_HOURS = 1; // after GitHub couldn't be reached

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'fleet-companion', Accept: 'application/vnd.github+json' } });
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  return response.json();
}

const commitDate = (commit) => commit && commit.commit && commit.commit.committer ? commit.commit.committer.date : null;

// When each game data file last changed, after `since` (an ISO date, or null to ask for every file):
// { File: isoDate } for the files that changed. One request when nothing in the folder has changed since,
// otherwise one more per file.
async function fileChanges({ since, files = TABLES.map((t) => t.file), fetch = fetchJson }) {
  const after = since ? `&since=${encodeURIComponent(new Date(new Date(since).getTime() + 1000).toISOString())}` : '';
  if (since) {
    const any = await fetch(`${COMMITS_URL}?path=${CSV_PATH}&per_page=1${after}`);
    if (!Array.isArray(any) || any.length === 0) return {};
  }
  const changed = {};
  for (const file of files) {
    const list = await fetch(`${COMMITS_URL}?path=${CSV_PATH}/${encodeURIComponent(file)}.csv&per_page=1${after}`);
    const date = Array.isArray(list) && list.length ? commitDate(list[0]) : null;
    if (date) changed[file] = date;
  }
  return changed;
}

const latest = (...dates) => dates.filter(Boolean).map((d) => new Date(d)).sort((a, b) => b - a)[0] || null;

// The game data is known to be up to date as of this date (or null when that's unknown, such as a database
// whose game tables were loaded by hand long ago): the source date of the last update, or of the last check
// in Settings that found nothing to change.
async function upToDateAsOf(client) {
  const last = await lastUpdate(client);
  const lastDate = last ? (last.source && last.source.date) || last.applied_at : null;
  let confirmed = null;
  try {
    confirmed = (await client.query('SELECT confirmed_at FROM companion_game_data_check WHERE id = 1')).rows.map((r) => r.confirmed_at)[0] || null;
  } catch {
    // no table yet
  }
  const date = latest(lastDate, confirmed);
  return date ? date.toISOString() : null;
}

// What the window shows, from what was found: { available, files, newest } (newest: the latest change, ISO).
// dismissed: the `newest` the person clicked Later on, on this PC.
function noticeFrom({ changes, dismissed }) {
  const files = Object.keys(changes || {}).sort();
  const newest = latest(...files.map((f) => changes[f]));
  if (!files.length) return { available: false, files: [], newest: null };
  const hidden = dismissed && newest && new Date(dismissed) >= newest;
  return { available: !hidden, files, newest: newest.toISOString() };
}

// This PC takes its turn to ask GitHub when nobody has in the last day: true when it should ask now.
async function claimCheck(client, now = new Date()) {
  await client.query(`INSERT INTO companion_game_data_check (id, checked_at) VALUES (1, '-infinity') ON CONFLICT (id) DO NOTHING`);
  const { rowCount } = await client.query(
    `UPDATE companion_game_data_check SET checked_at = $1::timestamptz WHERE id = 1 AND checked_at <= $1::timestamptz - make_interval(hours => $2)`,
    [now, CHECK_EVERY_HOURS]);
  return rowCount === 1;
}

// Asks GitHub when it's this PC's turn, then returns what's known: { changes, checkedAt, error? }.
async function refresh(client, { fetch = fetchJson, now = new Date() } = {}) {
  let error = null;
  if (await claimCheck(client, now)) {
    try {
      const since = await upToDateAsOf(client);
      const changes = await fileChanges({ since, fetch });
      await client.query('UPDATE companion_game_data_check SET changes = $1, checked_since = $2 WHERE id = 1', [JSON.stringify(changes), since]);
    } catch (err) {
      // Asked again in an hour instead of tomorrow; what was found before still stands.
      error = err.message;
      await client.query(`UPDATE companion_game_data_check SET checked_at = $1::timestamptz - make_interval(hours => $2) WHERE id = 1`,
        [now, CHECK_EVERY_HOURS - RETRY_AFTER_HOURS]);
    }
  }
  const { rows: [row] } = await client.query('SELECT checked_at, changes, checked_since FROM companion_game_data_check WHERE id = 1');
  // Changes found before the game data was last brought up to date no longer count.
  const asOf = await upToDateAsOf(client);
  const changes = {};
  for (const [file, date] of Object.entries((row && row.changes) || {})) {
    if (!asOf || new Date(date) > new Date(asOf)) changes[file] = date;
  }
  return { changes, checkedAt: row && row.checked_at, ...(error ? { error } : {}) };
}

// A check in Settings found every table already matching the files (as of the source date `asOf`): the
// game data counts as up to date from then.
async function markUpToDate(client, asOf) {
  if (!asOf) return;
  await client.query(
    `INSERT INTO companion_game_data_check (id, checked_at, confirmed_at) VALUES (1, '-infinity', $1)
     ON CONFLICT (id) DO UPDATE SET confirmed_at = GREATEST(companion_game_data_check.confirmed_at, EXCLUDED.confirmed_at)`, [asOf]);
}

module.exports = { COMMITS_URL, CHECK_EVERY_HOURS, fileChanges, upToDateAsOf, noticeFrom, claimCheck, refresh, markUpToDate };
