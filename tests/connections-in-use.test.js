// db/connections-in-use.js: counting the database's connection slots by whose they are and which PC they come from.
const test = require('node:test');
const assert = require('node:assert');
const { summarize, kindOf, PLUGIN_NAME } = require('../db/connections-in-use');
const { APP_NAME } = require('../db/connection-guard');

const limits = (extra = {}) => ({ max: 100, superuser: 3, reserved: 0, me: '100.64.0.2', ...extra });

test('connections are counted as the app, the plugins or other, the check itself counted as the app', () => {
  const c = summarize([
    { name: PLUGIN_NAME, addr: '100.64.0.2', mine: true },
    { name: PLUGIN_NAME, addr: '100.64.0.7', mine: true },
    { name: 'pgAdmin 4 - DB:fleet', addr: '100.64.0.2', mine: true },
  ], limits());
  assert.deepStrictEqual([c.app, c.plugins, c.other, c.inUse, c.limit], [1, 2, 1, 4, 97]);
  assert.strictEqual(c.warn, false);
  assert.strictEqual(kindOf(APP_NAME), 'app');
  assert.strictEqual(kindOf(''), 'other');
});

test('by PC: this PC first, then the others by how many they hold', () => {
  const c = summarize([
    { name: PLUGIN_NAME, addr: '100.64.0.7', mine: true },
    { name: PLUGIN_NAME, addr: '100.64.0.9', mine: true },
    { name: PLUGIN_NAME, addr: '100.64.0.9', mine: true },
    { name: APP_NAME, addr: '100.64.0.9', mine: true },
    { name: PLUGIN_NAME, addr: '100.64.0.2', mine: true },
  ], limits());
  assert.deepStrictEqual(c.pcs.map((p) => [p.label, p.app, p.plugins, p.total]),
    [['This PC', 1, 1, 2], ['100.64.0.9', 1, 2, 3], ['100.64.0.7', 0, 1, 1]]);
});

test("connections from the database's own PC (no address, or 127.0.0.1) are named so", () => {
  const remote = summarize([{ name: PLUGIN_NAME, addr: null, mine: true }, { name: PLUGIN_NAME, addr: '127.0.0.1', mine: true }], limits());
  assert.deepStrictEqual(remote.pcs.map((p) => [p.label, p.total]), [['This PC', 1], ["The database's PC", 2]]);
  // The app on the database's PC itself: its own connections and the database PC's are the same.
  const local = summarize([{ name: PLUGIN_NAME, addr: '::1', mine: true }], limits({ me: '127.0.0.1' }));
  assert.deepStrictEqual(local.pcs.map((p) => [p.label, p.app, p.plugins]), [["This PC (the database's PC)", 1, 1]]);
});

test("another login's connections are counted, without a PC (the database doesn't show it)", () => {
  const c = summarize([{ name: 'pgAdmin 4', addr: null, mine: false }], limits());
  assert.strictEqual(c.other, 1);
  assert.deepStrictEqual(c.pcs.map((p) => p.key), ['this', 'hidden']);
});

test('a warning from 80% of the slots an ordinary login may use', () => {
  const rows = Array.from({ length: 76 }, () => ({ name: PLUGIN_NAME, addr: '100.64.0.7', mine: true }));
  const c = summarize(rows, limits()); // 77 of 97
  assert.strictEqual(c.inUse, 77);
  assert.strictEqual(c.warn, false);
  assert.strictEqual(summarize([...rows, rows[0]], limits()).warn, true); // 78 of 97
  assert.strictEqual(summarize([], limits({ reserved: 5 })).limit, 92); // PostgreSQL 16's reserved_connections too
});
