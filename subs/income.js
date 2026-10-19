// Real income against expected: what a character's subs actually brought in over the last few days,
// next to what Fight Club says their routes should earn (the Subs tab's Current Gil/Day). No Electron or
// pg here, so it can be tested on its own (tests/income.test.js).
//
// Real net income = salvage that came in, at its vendor price, minus the repair kits used, at the
// repair kit cost. Salvage that came in is every rise in a character's count of each salvage piece
// (bags and retainers, recorded by the plugin); a drop is salvage sold or moved and is not income.
// Gil itself is not used: it moves for too many other reasons (buying supplies, selling the same
// salvage that was already counted when it came in).
//
// Two kinds of rise are not income (plugin 0.9.1 records what is needed; older history counts them):
//   - salvage taken out of the character's FC chest: a rise matched by a drop of the same piece in the
//     chest in the same sync (the plugin writes both at the same moment);
//   - items stored for the first time (a retainer first seen on a PC): a rise in the same sync as a rise
//     in inventory_sources.
// Repair kits used come from the kits held in bags and retainers (item_qty:10373) when that history
// covers the window, so kits moved to a retainer are not counted as used.

const { DAY, MIN_SPAN_DAYS, changesInWindow } = require('./supply-runway');

const DEFAULT_WINDOW_DAYS = 7;
// Below these shares of expected, a character is shown amber, then red.
const WARN_SHARE = 0.9;
const DANGER_SHARE = 0.75;

// Each rise in `points` inside the window, as [{ at, amount }] (see changesInWindow).
function risesInWindow(points, windowStart, end) {
  const sorted = points.filter((p) => p.at <= end).sort((a, b) => a.at - b.at);
  const rises = [];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].at <= windowStart) continue;
    const change = Number(sorted[i].value) - Number(sorted[i - 1].value);
    if (change > 0) rises.push({ at: sorted[i].at, amount: change });
  }
  return rises;
}

// Drops of each piece in an FC chest, as Map `${itemId}|${at}` -> how many left the chest then. Shared by
// the FC's characters, so one drop is matched to one rise only (the match takes what it uses).
function chestDrops(chestSalvage) {
  const drops = new Map();
  for (const [itemId, points] of chestSalvage || new Map()) {
    const sorted = [...points].sort((a, b) => a.at - b.at);
    for (let i = 1; i < sorted.length; i++) {
      const fell = Number(sorted[i - 1].value) - Number(sorted[i].value);
      if (fell > 0) drops.set(`${itemId}|${sorted[i].at}`, fell);
    }
  }
  return drops;
}

// Times at which inventory_sources went up (items stored for a new source).
function sourceRises(points) {
  const sorted = [...(points || [])].sort((a, b) => a.at - b.at);
  const times = new Set();
  for (let i = 1; i < sorted.length; i++) if (Number(sorted[i].value) > Number(sorted[i - 1].value)) times.add(sorted[i].at);
  return times;
}

// The repair kit history to use: the kits in bags and retainers when it covers `from` (it starts at or
// before it), otherwise the kits in the character's bags.
function kitSeries(kits, kitsTotal, from) {
  if (kitsTotal && kitsTotal.some((p) => p.at <= from)) return kitsTotal;
  return kits || [];
}

// One character's income over a window.
//   salvage:  Map itemId -> points ([{ at, value }], as for changesInWindow)
//   kits:     repair kit points
//   prices:   { itemId: gil }
//   kitCost:  gil per repair kit (0 when not set)
//   expectedPerDay: the subs' Current Gil/Day added up (null when none of them matches Fight Club)
//   drops:    the FC chest's drops (chestDrops), shared by the FC's characters; optional
//   sources:  inventory_sources points; optional
//   kitsTotal: item_qty:10373 points (kits in bags and retainers); optional
// The window runs from the start of the salvage history (or windowStart, whichever is later) to `end`,
// and the repair kits and the expected figure cover that same stretch.
function characterIncome({ salvage, kits, prices, kitCost, expectedPerDay, windowStart, end, drops, sources, kitsTotal }) {
  const starts = [];
  for (const points of salvage.values()) {
    const first = points.filter((p) => p.at <= end).reduce((min, p) => Math.min(min, p.at), Infinity);
    if (first !== Infinity) starts.push(first);
  }
  const from = starts.length ? Math.max(windowStart, Math.min(...starts)) : end;
  const spanDays = (end - from) / DAY;
  const expected = expectedPerDay === null || expectedPerDay === undefined ? null : expectedPerDay;
  if (spanDays < MIN_SPAN_DAYS) {
    return { enough: false, spanDays, expectedPerDay: expected };
  }

  let pieces = 0;
  let salvageGil = 0;
  let fromChest = 0;
  let firstStored = 0;
  const newSources = sourceRises(sources);
  for (const [itemId, points] of salvage) {
    for (const rise of risesInWindow(points, from, end)) {
      if (newSources.has(rise.at)) {
        firstStored += rise.amount;
        continue;
      }
      const key = `${itemId}|${rise.at}`;
      const matched = Math.min(rise.amount, (drops && drops.get(key)) || 0);
      if (matched) drops.set(key, drops.get(key) - matched);
      fromChest += matched;
      pieces += rise.amount - matched;
      salvageGil += (rise.amount - matched) * (prices[itemId] || 0);
    }
  }
  const kitsUsed = changesInWindow(kitSeries(kits, kitsTotal, from), from, end).fell;
  const kitGil = kitsUsed * kitCost;
  const net = salvageGil - kitGil;
  const perDay = net / spanDays;
  const share = expected > 0 ? perDay / expected : null;
  return {
    enough: true,
    spanDays,
    pieces,
    fromChest,
    firstStored,
    salvageGil,
    kitsUsed,
    kitGil,
    net,
    perDay,
    salvagePerDay: salvageGil / spanDays,
    kitPerDay: kitGil / spanDays,
    expectedPerDay: expected,
    expected: expected === null ? null : expected * spanDays,
    differencePerDay: expected === null ? null : perDay - expected,
    share,
  };
}

// 'income-danger' under 75% of expected, 'income-warn' under 90%, '' otherwise.
function shareClass(share) {
  if (typeof share !== 'number') return '';
  if (share < DANGER_SHARE) return 'income-danger';
  if (share < WARN_SHARE) return 'income-warn';
  return '';
}

module.exports = { DEFAULT_WINDOW_DAYS, WARN_SHARE, DANGER_SHARE, characterIncome, shareClass, chestDrops, kitSeries };
