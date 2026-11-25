// The app's connections kept from piling up (db/connection-guard.js): named, closed by the database when left idle
// (once it is known to have idle_session_timeout), and written to the log when one stays open too long.
const test = require('node:test');
const assert = require('node:assert');
const guard = require('../db/connection-guard');

test('every connection is named; the idle limit is given at connect once the database is known to have it', async () => {
  guard.resetForTests();
  assert.deepStrictEqual(guard.clientConfig({ host: 'h' }, { idleLimit: true }), { application_name: 'XIV Fleet Companion app', host: 'h' });
  const asked = [];
  await guard.afterConnect({ query: async (q) => { asked.push(q); } }, { idleLimit: true });
  assert.deepStrictEqual(asked, [`SET idle_session_timeout = ${guard.IDLE_LIMIT_MS}`]);
  assert.strictEqual(guard.clientConfig({ host: 'h' }, { idleLimit: true }).options, `-c idle_session_timeout=${guard.IDLE_LIMIT_MS}`);
  // Not for connections that may wait on purpose (a move, a backup).
  assert.strictEqual(guard.clientConfig({ host: 'h' }).options, undefined);
});

test('a database without idle_session_timeout (PostgreSQL 13 and older) still connects, without it', async () => {
  guard.resetForTests();
  await guard.afterConnect({ query: async () => { throw new Error('unrecognized configuration parameter'); } }, { idleLimit: true });
  assert.strictEqual(guard.clientConfig({}, { idleLimit: true }).options, undefined);
});

test('a connection still open after the warning time is logged with its caller and last question', () => {
  const warned = [];
  let fire = null;
  let t = 1000;
  const client = { query: (q) => q, end: () => 'ended' };
  guard.watch(client, { stack: 'Error\n    at x (C:\\app\\resources\\app.asar\\ipc\\details.js:333:5)\n    at y (/app/db/index.js:260:1)',
    log: { warn: (m) => warned.push(m) }, setTimer: (f) => { fire = f; return 1; }, clearTimer: () => { fire = null; }, now: () => t });
  client.query('SELECT  id,\n rank FROM x');
  fire();
  assert.match(warned[0], /still open after \d+ seconds\. Opened by: ipc\/details\.js:333\. Last question: SELECT id, rank FROM x/);
  t += 600000;
  assert.strictEqual(client.end(), 'ended');
  assert.match(warned[1], /ipc\/details\.js:333\) closed after 600 seconds/);
});

test('a connection closed in time is not logged', () => {
  const warned = [];
  let cleared = false;
  const client = { query: () => {}, end: () => {} };
  guard.watch(client, { stack: '', log: { warn: (m) => warned.push(m) }, setTimer: () => 1, clearTimer: () => { cleared = true; } });
  client.end();
  assert.ok(cleared);
  assert.deepStrictEqual(warned, []);
});
