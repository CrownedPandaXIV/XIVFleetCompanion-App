const test = require('node:test');
const assert = require('node:assert');
const { chestHolders, membersByFc } = require('../characters/fc-chest');

test('each FC chest goes to exactly one member', () => {
  const holders = chestHolders([
    { cid: 1, name: 'Aki', fc_id: 900, sort_index: 2 },
    { cid: 2, name: 'Bex', fc_id: 900, sort_index: 1 },
    { cid: 3, name: 'Cal', fc_id: 901, sort_index: 3 },
  ]);
  assert.deepStrictEqual([...holders.entries()], [['900', '2'], ['901', '3']]);
});

test('the FC leader holds the chest when the leader is tracked (name match ignores case)', () => {
  const holders = chestHolders([
    { cid: 1, name: 'Aki', fc_id: 900, fc_master: 'bex', sort_index: 1 },
    { cid: 2, name: 'Bex', fc_id: 900, fc_master: 'bex', sort_index: 2 },
  ]);
  assert.strictEqual(holders.get('900'), '2');
});

test('without a tracked leader: saved roster position, then name; no position comes last', () => {
  const holders = chestHolders([
    { cid: 1, name: 'Zed', fc_id: 900, fc_master: 'Someone Else', sort_index: null },
    { cid: 2, name: 'Bex', fc_id: 900, fc_master: 'Someone Else', sort_index: null },
    { cid: 3, name: 'Yui', fc_id: 901, sort_index: null },
    { cid: 4, name: 'Kai', fc_id: 901, sort_index: 7 },
  ]);
  assert.strictEqual(holders.get('900'), '2');
  assert.strictEqual(holders.get('901'), '4');
});

test('characters without an FC hold no chest; ids compare as text', () => {
  const holders = chestHolders([
    { cid: '18014498578000001', name: 'Aki', fc_id: null },
    { cid: '18014498578000002', name: 'Bex', fc_id: '0' },
    { cid: '18014498578000003', name: 'Cal', fc_id: '9000001' },
  ]);
  assert.deepStrictEqual([...holders.entries()], [['9000001', '18014498578000003']]);
});

test('membersByFc lists every tracked member of each FC', () => {
  const members = membersByFc([
    { cid: 1, fc_id: 900 }, { cid: 2, fc_id: 900 }, { cid: 3, fc_id: null }, { cid: 4, fc_id: 901 },
  ]);
  assert.deepStrictEqual([...members.entries()], [['900', ['1', '2']], ['901', ['4']]]);
});
