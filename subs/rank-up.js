// Sub rank-up dates: how fast a sub gains experience and when it reaches its next rank (and the rank of
// its next build). No Electron or pg here, so it can be tested on its own (tests/rank-up.test.js).
//
// Two ways to know how fast a sub gains experience:
//   measured   from the rank and experience the plugin records over time (plugin 0.7.0 and later). It
//              includes bonus experience and time spent in port, so it is used whenever there is a day
//              or more of it.
//   calculated from game data for the route the sub is on now: the experience each sector gives
//              (SubmarineExploration.ExpReward, without bonus experience) and the voyage length worked
//              out from the sectors' positions and survey times and the sub's speed. Bonus experience
//              (up to double) is left out, so these dates are on the late side.
// The voyage length formula is the one the SubmarineTracker plugin uses (MIT licence).

const { DAY } = require('./supply-runway');

const HOUR = 60 * 60 * 1000;
const MIN_MEASURED_DAYS = 1;
const FIXED_VOYAGE_SECONDS = 12 * 60 * 60;

// Experience from rank 1 to `rank` plus what the sub has into `rank`. expToNext: Map rank -> experience
// needed to go from that rank to the next.
function totalExp(rank, exp, expToNext) {
  let total = Number(exp) || 0;
  for (let r = 1; r < rank; r++) total += Number(expToNext.get(r)) || 0;
  return total;
}

// Rank and experience points ([{ at, value }], recorded together) -> total experience over time.
function totalExpSeries(rankPoints, expPoints, expToNext) {
  const times = [...new Set([...rankPoints, ...expPoints].map((p) => p.at))].sort((a, b) => a - b);
  const latest = (points, at) => {
    let found = null;
    for (const p of points) if (p.at <= at && (!found || p.at >= found.at)) found = p;
    return found;
  };
  const out = [];
  for (const at of times) {
    const rank = latest(rankPoints, at);
    const exp = latest(expPoints, at);
    if (rank && exp) out.push({ at, value: totalExp(Number(rank.value), exp.value, expToNext) });
  }
  return out;
}

// Experience per day from total experience points: the last value at or before windowStart (if any) and
// everything after, up to `end`. A drop means the sub in that slot was replaced, so only what comes
// after the last drop counts. null when that covers less than a day.
function measuredRate(points, windowStart, end) {
  const sorted = points.filter((p) => p.at <= end).sort((a, b) => a.at - b.at);
  let first = 0;
  for (let i = 1; i < sorted.length; i++) if (sorted[i].value < sorted[i - 1].value) first = i;
  const usable = sorted.slice(first);
  if (!usable.length) return null;
  let start = usable[0];
  for (const p of usable) if (p.at <= windowStart) start = p;
  const from = Math.max(windowStart, start.at);
  const spanDays = (end - from) / DAY;
  if (spanDays < MIN_MEASURED_DAYS) return null;
  const gained = usable[usable.length - 1].value - start.value;
  return { perDay: Math.max(0, gained) / spanDays, spanDays };
}

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

// One route's voyage: { exp, hours } or null when a sector is unknown. sectors: SubmarineExploration
// rows in route order ({ id, x, y, z, expReward, surveyMinutes }); start: the map's starting point.
function voyage(sectors, start, speed) {
  if (!sectors.length || sectors.length > 5 || !start || sectors.some((s) => !s)) return null;
  const s = Math.max(1, Number(speed) || 0);
  let seconds = FIXED_VOYAGE_SECONDS;
  let previous = start;
  let exp = 0;
  for (const sector of sectors) {
    seconds += Math.floor(distance(previous, sector) * 3990 / (s * 100) * 60);
    seconds += Math.floor(sector.surveyMinutes * 7000 / (s * 100) * 60);
    exp += sector.expReward;
    previous = sector;
  }
  return { exp, hours: seconds / 3600 };
}

// The starting point of the map a sector is on: the starting point with the highest id at or below it.
function startFor(sectorId, startingPoints) {
  let found = null;
  for (const p of startingPoints) if (p.id <= sectorId && (!found || p.id > found.id)) found = p;
  return found;
}

// A measured date moved to when the sub is collected: experience is only given when a voyage is collected,
// so a sub out at sea (returnAt in the future) can't rank up before it is back. A date before its return
// becomes the return; a later one the first return after it, a voyage of `hours` at a time (as it is
// when the voyage length isn't known). A sub in port or already back keeps the date.
function atCollection(at, { returnAt, hours } = {}, now) {
  if (!(returnAt > now)) return at;
  if (at <= returnAt) return returnAt;
  if (!(hours > 0)) return at;
  return returnAt + Math.ceil((at - returnAt) / (hours * HOUR)) * hours * HOUR;
}

// When a sub reaches `targetRank`.
//   measured:  { perDay }   experience comes in at this rate from `now`, lined up with the sub's
//              collections by `out` ({ returnAt, hours }, see atCollection)
//   calculated: { exp, hours, returnAt }  experience arrives when each voyage is collected: the one
//              out now at returnAt (straight away if it is already back), then every `hours`. A sub in
//              port (no returnAt) earns its first after a whole voyage from now.
// Returns { at (ms), voyages (calculated only) }, { reached: true } when the sub is already there, or
// null when it never gets there at this rate or the rank table runs out.
function rankDate({ rank, exp, targetRank, expToNext, measured, calculated, out, now }) {
  if (rank >= targetRank) return { reached: true };
  let needed = -Number(exp || 0);
  for (let r = rank; r < targetRank; r++) {
    const step = Number(expToNext.get(r)) || 0;
    if (!step) return null;
    needed += step;
  }
  if (measured) {
    if (!(measured.perDay > 0)) return null;
    return { at: atCollection(now + (needed / measured.perDay) * DAY, out, now) };
  }
  if (calculated && calculated.exp > 0 && calculated.hours > 0) {
    const voyages = Math.max(1, Math.ceil(needed / calculated.exp));
    const firstReturn = !calculated.returnAt ? now + calculated.hours * HOUR : Math.max(now, calculated.returnAt);
    return { at: firstReturn + (voyages - 1) * calculated.hours * HOUR, voyages };
  }
  return null;
}

// The highest rank the rank table goes to (the first with no experience to the next).
function maxRank(expToNext) {
  let r = 1;
  while (Number(expToNext.get(r)) > 0) r++;
  return r;
}

// The first rank above `rank` (up to maxRank) at which buildAt(r) gives a different build, or null.
function nextBuildRank(rank, top, buildAt) {
  const key = (b) => (b ? b.join('-') : '');
  const now = key(buildAt(rank));
  for (let r = rank + 1; r <= top; r++) {
    const next = buildAt(r);
    if (next && key(next) !== now) return { rank: r, build: next };
  }
  return null;
}

module.exports = {
  MIN_MEASURED_DAYS, totalExp, totalExpSeries, measuredRate, voyage, startFor, atCollection, rankDate, maxRank, nextBuildRank,
};
