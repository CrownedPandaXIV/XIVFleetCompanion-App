const test = require('node:test');
const assert = require('node:assert');
const { isConnectionError, describeError, createConnectionTracker } = require('../db/connection-status');

const config = { host: '100.64.184.100', port: 5432, database: 'fleet_warehouse' };

test('network failures count as "cannot reach the database"', () => {
  for (const code of ['ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EHOSTUNREACH']) {
    assert.ok(isConnectionError(Object.assign(new Error(`connect ${code}`), { code })), code);
  }
  assert.ok(isConnectionError(new Error('Connection terminated due to connection timeout')));
  assert.ok(isConnectionError(new Error('Connection terminated unexpectedly')));
  const both = Object.assign(new Error(''), { errors: [Object.assign(new Error('x'), { code: 'ETIMEDOUT' })] });
  assert.ok(isConnectionError(both), 'one failure per address (AggregateError)');
});

test('database errors are not connection errors', () => {
  assert.ok(!isConnectionError(Object.assign(new Error('relation "x" does not exist'), { code: '42P01' })));
  assert.ok(!isConnectionError(Object.assign(new Error('password authentication failed'), { code: '28P01' })));
  assert.ok(!isConnectionError(null));
});

test('messages are in plain language', () => {
  const timeout = Object.assign(new Error('connect ETIMEDOUT 100.64.184.100:5432'), { code: 'ETIMEDOUT' });
  assert.match(describeError(timeout, config), /^Can't reach the database at 100\.64\.184\.100:5432\. .*Tailscale/);
  assert.match(describeError(Object.assign(new Error('x'), { code: '28P01' }), config), /username or password/);
  assert.match(describeError(Object.assign(new Error('x'), { code: '3D000' }), config), /"fleet_warehouse" does not exist/);
  assert.strictEqual(describeError(Object.assign(new Error('relation "x" does not exist'), { code: '42P01' }), config), 'relation "x" does not exist');
});

function tracker(probeResults) {
  const notified = [];
  const timers = [];
  let clock = 1000;
  const t = createConnectionTracker({
    reconnectMs: 30000,
    now: () => clock,
    notify: (status) => notified.push(status),
    probe: async () => {
      const next = probeResults.shift();
      if (next instanceof Error) throw next;
    },
    setTimer: (fn, ms) => { timers.push({ fn, ms, cleared: false }); return timers.length; },
    clearTimer: (id) => { timers[id - 1].cleared = true; },
  });
  return { t, notified, timers, tick: (ms) => { clock += ms; } };
}

test('going offline tells the window once and starts the 30-second check', () => {
  const { t, notified, timers } = tracker([]);
  t.markOnline();
  assert.strictEqual(notified.length, 0, 'staying online is not news');
  t.markOffline('Cannot reach it');
  t.markOffline('Cannot reach it');
  assert.strictEqual(notified.length, 1);
  assert.deepStrictEqual(
    { online: notified[0].online, offlineSince: notified[0].offlineSince, message: notified[0].message, retryEveryMs: notified[0].retryEveryMs },
    { online: false, offlineSince: 1000, message: 'Cannot reach it', retryEveryMs: 30000 });
  assert.strictEqual(notified[0].lastOkAt, 1000, 'remembers when data last loaded');
  assert.strictEqual(timers.length, 1);
  assert.strictEqual(timers[0].ms, 30000);
});

test('a failed check keeps it offline; a passing check brings it back and stops checking', async () => {
  const failure = Object.assign(new Error('still down'), { friendlyMessage: 'Still cannot reach it' });
  const { t, notified, timers, tick } = tracker([failure, undefined]);
  t.markOffline('Cannot reach it');
  tick(30000);
  await timers[0].fn();
  assert.strictEqual(t.status().online, false);
  assert.strictEqual(t.status().message, 'Still cannot reach it');
  assert.strictEqual(notified.length, 1);
  tick(30000);
  await timers[0].fn();
  assert.strictEqual(t.status().online, true);
  assert.strictEqual(notified.length, 2);
  assert.strictEqual(notified[1].online, true);
  assert.strictEqual(timers[0].cleared, true);
  // A later outage starts a new check.
  t.markOffline('Down again');
  assert.strictEqual(timers.length, 2);
});
