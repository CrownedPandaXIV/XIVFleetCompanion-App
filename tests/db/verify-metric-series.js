// Checks every chart query against an independent calculation from the raw rows, and times it.
// Needs a scratch database built by generate-metric-history.sql. Usage:
//   PGHOST=... PGPORT=... PGUSER=... PGDATABASE=scratch node tests/db/verify-metric-series.js
const { Client } = require('pg');
const ms = require('../../db/metric-series.js');
const DAY = 86400000, now = Date.now();
const iso = (msAgo) => new Date(now - msAgo).toISOString();
const PRICES = { 22500: 8000, 22501: 9000, 22502: 10000, 22503: 13000, 22504: 27000, 22505: 28500, 22506: 30000, 22507: 34500 };

(async () => {
  const c = new Client({ host: process.env.PGHOST, port: Number(process.env.PGPORT || 5432), user: process.env.PGUSER, password: process.env.PGPASSWORD, database: process.env.PGDATABASE });
  await c.connect();

  // ---- independent reference: pull raw rows and evaluate the step function in JS
  const rawCache = new Map();
  async function raw(type, id, metric) {
    const k = `${type}|${id}|${metric}`;
    if (!rawCache.has(k)) {
      const r = await c.query('select extract(epoch from recorded_at)*1000 as t, value::float8 as v from companion_metric_history where subject_type=$1 and subject_id=$2 and metric=$3 order by recorded_at', [type, id, metric]);
      rawCache.set(k, r.rows.map((x) => [Number(x.t), Number(x.v)]));
    }
    return rawCache.get(k);
  }
  function stepAt(rows, t) { // last row with time <= t (binary search)
    let lo = 0, hi = rows.length - 1, ans = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (rows[mid][0] <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    return ans < 0 ? null : rows[ans][1];
  }
  async function subjectsFor(part) {
    const r = await c.query('select subject_id::text id from companion_metric_latest where metric=$1 and subject_type=$2', [part.metric, part.subjectType]);
    return r.rows.map((x) => x.id);
  }
  async function reference(req, p, shaped) {
    const ts = shaped.timestamps;
    const perSubjectVals = new Map(); // subjectId -> array of values (sum over parts)
    const subjectSets = [];
    for (const part of req.parts) {
      let ids = await subjectsFor(part);
      if (req.subjectIds) ids = ids.filter((i) => req.subjectIds.includes(i));
      subjectSets.push(ids);
      for (const id of ids) {
        const rows = await raw(part.subjectType, id, part.metric);
        const w = part.weight ?? 1;
        const vals = ts.map((t) => { const v = stepAt(rows, t); return v === null ? null : v * w; });
        const key = req.subjectIds ? id : 'ALL';
        const acc = perSubjectVals.get(key) || new Array(ts.length).fill(null);
        vals.forEach((v, i) => { if (v !== null) acc[i] = (acc[i] ?? 0) + v; });
        perSubjectVals.set(key, acc);
      }
    }
    return perSubjectVals;
  }

  let failures = 0;
  async function check(name, req, opts = {}) {
    const v = ms.validateSeriesRequest(req);
    if (!v.ok) { console.log(`FAIL ${name}: validation ${v.error}`); failures++; return; }
    const newClient = async () => {
      const cl = new Client({ host: process.env.PGHOST, port: Number(process.env.PGPORT || 5432), user: process.env.PGUSER, password: process.env.PGPASSWORD, database: process.env.PGDATABASE });
      await cl.connect();
      return cl;
    };
    // the way the app runs it (heavy requests split into parallel slices)...
    const t0 = Date.now();
    const shaped = await ms.runSeries(newClient, v.params);
    const ms1 = Date.now() - t0;
    // ...and the plain single-connection way, which must give the identical answer
    const slices = ms.planSlices(v.params).length;
    const t1 = Date.now();
    const single = ms.shapeSeriesResult((await c.query(ms.SERIES_SQL, ms.seriesQueryArgs(v.params))).rows, v.params);
    const msSingle = Date.now() - t1;
    if (JSON.stringify(single) !== JSON.stringify(shaped)) { failures++; console.log(`FAIL ${name}: sliced and single-connection results differ`); }
    const ref = await reference(req, v.params, shaped);
    let bad = 0, compared = 0, nulls = 0, nonnull = 0;
    for (const s of shaped.series) {
      const key = req.subjectIds ? s.subjectId : 'ALL';
      const exp = ref.get(key) || new Array(shaped.timestamps.length).fill(null);
      s.values.forEach((got, i) => {
        compared++;
        if (got === null) nulls++; else nonnull++;
        const e = exp[i];
        const same = (got === null && e === null) || (got !== null && e !== null && Math.abs(got - e) <= 1e-6 * Math.max(1, Math.abs(e)));
        if (!same) { bad++; if (bad <= 3) console.log(`   mismatch ${name} series ${s.subjectId} point ${i}: got ${got} expected ${e}`); }
      });
    }
    if (opts.expectAllNull && nonnull > 0) { bad++; console.log('   expected all null'); }
    const ok = bad === 0;
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(46)} ${String(ms1).padStart(5)} ms (${slices} slice${slices > 1 ? 's' : ''}; single connection ${msSingle} ms)  series=${shaped.series.length} compared=${compared} null=${nulls}`);
  }

  const id1 = '18014498578000007', year = 365 * DAY;
  const salvageChar = Object.entries(PRICES).map(([i, p]) => ({ metric: `item_qty:${i}`, subjectType: 'character', weight: p }));
  const salvageFc = Object.entries(PRICES).map(([i, p]) => ({ metric: `item_qty:${i}`, subjectType: 'fc', weight: p }));

  await check('one character, gil, 1 year / 200 pts',      { from: iso(year), to: iso(0), parts: [{ metric: 'gil', subjectType: 'character' }], subjectIds: [id1] });
  await check('one character, gil, last 24 h / 288 pts',   { from: iso(DAY), to: iso(0), points: 288, parts: [{ metric: 'gil', subjectType: 'character' }], subjectIds: [id1] });
  await check('fleet total gil, 1 year / 200 pts',         { from: iso(year), to: iso(0), parts: [{ metric: 'gil', subjectType: 'character' }] });
  await check('fleet total gil, 1 year / 1000 pts',        { from: iso(year), to: iso(0), points: 1000, parts: [{ metric: 'gil', subjectType: 'character' }] });
  await check('every character, gil, 1 year (80 lines)',   { from: iso(year), to: iso(0), parts: [{ metric: 'gil', subjectType: 'character' }], subjectIds: Array.from({ length: 80 }, (_, i) => String(18014498578000001 + i)) });
  await check('fleet total ceruleum, 30 days',             { from: iso(30 * DAY), to: iso(0), parts: [{ metric: 'ceruleum', subjectType: 'character' }] });
  await check('fleet total repair kits, 7 days',           { from: iso(7 * DAY), to: iso(0), parts: [{ metric: 'repair_kits', subjectType: 'character' }] });
  await check('FC points, all FCs total, 1 year',          { from: iso(year), to: iso(0), parts: [{ metric: 'fc_points', subjectType: 'fc' }] });
  await check('salvage value, whole fleet (16 parts), 1 y', { from: iso(year), to: iso(0), parts: [...salvageChar, ...salvageFc] });
  await check('salvage value, one character, 90 days',     { from: iso(90 * DAY), to: iso(0), parts: salvageChar, subjectIds: [id1] });
  await check('one FC salvage value, 90 days',             { from: iso(90 * DAY), to: iso(0), parts: salvageFc, subjectIds: ['9000003'] });
  await check('range before any data (all gaps)',          { from: iso(800 * DAY), to: iso(700 * DAY), parts: [{ metric: 'gil', subjectType: 'character' }] }, { expectAllNull: true });
  await check('range straddling the first data',           { from: iso(400 * DAY), to: iso(300 * DAY), parts: [{ metric: 'gil', subjectType: 'character' }], subjectIds: [id1] });
  await check('subject that has no history',              { from: iso(30 * DAY), to: iso(0), parts: [{ metric: 'gil', subjectType: 'character' }], subjectIds: ['1'] }, { expectAllNull: true });
  await check('metric that does not exist',               { from: iso(30 * DAY), to: iso(0), parts: [{ metric: 'no_such_metric', subjectType: 'character' }] }, { expectAllNull: true });
  await check('minimum 2 points',                         { from: iso(30 * DAY), to: iso(0), points: 2, parts: [{ metric: 'gil', subjectType: 'character' }] });
  await check('very short window (10 minutes)',           { from: iso(10 * 60000), to: iso(0), parts: [{ metric: 'gil', subjectType: 'character' }], subjectIds: [id1] });
  await check('future end of range',                      { from: iso(DAY), to: new Date(now + 5 * DAY).toISOString(), parts: [{ metric: 'gil', subjectType: 'character' }], subjectIds: [id1] });

  const t0 = Date.now(); const cat = await c.query(ms.CATALOG_SQL); console.log(`catalog query: ${Date.now() - t0} ms, ${cat.rows.length} rows`);
  console.log(cat.rows.slice(0, 3).map((r) => `   ${r.metric} / ${r.subject_type}: ${r.subjects} subjects, first ${new Date(r.first_recorded).toISOString().slice(0, 10)}`).join('\n'));
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  await c.end(); process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('ERROR', e.message); process.exit(1); });
