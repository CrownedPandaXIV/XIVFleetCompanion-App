// The Sub Calculator's Compare page: up to three builds side by side, on one route for all of them ("same") or each on
// its own best route on a map ("best", subs/route-finder.js). This file has the parts with no game data or database:
// whether a build can fly a route, the numbers each row shows, and which build is best in each row. The plugin's
// SubCompare.cs is the same, checked against this through tests/db/calculator-fixture.js.
const calc = require('./calculator');

const MAX_BUILDS = 3;
const MODES = ['same', 'best'];

// The rows that are numbers, in page order, and which way is better.
const ROWS = [
  { key: 'surveillance', better: 'high' },
  { key: 'retrieval', better: 'high' },
  { key: 'speed', better: 'high' },
  { key: 'range', better: 'high' },
  { key: 'favor', better: 'high' },
  { key: 'spare', better: 'high' },
  { key: 'hours', better: 'low' },
  { key: 'expPerVoyage', better: 'high' },
  { key: 'expPerDay', better: 'high' },
  { key: 'gilPerVoyage', better: 'high' },
  { key: 'gilPerDay', better: 'high' },
  { key: 'kitsPerDay', better: 'low' },
  { key: 'netPerDay', better: 'high' },
];
const STAT_KEYS = ['surveillance', 'retrieval', 'speed', 'range', 'favor'];

// Whether a build can fly a route as given. sectors: in route order ({ id, letter, rankReq, x, y, z, surveyDistance });
// start: the map's starting point. { used: range the route uses, short: range missing (0: in range), tooHigh: the
// sectors above the build's rank }.
function routeCheck(sectors, start, stats, rank) {
  const used = sectors.length && start ? calc.rangeUsed(sectors, start) : null;
  return {
    used,
    short: used !== null && stats ? Math.max(0, used - stats.range) : 0,
    tooHigh: sectors.filter((s) => s.rankReq > rank).map((s) => s.id),
  };
}

// One build's numbers for the rows: its stats always; the voyage's only when it can fly the route (plan: from the
// Planner's plan, null when there is no route). flies: in range and every sector within its rank.
function rowValues(stats, plan, flies) {
  const out = {};
  for (const k of STAT_KEYS) out[k] = stats ? stats[k] : null;
  const ok = !!(stats && plan && flies && plan.hours);
  const perDay = ok ? plan.voyagesPerDay : 0;
  out.spare = ok && plan.range !== null ? stats.range - plan.range : null;
  out.hours = ok ? plan.hours : null;
  out.expPerVoyage = ok ? plan.expSure : null;
  out.expPerDay = ok ? plan.expSure * perDay : null;
  out.gilPerVoyage = ok ? plan.gilPerVoyage : null;
  out.gilPerDay = ok ? plan.gilPerDay : null;
  out.kitsPerDay = ok && plan.kitsPerVoyage !== null && plan.kitsPerVoyage !== undefined ? plan.kitsPerVoyage * perDay : null;
  out.netPerDay = ok && plan.repairGilPerDay !== null && plan.repairGilPerDay !== undefined ? plan.gilPerDay - plan.repairGilPerDay : null;
  return out;
}

// Which builds are best in each row: { key: [indices] }. Only builds with a number count; a row is marked only when
// at least two have one and they differ (all equal: nothing marked). Ties are all marked. Numbers are compared to
// a millionth, so the same figure worked out two ways still ties.
function bestMarks(valuesList) {
  const marks = {};
  const r6 = (v) => Math.round(v * 1e6) / 1e6;
  for (const row of ROWS) {
    const have = valuesList.map((v, i) => [i, v ? v[row.key] : null]).filter(([, v]) => v !== null && v !== undefined && Number.isFinite(v));
    if (have.length < 2) continue;
    const nums = have.map(([, v]) => r6(v));
    const top = row.better === 'low' ? Math.min(...nums) : Math.max(...nums);
    if (nums.every((v) => v === top)) continue;
    marks[row.key] = have.filter((_, j) => nums[j] === top).map(([i]) => i);
  }
  return marks;
}

module.exports = { MAX_BUILDS, MODES, ROWS, STAT_KEYS, routeCheck, rowValues, bestMarks };
