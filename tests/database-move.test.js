const test = require('node:test');
const assert = require('node:assert');
const { movedConnection, followMove, readMoveNote } = require('../db/database-move');
const { KEPT, postgresRemovable, connectProblem } = require('../setup/leftovers');
const { addressChoices, checkPcs, toolMajor, serverMajor, keptName, countDifferences, stepsFor, MOVE_PLUGIN_VERSION } = require('../setup/move-database');

const config = { host: '100.64.1.2', port: 5432, database: 'fleet', user: 'fleet_app', password: 'secret' };

test('a moved note sends the saved connection to the new address, keeping everything else', () => {
  assert.deepStrictEqual(movedConnection({ state: 'moved', host: ' 100.64.1.9 ', port: 5433 }, config), { ...config, host: '100.64.1.9', port: 5433 });
  assert.strictEqual(movedConnection({ state: 'pausing', host: '100.64.1.9', port: 5432 }, config), null);
  assert.strictEqual(movedConnection({ state: 'arrived', host: '100.64.1.9', port: 5432 }, config), null);
  assert.strictEqual(movedConnection({ state: 'moved', host: '', port: 5432 }, config), null);
  assert.strictEqual(movedConnection(null, config), null);
});

test('following a move: switch when the new address answers, say so when it does not', async () => {
  const client = (rows) => ({ query: async () => ({ rows }) });
  const moved = client([{ state: 'moved', host: '100.64.1.9', port: 5432 }]);
  assert.deepStrictEqual(await followMove(moved, config, { tryConnect: async () => {} }), { to: '100.64.1.9:5432', config: { ...config, host: '100.64.1.9' } });
  assert.deepStrictEqual(await followMove(moved, config, { tryConnect: async () => { throw new Error('timed out'); } }), { to: '100.64.1.9:5432', error: 'timed out' });
  assert.strictEqual(await followMove(client([]), config, { tryConnect: async () => { throw new Error('not called'); } }), null);
  const missing = { query: async () => { const e = new Error('relation does not exist'); e.code = '42P01'; throw e; } };
  assert.strictEqual(await readMoveNote(missing), null, 'a database without update 10 has no note');
});

test('the address other PCs use: the same kind as the old database\'s first', () => {
  const addresses = { tailscale: ['100.64.0.5'], home: ['192.168.1.20'] };
  assert.deepStrictEqual(addressChoices('100.64.1.2', addresses).map((c) => c.address), ['100.64.0.5', '192.168.1.20']);
  assert.deepStrictEqual(addressChoices('192.168.1.30', addresses).map((c) => c.via), ['home network', 'Tailscale']);
  assert.deepStrictEqual(addressChoices('192.168.1.30', { tailscale: ['100.64.0.5'], home: [] }).map((c) => c.address), ['100.64.0.5']);
});

test('every PC that syncs needs a plugin that follows the move, logging in as the app does', () => {
  const now = new Date('2026-10-19T12:00:00Z');
  const recent = '2026-10-19T11:00:00Z';
  const pcs = [
    { pc_name: 'DESKTOP-1', account_label: 'Account 1', plugin_version: MOVE_PLUGIN_VERSION, last_sync_at: recent, db_user: 'fleet_app' },
    { pc_name: 'LAPTOP', account_label: '', plugin_version: '0.13.6', last_sync_at: recent, db_user: null },
    { pc_name: 'DESKTOP-3', account_label: 'Account 3', plugin_version: '0.14.1', last_sync_at: recent, db_user: null },
    { pc_name: 'DESKTOP-4', account_label: 'Account 4', plugin_version: '0.15.0', last_sync_at: recent, db_user: 'someone_else' },
    { pc_name: 'RETIRED', account_label: 'Old', plugin_version: '0.9.0', last_sync_at: '2026-08-01T00:00:00Z', db_user: null },
  ];
  const { blocking, notes } = checkPcs(pcs, 'fleet_app', now);
  assert.strictEqual(blocking.length, 3);
  assert.match(blocking[0], /^LAPTOP runs plugin 0\.13\.6, which can't follow a move\. Update it to 0\.14\.0 or newer/);
  assert.match(blocking[1], /^DESKTOP-3 \(Account 3\) hasn't synced since its plugin was updated/);
  assert.match(blocking[2], /^DESKTOP-4 \(Account 4\)'s plugin logs in as "someone_else", but the move only brings the app's login "fleet_app"/);
  assert.strictEqual(notes.length, 1);
  assert.match(notes[0], /^RETIRED \(Old\) hasn't synced since .*It follows the move when it next syncs/);
});

test('versions, names and counts', () => {
  assert.strictEqual(toolMajor('pg_dump (PostgreSQL) 18.6'), 18);
  assert.strictEqual(toolMajor('pg_dump (PostgreSQL) 16.4 (Ubuntu 16.4-1.pgdg24.04+1)'), 16);
  assert.strictEqual(serverMajor(170004), 17);
  assert.strictEqual(keptName('fleet', new Date(2026, 9, 19, 15, 30)), 'fleet_before_move_20261019_1530');
  assert.ok(keptName('x'.repeat(63), new Date(2026, 9, 19, 15, 30)).length <= 63);
  assert.deepStrictEqual(countDifferences({ a: 1, b: 2, c: 3 }, { a: 1, b: 5 }), [{ table: 'b', before: 2, after: 5 }, { table: 'c', before: 3, after: null }]);
  assert.deepStrictEqual(stepsFor({ installPostgres: true }).map((s) => s.id), ['check', 'download', 'admin', 'prepare', 'pause', 'copy', 'load', 'compare', 'switch']);
  assert.ok(!stepsFor({ installPostgres: false }).some((s) => s.id === 'download'));
});

test('leftovers: the kept copy\'s name, and when PostgreSQL itself can go', () => {
  assert.ok(KEPT.test('fleet_warehouse_before_move_20261018_2302'));
  assert.ok(!KEPT.test('fleet_warehouse'));
  assert.ok(!KEPT.test('fleet_before_move_notes'));
  const installed = { postgres: { port: 5432 }, tailscale: true };
  const onlyLeftovers = { leftovers: [{ name: 'fleet' }], others: [] };
  assert.strictEqual(postgresRemovable({ found: onlyLeftovers, installed, port: 5432, current: null }), true);
  assert.strictEqual(postgresRemovable({ found: { ...onlyLeftovers, others: ['something_else'] }, installed, port: 5432, current: null }), false, 'another database is in it');
  assert.strictEqual(postgresRemovable({ found: onlyLeftovers, installed, port: 5432, current: 'fleet' }), false, 'the app uses a database in it');
  assert.strictEqual(postgresRemovable({ found: onlyLeftovers, installed: { postgres: null }, port: 5432, current: null }), false, 'the app didn\'t install it');
  assert.strictEqual(postgresRemovable({ found: onlyLeftovers, installed, port: 5433, current: null }), false, 'a different PostgreSQL');
});

test('leftovers: logging in to PostgreSQL on this PC failed, in plain words', () => {
  const refused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });
  assert.match(connectProblem(refused), /^PostgreSQL isn't running on this PC, or it has been removed/);
  const both = Object.assign(new Error('AggregateError'), { errors: [{ code: 'ECONNREFUSED' }, { code: 'ECONNREFUSED' }] });
  assert.match(connectProblem(both), /isn't running on this PC/, 'localhost tried on both IPv4 and IPv6');
  assert.strictEqual(connectProblem({ code: '28P01' }), 'PostgreSQL refused the master password.');
  assert.strictEqual(connectProblem({ code: 'ETIMEDOUT' }), null, 'anything else gets the general message');
});
