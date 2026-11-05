// Characters no setup syncs (characters/owner-skips.js): the setup they last logged in on syncs, but not them.
const test = require('node:test');
const assert = require('node:assert');
const { ownerSkips } = require('../characters/owner-skips');

const now = Date.parse('2026-11-05T12:00:00Z');
const ago = (minutes) => new Date(now - minutes * 60000).toISOString();
const setups = [
  { pc_name: 'DESKTOP-1', account_label: 'Account 2', last_sync_at: ago(3) },
  { pc_name: 'DESKTOP-1', account_label: 'Account R', last_sync_at: ago(3 * 24 * 60) },
];
const character = (name, lastSynced, pc, label) => ({ cid: name.length, name, world: 'Goblin', last_synced_at: ago(lastSynced), login_pc: pc, login_label: label });

test('a character its setup has stopped sending while that setup keeps syncing', () => {
  const found = ownerSkips([character('Berry Blastz', 600, 'DESKTOP-1', 'Account 2')], setups, now);
  assert.deepStrictEqual(found, [{ cid: '12', name: 'Berry Blastz', world: 'Goblin', pc: 'DESKTOP-1', label: 'Account 2' }]);
});

test('not counted: synced along with its setup, its setup not syncing lately, or no login recorded', () => {
  assert.deepStrictEqual(ownerSkips([character('Kept Up', 5, 'DESKTOP-1', 'Account 2')], setups, now), [], 'synced with its setup');
  assert.deepStrictEqual(ownerSkips([character('A Bit Behind', 50, 'DESKTOP-1', 'Account 2')], setups, now), [], 'less than an hour behind');
  assert.deepStrictEqual(ownerSkips([character('Taking A Break', 9000, 'DESKTOP-1', 'Account R')], setups, now), [], 'its setup has not synced for days (game not played)');
  assert.deepStrictEqual(ownerSkips([{ ...character('No Login', 9000, null, null) }], setups, now), [], 'no login: every setup syncs it as before');
  assert.deepStrictEqual(ownerSkips([character('Unknown Setup', 600, 'LAPTOP', 'Account 2')], setups, now), [], 'a setup the PCs tab has no row for');
});
