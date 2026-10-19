// A window of recorded values (companion_metric_history), as the Subs, Supplies and Income tabs read them:
// for each character or FC and metric, the last value at or before the window start, then the values in the
// window. The plugin also records an unchanged value every hour as a reminder; those are left out here, in the
// database, so only what changed travels to the app: within the window, a value is kept when it differs from
// the one before it, or when it is the first or the newest. Every calculation that uses these (rises, drops,
// spans from the first value to the last sync) gives the same result without the repeats
// (tests/metric-window.test.js).

// Per character or FC and metric, newest first, which the (subject_type, subject_id, metric, recorded_at DESC)
// index gives in order, so the database has nothing to sort: a value is kept when it is the newest, or when
// the one before it in time (the next one here) differs, which also keeps the first.
const SQL = `
    SELECT c.id::text AS id, m.metric, w.recorded_at, w.value
    FROM unnest($3::numeric[]) AS c(id)
    CROSS JOIN unnest($1::text[]) AS m(metric)
    CROSS JOIN LATERAL (
      SELECT recorded_at, value FROM (
        SELECT h.recorded_at, h.value,
               lead(h.value) OVER newest_first AS earlier,
               row_number() OVER newest_first AS n
        FROM companion_metric_history h
        WHERE h.subject_type = $4 AND h.subject_id = c.id AND h.metric = m.metric AND h.recorded_at > $2
        WINDOW newest_first AS (ORDER BY h.recorded_at DESC)
      ) inside
      WHERE n = 1 OR earlier IS DISTINCT FROM value) w
    UNION ALL
    SELECT c.id::text, m.metric, b.recorded_at, b.value
    FROM unnest($3::numeric[]) AS c(id)
    CROSS JOIN unnest($1::text[]) AS m(metric)
    CROSS JOIN LATERAL (
      SELECT recorded_at, value FROM companion_metric_history h
      WHERE h.subject_type = $4 AND h.subject_id = c.id AND h.metric = m.metric AND h.recorded_at <= $2
      ORDER BY recorded_at DESC LIMIT 1) b`;

// Map `${id}|${metric}` -> [{ at (ms), value }]. subjectType: 'character' or 'fc'.
async function metricWindow(client, subjectType, metrics, windowStart, ids) {
  const result = await client.query(SQL, [metrics, windowStart, ids, subjectType]);
  const points = new Map();
  for (const row of result.rows) {
    const key = `${row.id}|${row.metric}`;
    if (!points.has(key)) points.set(key, []);
    points.get(key).push({ at: new Date(row.recorded_at).getTime(), value: Number(row.value) });
  }
  return points;
}

// The same rule in JavaScript, for the tests: points of one series, oldest first, without the unchanged
// values in the window (the first, the newest and every change stay).
function withoutRepeats(points, windowStart) {
  const before = points.filter((p) => p.at <= windowStart);
  const inside = points.filter((p) => p.at > windowStart);
  const kept = inside.filter((p, i) => i === 0 || i === inside.length - 1 || p.value !== inside[i - 1].value);
  return [...before.slice(-1), ...kept];
}

module.exports = { metricWindow, withoutRepeats };
