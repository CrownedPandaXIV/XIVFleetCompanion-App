// Days until empty: how fast a character uses ceruleum and repair kits, from the values recorded over
// time (companion_metric_history: a row when a value changes, plus an hourly reminder), how long what it
// has will last, and how many to buy to last a chosen number of days. No Electron or pg here, so it can
// be tested on its own (tests/supply-runway.test.js).

const DAY = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_DAYS = 14;
const DEFAULT_TARGET_DAYS = 14;
const WINDOW_CHOICES = [3, 7, 14, 30];
// Less history than this and the rate is not trusted.
const MIN_SPAN_DAYS = 1;

// Every rise and every drop within a window. points: [{ at (ms), value }]: the last value recorded at
// or before the window start (if any) and everything after it, up to `end` (the character's last sync).
// The window really starts at its start or the first point, whichever is later (spanDays).
function changesInWindow(points, windowStart, end) {
  const sorted = points.filter((p) => p.at <= end).sort((a, b) => a.at - b.at);
  if (!sorted.length) return { rose: 0, fell: 0, spanDays: 0 };
  const from = Math.max(windowStart, sorted[0].at);
  let rose = 0;
  let fell = 0;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].at <= windowStart) continue; // both before the window: not part of it
    const change = Number(sorted[i].value) - Number(sorted[i - 1].value);
    if (change > 0) rose += change;
    else fell -= change;
  }
  return { rose, fell, spanDays: (end - from) / DAY };
}

// Use per day over a window (see changesInWindow). Every drop counts as use; a rise is a restock and
// is ignored. Returns { perDay, spanDays, used } or { perDay: null, ... } when the history covers less
// than MIN_SPAN_DAYS.
function usageRate(points, windowStart, end) {
  const { fell: used, spanDays } = changesInWindow(points, windowStart, end);
  if (spanDays < MIN_SPAN_DAYS) return { perDay: null, spanDays, used };
  return { perDay: used / spanDays, spanDays, used };
}

// How long `have` lasts at `perDay`, and roughly when it runs out (from `asOf`, the last sync).
//   { days: number | Infinity | null, runsOutAt: ms | null }  (null: not enough history)
function runway(have, perDay, asOf) {
  if (perDay === null || perDay === undefined) return { days: null, runsOutAt: null };
  if (perDay <= 0) return { days: Infinity, runsOutAt: null };
  const days = Math.max(0, Number(have)) / perDay;
  return { days, runsOutAt: asOf + days * DAY };
}

// How many to buy so `have` lasts `targetDays` at `perDay` (0 when it already does or nothing is used).
function restockAmount(have, perDay, targetDays) {
  if (!(perDay > 0)) return 0;
  return Math.max(0, Math.ceil(perDay * targetDays - Number(have)));
}

const clampDays = (value, fallback, max) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 && n <= max ? Math.round(n) : fallback;
};

module.exports = {
  DAY, DEFAULT_WINDOW_DAYS, DEFAULT_TARGET_DAYS, WINDOW_CHOICES, MIN_SPAN_DAYS,
  changesInWindow, usageRate, runway, restockAmount, clampDays,
};
