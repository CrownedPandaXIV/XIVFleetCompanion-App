// Data layer for the trend charts: reads companion_metric_history (see the plugin's
// database version 1). Kept free of Electron so it can be tested directly against
// a database.
//
// How the history is stored: a row is written when a value CHANGES, plus an hourly
// "still the same" marker. So a chart value at any instant is the value of the most recent
// row at or before that instant (a step function). For each chart point (a "bucket"
// instant) we look that row up through the (subject_type, subject_id, metric, recorded_at)
// index: one cheap index probe per subject per point, so the cost depends on the number of
// points drawn, never on how many history rows exist.

const MAX_POINTS = 1000;
const DEFAULT_POINTS = 200;
const MAX_PARTS = 20;
const MAX_SUBJECTS = 500;
const MAX_SPAN_MS = 20 * 365 * 24 * 3600 * 1000;

const SUBJECT_TYPES = new Set(['character', 'fc']);
const METRIC_PATTERN = /^[a-z_]{1,40}(:[0-9]{1,9})?$/;
const SUBJECT_ID_PATTERN = /^[0-9]{1,25}$/;

// Checks and normalizes a series request from the interface. Returns { ok: true, params }
// or { ok: false, error }.
//
//   from, to     ISO timestamps; `to` defaults to now, `from` must be earlier
//   points       how many chart points to return (2 to 1000, default 200)
//   parts        [{ metric, subjectType, weight? }]: the values to add together per point.
//                One part is the usual case. Several parts make derived values, e.g.
//                salvage value = sum of item quantities x their prices.
//   subjectIds   optional list of character/FC ids. With ids, one series per id is returned;
//                without, one series that sums every subject that has the metric.
function validateSeriesRequest(request) {
  if (!request || typeof request !== 'object') return { ok: false, error: 'Invalid request.' };

  const to = request.to ? new Date(request.to) : new Date();
  const from = new Date(request.from);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return { ok: false, error: 'Invalid time range.' };
  }
  if (from >= to) return { ok: false, error: 'The start of the range must be before the end.' };
  if (to - from > MAX_SPAN_MS) return { ok: false, error: 'The time range is too long.' };

  let points = request.points === undefined ? DEFAULT_POINTS : Number(request.points);
  if (!Number.isInteger(points) || points < 2 || points > MAX_POINTS) {
    return { ok: false, error: `points must be a whole number from 2 to ${MAX_POINTS}.` };
  }

  if (!Array.isArray(request.parts) || request.parts.length < 1 || request.parts.length > MAX_PARTS) {
    return { ok: false, error: `parts must list 1 to ${MAX_PARTS} values.` };
  }
  const metrics = [];
  const subjectTypes = [];
  const weights = [];
  for (const part of request.parts) {
    if (!part || typeof part.metric !== 'string' || !METRIC_PATTERN.test(part.metric)) {
      return { ok: false, error: 'Invalid metric name.' };
    }
    if (!SUBJECT_TYPES.has(part.subjectType)) return { ok: false, error: 'Invalid subject type.' };
    const weight = part.weight === undefined ? 1 : Number(part.weight);
    if (!Number.isFinite(weight)) return { ok: false, error: 'Invalid weight.' };
    metrics.push(part.metric);
    subjectTypes.push(part.subjectType);
    weights.push(weight);
  }

  let subjectIds = null;
  if (request.subjectIds !== undefined && request.subjectIds !== null) {
    if (!Array.isArray(request.subjectIds) || request.subjectIds.length < 1 || request.subjectIds.length > MAX_SUBJECTS) {
      return { ok: false, error: `subjectIds must list 1 to ${MAX_SUBJECTS} ids.` };
    }
    subjectIds = request.subjectIds.map(String);
    if (!subjectIds.every((id) => SUBJECT_ID_PATTERN.test(id))) return { ok: false, error: 'Invalid subject id.' };
  }

  return {
    ok: true,
    params: { from, to, points, metrics, subjectTypes, weights, subjectIds, split: subjectIds !== null },
  };
}

// One statement builds the whole chart: the chart instants, the subjects that carry each
// metric (from the small companion_metric_latest table), and one index probe per subject per
// instant. $1 from, $2 to, $3 intervals, $4 metrics, $5 subject types, $6 weights,
// $7 subject ids (or null for all), $8 one series per subject (true) or a single sum (false),
// $9 and $10 the first and last chart instant to compute (all of them, or one slice).
const SERIES_SQL = `
  WITH buckets AS (
    SELECT i, $1::timestamptz + ($2::timestamptz - $1::timestamptz) * i / $3::int AS ts
    FROM generate_series($9::int, $10::int) AS i
  ),
  parts AS (
    SELECT * FROM unnest($4::text[], $5::text[], $6::numeric[]) AS x(metric, subject_type, weight)
  ),
  subjects AS (
    SELECT DISTINCT l.subject_type, l.subject_id, pt.metric, pt.weight
    FROM parts pt
    JOIN companion_metric_latest l ON l.metric = pt.metric AND l.subject_type = pt.subject_type
    WHERE $7::numeric[] IS NULL OR l.subject_id = ANY($7::numeric[])
  )
  SELECT b.i,
         CASE WHEN $8::boolean THEN s.subject_id END AS subject_id,
         sum(v.value * s.weight) AS value
  FROM buckets b
  CROSS JOIN subjects s
  CROSS JOIN LATERAL (
    SELECT h.value
    FROM companion_metric_history h
    WHERE h.subject_type = s.subject_type
      AND h.subject_id = s.subject_id
      AND h.metric = s.metric
      AND h.recorded_at <= b.ts
    ORDER BY h.recorded_at DESC
    LIMIT 1
  ) v
  GROUP BY b.i, CASE WHEN $8::boolean THEN s.subject_id END
  ORDER BY 2, b.i`;

function seriesQueryArgs(p, lo = 0, hi = p.points - 1) {
  return [
    p.from.toISOString(),
    p.to.toISOString(),
    p.points - 1,
    p.metrics,
    p.subjectTypes,
    p.weights,
    p.subjectIds,
    p.split,
    lo,
    hi,
  ];
}

// Heavy requests (many subjects or values combined, many points) are split into slices of chart
// instants that run at the same time on separate connections. Each instant is independent, so
// the result is identical; it just finishes sooner on a server with spare cores.
const PARALLEL_SLICES = 4;
const MIN_POINTS_TO_SLICE = 60;
const MIN_PROBES_TO_SLICE = 40;

function planSlices(p) {
  // Rough work per instant: how many (subject, value) lookups it needs. A fleet total covers
  // every subject, which is many; a couple of named subjects with one value is few.
  const subjectsEstimate = p.subjectIds ? p.subjectIds.length : 80;
  const probesPerInstant = subjectsEstimate * p.metrics.length;
  if (p.points < MIN_POINTS_TO_SLICE || probesPerInstant < MIN_PROBES_TO_SLICE) return [[0, p.points - 1]];
  const slices = [];
  const size = Math.ceil(p.points / PARALLEL_SLICES);
  for (let lo = 0; lo < p.points; lo += size) slices.push([lo, Math.min(lo + size, p.points) - 1]);
  return slices;
}

// Runs a validated request and returns the shaped result. `newClient` must resolve to a
// connected client with query() and end(); one is opened per slice and always closed.
async function runSeries(newClient, p) {
  const slices = planSlices(p);
  const clients = [];
  try {
    const parts = await Promise.all(
      slices.map(async ([lo, hi]) => {
        const client = await newClient();
        clients.push(client);
        const result = await client.query(SERIES_SQL, seriesQueryArgs(p, lo, hi));
        return result.rows;
      })
    );
    return shapeSeriesResult(parts.flat(), p);
  } finally {
    await Promise.all(clients.map((c) => Promise.resolve(c.end()).catch(() => {})));
  }
}

// Turns the database rows into { timestamps, series } for the interface. A point with no
// data yet (before the first recorded value) is null, so a chart shows a gap, not a zero.
function shapeSeriesResult(rows, p) {
  const total = p.points;
  const spanMs = p.to - p.from;
  const timestamps = [];
  for (let i = 0; i < total; i++) {
    timestamps.push(Math.round(p.from.getTime() + (spanMs * i) / (total - 1)));
  }

  const byKey = new Map();
  const orderOf = p.split ? p.subjectIds : [null];
  for (const id of orderOf) byKey.set(id, new Array(total).fill(null));

  for (const row of rows) {
    const key = p.split ? String(row.subject_id) : null;
    const values = byKey.get(key);
    if (!values) continue;
    values[row.i] = row.value === null ? null : Number(row.value);
  }

  return {
    success: true,
    timestamps,
    series: orderOf.map((id) => ({ subjectId: id, values: byKey.get(id) })),
  };
}

// What can be charted: one row per metric and subject type, with how many subjects have it and
// when it was first and last recorded. The per-metric first-row lookup is an index-only probe.
const CATALOG_SQL = `
  SELECT m.metric, m.subject_type, m.subjects, m.last_recorded,
         (SELECT min(h.recorded_at) FROM companion_metric_history h WHERE h.metric = m.metric) AS first_recorded
  FROM (
    SELECT metric, subject_type, count(*)::int AS subjects, max(recorded_at) AS last_recorded
    FROM companion_metric_latest
    GROUP BY metric, subject_type
  ) m
  ORDER BY m.metric, m.subject_type`;

module.exports = {
  MAX_POINTS,
  DEFAULT_POINTS,
  SERIES_SQL,
  CATALOG_SQL,
  validateSeriesRequest,
  seriesQueryArgs,
  planSlices,
  runSeries,
  shapeSeriesResult,
};
