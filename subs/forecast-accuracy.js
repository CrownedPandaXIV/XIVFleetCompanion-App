// How close the Next Rank dates came to when subs actually ranked up. The app saves each sub's Next Rank
// date once an hour (ipc/subs.js, companion_rankup_forecast); here those are matched with the rank-ups the
// plugin recorded. No Electron or pg here, so it can be tested on its own (tests/forecast-accuracy.test.js).
//
// A date worked out a few minutes before a sub comes back is right by then, so the average only counts dates
// worked out at least a day before the rank-up.

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const AHEAD = DAY;
const KEEP_DAYS = 30;
const RECENT = 20;

// When each rank was reached, from the sub's recorded rank ([{ at, value }]) and the return times of its
// voyages (ms; SubmarineTracker's loot, may be empty): [{ rank, at }]. A rank counts from the return of the
// voyage collected just before it was recorded, else from when it was recorded. A drop means another sub
// took the slot, so only what comes after counts.
function rankUps(points, returns = []) {
  const sorted = [...points].sort((a, b) => a.at - b.at);
  let out = [];
  for (let i = 1; i < sorted.length; i++) {
    const before = Number(sorted[i - 1].value);
    const after = Number(sorted[i].value);
    if (after < before) { out = []; continue; }
    if (after === before) continue;
    const back = returns.filter((t) => t > sorted[i - 1].at && t <= sorted[i].at);
    const at = back.length ? Math.max(...back) : sorted[i].at;
    for (let rank = before + 1; rank <= after; rank++) out.push({ rank, at });
  }
  return out;
}

// One sub's rank-ups against its saved dates ([{ rank, madeAt, predictedAt }]): for each rank-up with a
// date saved before it, the one worked out closest to a day before (the latest at least a day before; else
// the earliest there is). [{ rank, at, predictedAt, madeAt, off }], off > 0 when it came later than said.
function checkSub(predictions, ups) {
  const out = [];
  for (const up of ups) {
    const before = predictions.filter((p) => p.rank === up.rank && p.madeAt < up.at && p.madeAt >= up.at - KEEP_DAYS * DAY);
    if (!before.length) continue;
    const dayAhead = before.filter((p) => up.at - p.madeAt >= AHEAD);
    const pick = dayAhead.length
      ? dayAhead.reduce((a, b) => (b.madeAt > a.madeAt ? b : a))
      : before.reduce((a, b) => (b.madeAt < a.madeAt ? b : a));
    out.push({ rank: up.rank, at: up.at, predictedAt: pick.predictedAt, madeAt: pick.madeAt, off: up.at - pick.predictedAt });
  }
  return out;
}

// The line on the Subs tab: checks (from checkSub, with whatever names were added), newest first.
// { count, averageOff, checks } where count and averageOff (ms, how far off on average, early or late)
// cover the last RECENT rank-ups with a date from a day or more before; checks lists the last RECENT of all.
function summarize(checks) {
  const newest = [...checks].sort((a, b) => b.at - a.at);
  const counted = newest.filter((c) => c.at - c.madeAt >= AHEAD).slice(0, RECENT);
  const averageOff = counted.length ? counted.reduce((sum, c) => sum + Math.abs(c.off), 0) / counted.length : null;
  return { count: counted.length, averageOff, checks: newest.slice(0, RECENT) };
}

module.exports = { AHEAD, KEEP_DAYS, rankUps, checkSub, summarize };
