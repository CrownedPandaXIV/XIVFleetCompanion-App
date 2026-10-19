// Checks db/metric-window.js against a real Postgres holding generated history (tests/db/generate-metric-history.sql):
// what it sends is exactly the full window with the unchanged repeats taken out (withoutRepeats), for characters
// and FCs, and far less of it. Set PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE. Only reads.
const { Client } = require('pg');
const assert = require('node:assert');
const { metricWindow, withoutRepeats } = require('../../db/metric-window');

let n = 0;
async function scenario(name, fn) {
  try { await fn(); console.log(`PASS ${++n}. ${name}`); } catch (e) { console.log(`FAIL ${++n}. ${name}\n   ${e.stack}`); process.exitCode = 1; }
}

// The query the tabs used before: every value in the window, plus the last value at or before its start.
const FULL = `
    SELECT h.subject_id::text AS id, h.metric, h.recorded_at, h.value
    FROM companion_metric_history h
    WHERE h.subject_type = $4 AND h.metric = ANY($1::text[]) AND h.recorded_at > $2 AND h.subject_id = ANY($3::numeric[])
    UNION ALL
    SELECT c.id::text, m.metric, b.recorded_at, b.value
    FROM unnest($3::numeric[]) AS c(id) CROSS JOIN unnest($1::text[]) AS m(metric)
    CROSS JOIN LATERAL (SELECT recorded_at, value FROM companion_metric_history h
      WHERE h.subject_type = $4 AND h.subject_id = c.id AND h.metric = m.metric AND h.recorded_at <= $2
      ORDER BY recorded_at DESC LIMIT 1) b`;

async function full(client, subjectType, metrics, windowStart, ids) {
  const points = new Map();
  for (const row of (await client.query(FULL, [metrics, windowStart, ids, subjectType])).rows) {
    const key = `${row.id}|${row.metric}`;
    if (!points.has(key)) points.set(key, []);
    points.get(key).push({ at: new Date(row.recorded_at).getTime(), value: Number(row.value) });
  }
  return points;
}
const sorted = (points) => [...points].sort((a, b) => a.at - b.at);
const count = (map) => [...map.values()].reduce((sum, list) => sum + list.length, 0);

(async () => {
  const client = new Client();
  await client.connect();
  try {
    const latest = (await client.query('SELECT max(recorded_at) AS at FROM companion_metric_history')).rows[0].at;
    for (const [subjectType, days] of [['character', 14], ['character', 30], ['fc', 7]]) {
      await scenario(`${subjectType}s over ${days} days: the same values without the repeats`, async () => {
        const ids = (await client.query('SELECT DISTINCT subject_id::text AS id FROM companion_metric_history WHERE subject_type = $1', [subjectType])).rows.map((r) => r.id);
        const metrics = (await client.query('SELECT DISTINCT metric FROM companion_metric_history WHERE subject_type = $1', [subjectType])).rows.map((r) => r.metric);
        assert.ok(ids.length && metrics.length, 'generated history is there');
        // Not exactly on a recorded value: the database keeps microseconds, JavaScript only milliseconds, so a value
        // recorded in the window's first millisecond would count as inside it there and before it here.
        const windowStart = new Date(new Date(latest).getTime() - days * 24 * 60 * 60 * 1000 - 1777);
        const before = await full(client, subjectType, metrics, windowStart, ids);
        const after = await metricWindow(client, subjectType, metrics, windowStart, ids);
        assert.deepStrictEqual([...after.keys()].sort(), [...before.keys()].sort());
        for (const [key, list] of before) {
          assert.deepStrictEqual(sorted(after.get(key)), withoutRepeats(sorted(list), windowStart.getTime()), key);
        }
        console.log(`   ${count(before)} values before, ${count(after)} now`);
        assert.ok(count(after) < count(before) / 3, 'far fewer values');
      });
    }
  } finally {
    await client.end();
  }
})();
