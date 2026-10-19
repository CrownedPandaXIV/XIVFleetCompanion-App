// Sub rank-up dates worked out voyage by voyage, the way the game gives experience: all of a voyage's
// experience arrives when it is collected. No Electron or pg here, so it can be tested on its own
// (tests/voyage-forecast.test.js); ipc/subs.js feeds it.
//
// Each voyage gives the experience of the sub's route (the sectors' ExpReward in game data) times this sub's
// bonus: what its recent voyages actually gave against what their routes give (bonusFactor). Voyages get
// shorter as the sub ranks up (speed rises with rank) and when its Sub Rules switch it to faster parts, so a
// sub that earns more and more over time is followed voyage by voyage instead of averaged.

const HOUR = 60 * 60 * 1000;
const RECENT_VOYAGES = 10;
const MIN_SAMPLES = 2;
// A collection that gave less than half or more than four times its route's experience is not one voyage on
// that route (a route change the app didn't see, or several voyages collected at once), so it is left out.
const MIN_RATIO = 0.5;
const MAX_RATIO = 4;
const MAX_VOYAGES = 5000;

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

// The experience a sub gained at each collection: total experience points ([{ at, value }], see
// rank-up.js totalExpSeries) -> [{ from, at, gained }], `from` being the collection before (or the first
// point). A drop means another sub took the slot, so only what comes after the last drop counts.
function collections(points) {
  const sorted = [...points].sort((a, b) => a.at - b.at);
  let out = [];
  let lastAt = sorted.length ? sorted[0].at : 0;
  for (let i = 1; i < sorted.length; i++) {
    const gained = sorted[i].value - sorted[i - 1].value;
    if (gained < 0) { out = []; lastAt = sorted[i].at; continue; }
    if (gained > 0) { out.push({ from: lastAt, at: sorted[i].at, gained }); lastAt = sorted[i].at; }
  }
  return out;
}

// This sub's bonus: the middle of (experience gained / its route's experience) over its last few
// collections. samples: [{ gained, base }], oldest first. null when fewer than MIN_SAMPLES are usable.
function bonusFactor(samples) {
  const ratios = samples
    .filter((s) => s.base > 0 && s.gained > 0)
    .map((s) => s.gained / s.base)
    .filter((r) => r >= MIN_RATIO && r <= MAX_RATIO)
    .slice(-RECENT_VOYAGES);
  if (ratios.length < MIN_SAMPLES) return null;
  return { factor: median(ratios), voyages: ratios.length };
}

// When the sub reaches each rank above `rank`, up to `untilRank`, voyage by voyage.
//   voyageAt(rank) -> { exp, hours } | null   one voyage sent out at that rank (its experience with the
//                                             bonus, and its length at that rank's speed and build)
//   returnAt   when the voyage out now comes back (ms): its experience arrives then, or straight away if it
//              is already back; a sub in port (no returnAt) earns its first after a whole voyage from now.
// Returns Map rank -> { at, voyages }. Ranks it doesn't reach (no voyage data, or the table runs out) are
// missing.
function forecast({ rank, exp, untilRank, expToNext, voyageAt, returnAt, now }) {
  const reached = new Map();
  let r = rank;
  let into = Number(exp) || 0;
  let current = voyageAt(r);
  if (!current || !(current.exp > 0) || !(current.hours > 0)) return reached;
  let at = returnAt ? Math.max(now, returnAt) : now + current.hours * HOUR;
  for (let n = 1; n <= MAX_VOYAGES && r < untilRank; n++) {
    into += current.exp;
    for (let step = Number(expToNext.get(r)) || 0; step > 0 && into >= step && r < untilRank; step = Number(expToNext.get(r)) || 0) {
      into -= step;
      r += 1;
      reached.set(r, { at, voyages: n });
    }
    if (!(Number(expToNext.get(r)) > 0)) break;
    // The next voyage leaves at this rank, with this rank's speed and build.
    const next = voyageAt(r);
    if (!next || !(next.exp > 0) || !(next.hours > 0)) break;
    current = next;
    at += current.hours * HOUR;
  }
  return reached;
}

module.exports = { RECENT_VOYAGES, collections, bonusFactor, forecast };
