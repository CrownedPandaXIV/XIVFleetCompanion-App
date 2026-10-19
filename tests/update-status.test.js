// The update check as Settings shows it and the log records it (update-status.js): each of electron-updater's
// events, a downloaded version that stays ready, plain words for errors, and a log that only notes changes.
const test = require('node:test');
const assert = require('node:assert');
const { nextStatus, statusText, logLine, plainError } = require('../update-status');

const NOW = new Date(2026, 9, 19, 9, 5).getTime();
const run = (events, start = { state: 'idle' }) => events.reduce((s, [e, d]) => nextStatus(s, e, d, NOW), start);

test('a check that finds a new version: looking, downloading with its progress, then ready', () => {
  let s = run([['checking-for-update']]);
  assert.strictEqual(statusText(s), 'Looking for a new version...');
  s = run([['update-available', { version: '0.36.1' }], ['download-progress', { percent: 45.7 }]], s);
  assert.deepStrictEqual(s, { state: 'downloading', version: '0.36.1', percent: 45 });
  assert.strictEqual(statusText(s), 'Downloading version 0.36.1 (45%)...');
  s = run([['update-downloaded', { version: '0.36.1' }]], s);
  assert.strictEqual(statusText(s), "Version 0.36.1 is downloaded. It's installed when you click Restart to update, or the next time you close the app.");
});

test('a downloaded version stays ready, whatever later checks say', () => {
  const ready = { state: 'ready', version: '0.36.1' };
  assert.deepStrictEqual(run([['checking-for-update'], ['update-not-available'], ['error', new Error('offline')]], ready), ready);
  assert.deepStrictEqual(run([['update-downloaded', { version: '0.36.2' }]], ready), { state: 'ready', version: '0.36.2' });
});

test('nothing newer: up to date, with when it last looked', () => {
  const s = run([['checking-for-update'], ['update-not-available', { version: '0.36.0' }]]);
  assert.deepStrictEqual(s, { state: 'up-to-date', checkedAt: NOW });
  assert.strictEqual(statusText(s, { now: NOW + 10 * 1000 }), 'Up to date. Last looked just now.');
  assert.match(statusText(s, { now: NOW + 3 * 60 * 1000 }), /^Up to date\. Last looked at 9:05/);
});

test('errors are said in plain words: no internet is not a failure of the app', () => {
  assert.strictEqual(plainError(new Error('net::ERR_INTERNET_DISCONNECTED')), "Couldn't reach GitHub to look for updates. Check this PC is online; it tries again later.");
  assert.strictEqual(plainError(new Error('getaddrinfo ENOTFOUND github.com')), "Couldn't reach GitHub to look for updates. Check this PC is online; it tries again later.");
  assert.strictEqual(plainError(new Error('HttpError: 404 \n"method: GET url: https://github.com/..."')), 'Looking for updates failed: HttpError: 404');
  assert.strictEqual(statusText(run([['error', new Error('ETIMEDOUT')]])), "Couldn't reach GitHub to look for updates. Check this PC is online; it tries again later.");
});

test('a copy run from source says so instead of "not looked yet"', () => {
  assert.strictEqual(statusText({ state: 'idle', source: true }), "This copy runs from source, so it doesn't update itself (use git pull).");
  assert.strictEqual(statusText({ state: 'idle' }), 'Not looked yet.');
});

test('the log notes what changed, not every hourly check', () => {
  const upToDate = { state: 'up-to-date', checkedAt: NOW };
  assert.strictEqual(logLine({ state: 'idle' }, upToDate), 'Update: up to date.');
  assert.strictEqual(logLine(upToDate, { state: 'up-to-date', checkedAt: NOW + 3600e3 }), null, 'the next hour finds nothing new: no line');
  assert.strictEqual(logLine(upToDate, { state: 'checking' }), null);
  assert.strictEqual(logLine(upToDate, { state: 'downloading', version: '0.36.1', percent: 0 }), 'Update: found version 0.36.1, downloading it.');
  assert.strictEqual(logLine({ state: 'downloading', version: '0.36.1', percent: 0 }, { state: 'downloading', version: '0.36.1', percent: 50 }), null, 'progress is not logged');
  assert.strictEqual(logLine({ state: 'downloading', version: '0.36.1' }, { state: 'ready', version: '0.36.1' }), 'Update: version 0.36.1 is downloaded and ready to install.');
  const offline = run([['error', new Error('ENOTFOUND')]]);
  assert.strictEqual(logLine(upToDate, offline), "Update: Couldn't reach GitHub to look for updates. Check this PC is online; it tries again later.");
  assert.strictEqual(logLine(offline, { ...offline, checkedAt: NOW + 1 }), null, 'the same error an hour later: no new line');
});
