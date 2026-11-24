// When a sub's parts need repairing (subs/repair-due.js), from the plugin's workshop readings.
const test = require('node:test');
const assert = require('node:assert');
const { dropsOf, wearAtSend, voyagesLeft, repairDue } = require('../subs/repair-due');
const { sectorDamage } = require('../subs/calculator');

const r = (readAt, returnAt, condition, itemId = 100) => ({ readAt, returnAt, itemId, condition });

test('a drop read while out is wear taken when sent; once back, on return', () => {
  assert.deepStrictEqual(dropsOf([r(0, 0, 30000), r(10, 500, 29000), r(600, 0, 28000)]), [true, false]);
  // A rise (repair) or another part fitted is no drop.
  assert.deepStrictEqual(dropsOf([r(0, 0, 10000), r(10, 0, 30000), r(20, 0, 29000, 200)]), []);
});

test('wearAtSend goes by most drops, null with none', () => {
  assert.strictEqual(wearAtSend([[r(0, 0, 30000), r(10, 500, 29000)], [r(0, 0, 30000), r(10, 500, 29000)]]), true);
  assert.strictEqual(wearAtSend([[r(0, 0, 30000), r(600, 0, 29000)]]), false);
  assert.strictEqual(wearAtSend([[r(0, 0, 30000)]]), null);
});

test('voyages left: a part sails while above 0, after the voyage it is on now', () => {
  const lost = 1000;
  // In port when read and now: 2500 lasts 3 more sends (2500, 1500, 500 all above 0).
  assert.strictEqual(voyagesLeft({ last: r(10, 0, 2500), itemId: 100, lost, returnTime: 0, atSend: true }), 3);
  // Read while out: worn on return, so the voyage it is on takes 1000 first.
  assert.strictEqual(voyagesLeft({ last: r(10, 500, 2500), itemId: 100, lost, returnTime: 500, atSend: false }), 2);
  assert.strictEqual(voyagesLeft({ last: r(10, 500, 2500), itemId: 100, lost, returnTime: 500, atSend: null }), 2);
  // Worn when sent: the reading already holds the voyage it is on.
  assert.strictEqual(voyagesLeft({ last: r(10, 500, 2500), itemId: 100, lost, returnTime: 500, atSend: true }), 3);
  // Sent again since the reading (worn when sent): one more voyage's wear.
  assert.strictEqual(voyagesLeft({ last: r(10, 0, 2500), itemId: 100, lost, returnTime: 9000, atSend: true }), 2);
  // Nothing left: repair now.
  assert.strictEqual(voyagesLeft({ last: r(10, 500, 800), itemId: 100, lost, returnTime: 500, atSend: false }), 0);
  // Another part fitted since: not known.
  assert.strictEqual(voyagesLeft({ last: r(10, 0, 2500), itemId: 100, lost, returnTime: 0, atSend: true, itemId: 200 }), null);
});

test('a sub: the part that needs repairing first', () => {
  const route = [30, 40];
  const lostAt = (rank) => route.reduce((sum, rq) => sum + sectorDamage(rq, rank), 0);
  const parts = [
    { readings: [r(10, 0, 30000)], itemId: 100, rank: 1 },
    { readings: [r(10, 0, 6000, 101)], itemId: 101, rank: 1 },
    null,
    { readings: [], itemId: 103, rank: 1 },
  ];
  const due = repairDue({ parts, route, returnTime: 0, atSend: true });
  assert.strictEqual(due.slot, 1);
  assert.strictEqual(due.voyages, Math.ceil(6000 / lostAt(1)));
  assert.strictEqual(due.condition, 20);
  assert.strictEqual(repairDue({ parts, route: [], returnTime: 0, atSend: true }), null);
});
