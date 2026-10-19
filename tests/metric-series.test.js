const test = require('node:test');
const assert = require('node:assert/strict');
const ms = require('../db/metric-series');

const base = { from: '2026-09-01T00:00:00Z', to: '2026-09-29T00:00:00Z', parts: [{ metric: 'gil', subjectType: 'character' }] };

test('accepts a minimal request and applies defaults', () => {
  const r = ms.validateSeriesRequest(base);
  assert.equal(r.ok, true);
  assert.equal(r.params.points, ms.DEFAULT_POINTS);
  assert.equal(r.params.split, false);
  assert.deepEqual(r.params.weights, [1]);
});

test('subject ids switch to one series per subject', () => {
  const r = ms.validateSeriesRequest({ ...base, subjectIds: ['18014498578455309'] });
  assert.equal(r.ok, true);
  assert.equal(r.params.split, true);
});

test('rejects bad requests', () => {
  const bad = [
    null,
    {},
    { ...base, from: 'nope' },
    { ...base, from: base.to, to: base.from },
    { ...base, from: '1900-01-01T00:00:00Z' },
    { ...base, points: 1 },
    { ...base, points: 1001 },
    { ...base, points: 2.5 },
    { ...base, parts: [] },
    { ...base, parts: [{ metric: 'gil; DROP TABLE x', subjectType: 'character' }] },
    { ...base, parts: [{ metric: 'gil', subjectType: 'planet' }] },
    { ...base, parts: [{ metric: 'gil', subjectType: 'character', weight: 'heavy' }] },
    { ...base, subjectIds: [] },
    { ...base, subjectIds: ['12; DROP'] },
    { ...base, subjectIds: Array.from({ length: 501 }, (_, i) => String(i)) },
  ];
  for (const b of bad) assert.equal(ms.validateSeriesRequest(b).ok, false, JSON.stringify(b)?.slice(0, 80));
});

test('accepts item-quantity metrics and weights', () => {
  const r = ms.validateSeriesRequest({ ...base, parts: [{ metric: 'item_qty:22500', subjectType: 'fc', weight: 8000 }] });
  assert.equal(r.ok, true);
});

test('shapes rows into aligned series with gaps as null', () => {
  const r = ms.validateSeriesRequest({ ...base, points: 4, subjectIds: ['1', '2'] });
  const shaped = ms.shapeSeriesResult(
    [{ i: 1, subject_id: '1', value: '10' }, { i: 2, subject_id: '1', value: '12' }, { i: 3, subject_id: '2', value: '5' }],
    r.params
  );
  assert.equal(shaped.timestamps.length, 4);
  assert.deepEqual(shaped.series[0].values, [null, 10, 12, null]);
  assert.deepEqual(shaped.series[1].values, [null, null, null, 5]);
  assert.equal(shaped.timestamps[0], new Date(base.from).getTime());
  assert.equal(shaped.timestamps[3], new Date(base.to).getTime());
});

test('aggregate result is a single series', () => {
  const r = ms.validateSeriesRequest({ ...base, points: 3 });
  const shaped = ms.shapeSeriesResult([{ i: 0, subject_id: null, value: '7' }], r.params);
  assert.equal(shaped.series.length, 1);
  assert.equal(shaped.series[0].subjectId, null);
  assert.deepEqual(shaped.series[0].values, [7, null, null]);
});

test('small requests stay in one slice; heavy ones split into covering, non-overlapping slices', () => {
  const small = ms.validateSeriesRequest({ ...base, subjectIds: ['1'] });
  assert.deepEqual(ms.planSlices(small.params), [[0, ms.DEFAULT_POINTS - 1]]);

  for (const points of [60, 61, 150, 200, 999, 1000]) {
    const heavy = ms.validateSeriesRequest({ ...base, points });
    const slices = ms.planSlices(heavy.params);
    assert.ok(slices.length > 1, `points=${points} should be split`);
    let next = 0;
    for (const [lo, hi] of slices) {
      assert.equal(lo, next);
      assert.ok(hi >= lo);
      next = hi + 1;
    }
    assert.equal(next, points, `points=${points}: slices cover every instant exactly once`);
  }
  // a handful of lookups per instant is cheaper on one connection than opening four
  const eight = ms.validateSeriesRequest({ ...base, subjectIds: ['1'], parts: Array.from({ length: 8 }, (_, i) => ({ metric: `item_qty:${22500 + i}`, subjectType: 'character' })) });
  assert.equal(ms.planSlices(eight.params).length, 1);
  const few = ms.validateSeriesRequest({ ...base, points: 30 });
  assert.equal(ms.planSlices(few.params).length, 1);
});

test('runSeries merges slices, closes every client, and closes them on failure too', async () => {
  const v = ms.validateSeriesRequest({ ...base, points: 100 });
  let opened = 0, closed = 0;
  const okClient = () => ({
    query: async (sql, args) => ({ rows: [{ i: args[8], subject_id: null, value: String(args[8]) }] }),
    end: async () => { closed++; },
  });
  const shaped = await ms.runSeries(async () => { opened++; return okClient(); }, v.params);
  assert.equal(opened, closed);
  assert.ok(opened > 1);
  assert.equal(shaped.series[0].values[0], 0);
  assert.equal(shaped.series[0].values[25], 25);

  opened = closed = 0;
  const failing = { query: async () => { throw new Error('boom'); }, end: async () => { closed++; } };
  await assert.rejects(ms.runSeries(async () => { opened++; return failing; }, v.params), /boom/);
  assert.equal(opened, closed);
});
