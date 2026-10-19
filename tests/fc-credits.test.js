const test = require('node:test');
const assert = require('node:assert');
const { creditPlan, daysCovered, DEFAULT_TANK_COST } = require('../subs/fc-credits');

const fcs = [
  { fc_id: '1', fc_name: 'Panda Co', fc_world: 'Maduin', account_label: 'Account 1', fc_points: 12345 },
  { fc_id: '2', fc_name: 'Second', fc_world: 'Maduin', account_label: 'Account 2', fc_points: 99 },
  { fc_id: '3', fc_name: 'Third', fc_world: 'Behemoth', account_label: 'Account 2', fc_points: 1000 },
];
const characters = [
  { fc_id: '1', account_label: 'Account 1', perDay: 20, have: 500 },
  { fc_id: '1', account_label: 'Account 1', perDay: null, have: 10 },
  { fc_id: '2', account_label: 'Account 2', perDay: 5, have: 100 },
  { fc_id: null, account_label: 'Account 2', perDay: 5, have: 50 },
];

test('each FC: whole tanks its credits buy, its members\' use and how long the tanks last', () => {
  const plan = creditPlan({ fcs, characters, chests: new Map([['1', 30]]) });
  assert.strictEqual(plan.tankCost, DEFAULT_TANK_COST);
  const [panda, second, third] = plan.fcs;
  assert.deepStrictEqual([panda.credits, panda.tanks, panda.chest, panda.perDay, panda.days], [12345, 123, 30, 20, 123 / 20],
    'a member with no known use yet is left out of the use');
  assert.deepStrictEqual([second.tanks, second.days], [0, 0], 'under one tank: none, lasting no days');
  assert.deepStrictEqual([third.tanks, third.perDay, third.days], [10, null, null], 'no members with subs: use unknown');
});

test('per account and for the fleet: credits, tanks, ceruleum held and in chests, all characters\' use', () => {
  const plan = creditPlan({ fcs, characters, chests: new Map([['1', 30], ['3', 4]]), tankCost: 50 });
  const [a1, a2] = plan.accounts;
  assert.deepStrictEqual([a1.label, a1.fcCount, a1.credits, a1.tanks, a1.held, a1.chest, a1.perDay], ['Account 1', 1, 12345, 246, 510, 30, 20]);
  assert.deepStrictEqual([a2.label, a2.fcCount, a2.credits, a2.tanks, a2.held, a2.chest, a2.perDay], ['Account 2', 2, 1099, 1 + 20, 150, 4, 10],
    'a character in no FC still counts toward its account\'s use');
  assert.strictEqual(a2.days, 21 / 10);
  const f = plan.fleet;
  assert.deepStrictEqual([f.fcCount, f.credits, f.tanks, f.held, f.chest, f.perDay], [3, 13444, 267, 660, 34, 30]);
});

test('nothing used: the tanks last for ever; a bad price falls back to the default', () => {
  assert.strictEqual(daysCovered(5, 0), Infinity);
  assert.strictEqual(daysCovered(5, null), null);
  assert.strictEqual(creditPlan({ fcs, characters, tankCost: 0 }).tankCost, DEFAULT_TANK_COST);
  assert.deepStrictEqual(creditPlan({ fcs: [], characters }).accounts, [], 'accounts with no FC are not listed');
});
