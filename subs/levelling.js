// The Sub Calculator's Levelling Plan: a sub's way from its rank to a target rank, voyage by voyage, each voyage on
// the route best for experience an hour at the rank it leaves at (as the Route Finder ranks them), the experience
// arriving when it's back and carrying over into the next rank as the game does. Voyages on the same route with the
// same parts make a stage. With suggestions on, a part swap is offered where it makes the route being run that much
// faster (or reach a better one). No game data or database here: the caller passes the searches in. The plugin's
// Levelling.cs is the same, checked against this through tests/db/calculator-fixture.js.

const calc = require('./calculator');
const routeFinder = require('./route-finder');
const { buildStats } = require('./submarine-builds');

const CLASS_OF = { W: 1, U: 2, S: 3, C: 4, Y: 5, 'W+': 6, 'U+': 7, 'S+': 8, 'C+': 9, 'Y+': 10 };
const MAX_VOYAGES = 3000;
const MIN_GAIN = 0.03; // a swap is suggested only for at least 3% more experience an hour
const MAX_SWAPS = 4;
const STANDARD = ['S', 'U', 'W', 'C', 'Y'];
const ALL_PARTS = ['S', 'U', 'W', 'C', 'Y', 'S+', 'U+', 'W+', 'C+', 'Y+'];

const routeKey = (r) => r.route.join('-');

// The plan with the parts each rank uses. rank, exp: where the sub is (exp: into this rank); target: the rank to reach;
// expToNext: Map rank -> experience to the next; partsAt(rank) -> [4 letters]; bestAt(rank, parts) -> the voyage it
// would run: { route: [ids], hours, exp, expPerHour, range, tanks, kits } or null when nothing fits.
// { stages: [{ fromRank, toRank, route, parts, voyages, hours, expPerVoyage, expPerHour, tanks, kits }], voyages, hours,
//   tanks, kits, expNeeded, reached, stuckAt }
function simulate({ rank, exp = 0, target, expToNext, partsAt, bestAt }) {
  const stages = [];
  let r = Number(rank);
  let into = Number(exp) || 0;
  let expNeeded = -into;
  for (let k = r; k < target; k++) expNeeded += Number(expToNext.get(k)) || 0;
  let stuckAt = null;
  for (let n = 0; n < MAX_VOYAGES && r < target; n++) {
    const parts = partsAt(r);
    const best = bestAt(r, parts);
    if (!best || !(best.exp > 0) || !(best.hours > 0)) { stuckAt = r; break; }
    const last = stages[stages.length - 1];
    let stage = last && routeKey(last) === routeKey(best) && last.parts.join() === parts.join() ? last : null;
    if (!stage) {
      stage = { fromRank: r, toRank: r, route: best.route, parts: parts.slice(), voyages: 0, hours: 0, expPerVoyage: best.exp, expPerHour: best.expPerHour, tanks: 0, kits: 0 };
      stages.push(stage);
    }
    stage.voyages += 1;
    stage.hours += best.hours;
    stage.tanks += best.tanks || 0;
    stage.kits += best.kits || 0;
    into += best.exp;
    for (let step = Number(expToNext.get(r)) || 0; step > 0 && into >= step && r < target; step = Number(expToNext.get(r)) || 0) {
      into -= step;
      r += 1;
    }
    stage.toRank = r;
    if (!(Number(expToNext.get(r)) > 0) && r < target) { stuckAt = r; break; }
  }
  const sum = (k) => stages.reduce((s, x) => s + x[k], 0);
  return { stages, voyages: sum('voyages'), hours: sum('hours'), tanks: sum('tanks'), kits: sum('kits'), expNeeded: Math.max(0, expNeeded), reached: r >= target, stuckAt };
}

// The parts at each rank: the build, with each swap from its rank on. swaps: [{ atRank, slot, to }] in rank order.
function partsWith(parts, swaps) {
  return (rank) => {
    const out = parts.slice();
    for (const s of swaps) if (rank >= s.atRank) out[s.slot] = s.to;
    return out;
  };
}

// The plan, and with suggestions the part swaps on the way. At the start of each stage, and at each rank a part can
// first be fitted from, every one-part swap (Standard parts only when standardOnly; only parts the sub's rank allows,
// partRank(letter, slot) -> the rank it needs) is scored on the route being run there (score(rank, parts, route) ->
// experience an hour on that route, null when it can't fly it); the best, at least MIN_GAIN better, is taken from that
// rank on, and the plan worked out again. owned: Set "letter|slot" of parts the player has. Each swap says how many
// hours it saves.
// { ...simulate's answer, swaps: [{ atRank, slot, from, to, owned, gain, savedHours }], keepHours }
function levellingPlan({ rank, exp, target, expToNext, parts, bestAt, score = null, suggest = false, standardOnly = false, owned = new Set(), partRank = () => 0 }) {
  const keep = simulate({ rank, exp, target, expToNext, partsAt: () => parts, bestAt });
  if (!suggest || !score) return { ...keep, swaps: [], keepHours: keep.hours };
  const letters = standardOnly ? STANDARD : ALL_PARTS;
  // The ranks a part becomes possible at, on the way.
  const opens = new Set();
  for (const to of letters) for (let slot = 0; slot < 4; slot++) { const r = Number(partRank(to, slot)) || 0; if (r > rank && r < target) opens.add(r); }
  const swaps = [];
  let plan = keep;
  let after = -Infinity; // the last rank looked at
  while (swaps.length < MAX_SWAPS) {
    const points = [...new Set([...plan.stages.map((st) => st.fromRank), ...opens])].filter((r) => r > after && r < target).sort((a, b) => a - b);
    if (!points.length) break;
    const at = points[0];
    after = at;
    // The stage being run at that rank.
    let stage = null;
    for (const st of plan.stages) if (st.fromRank <= at) stage = st;
    if (!stage) continue;
    const now = partsWith(parts, swaps)(at);
    const base = score(at, now, stage.route);
    let pick = null;
    if (base) {
      for (let slot = 0; slot < 4; slot++) {
        for (const to of letters) {
          if (to === now[slot] || (Number(partRank(to, slot)) || 0) > at) continue;
          const tried = now.slice();
          tried[slot] = to;
          const v = score(at, tried, stage.route);
          if (v === null || v === undefined) continue;
          const gain = v / base - 1;
          const isOwned = owned.has(`${to}|${slot}`);
          // The most gain; on a tie, a part you own, then the earlier slot and letter.
          if (gain >= MIN_GAIN && (!pick || gain > pick.gain + 1e-9 || (Math.abs(gain - pick.gain) <= 1e-9 && isOwned && !pick.owned))) {
            pick = { atRank: at, slot, from: now[slot], to, owned: isOwned, gain };
          }
        }
      }
    }
    if (!pick) continue;
    const next = simulate({ rank, exp, target, expToNext, partsAt: partsWith(parts, [...swaps, pick]), bestAt });
    // Kept only when the whole plan gets shorter (a faster route now can't make a later stage slower than it saves).
    if (!(next.reached && (!plan.reached || next.hours < plan.hours - 1e-9))) continue;
    pick.savedHours = plan.hours - next.hours;
    swaps.push(pick);
    plan = next;
  }
  return { ...plan, swaps, keepHours: keep.hours };
}

// The rank each part needs, from the game's parts ([{ class, slot, rank }]): (letter, slot) -> rank (0 when unknown).
function partRanks(gameParts) {
  const byKey = new Map((gameParts || []).map((p) => [`${p.class}|${p.slot}`, Number(p.rank) || 0]));
  return (letter, slot) => byKey.get(`${CLASS_OF[letter]}|${slot}`) || 0;
}

// The searches over every map, for one FC's reading (Map id -> { unlocked, explored }; null: every sector) and a longest
// voyage (null: any). game: as ipc/calculator.js loads it ({ sectors, startingPoints, maps, stats, parts }); prices: Map:
// bestAt(rank, parts) -> the voyage best for experience an hour at that rank ({ route, hours, exp, expPerHour, range,
// tanks, kits }, or null), and score(rank, parts, route) -> experience an hour on that route (null if it can't fly it).
// A route search is kept for whatever doesn't change it (the sectors allowed, speed, range, each sector's experience),
// so ranks that change none of these don't search again.
function searches({ game, data, prices, repairKitCost, read, maxHours }) {
  const dataOf = new Map(data.sectors.map((d) => [d.id, d]));
  const openerOf = new Map([...game.sectors.keys()].map((id) => [id, dataOf.has(id) ? Number(dataOf.get(id).unlockedFrom) || 0 : 0]));
  const states = routeFinder.sectorStates([...game.sectors.keys()], read, openerOf);
  const opens = routeFinder.opensOf(openerOf);
  const maps = game.maps.slice().sort((a, b) => a.id - b.id).map((m) => [...game.sectors.values()].filter((x) => x.map === m.id).sort((a, b) => a.id - b.id)).filter((l) => l.length);
  // A map's search, kept for whatever doesn't change it: { route (the best, or null), below } where below: the rate it
  // was asked to beat when it found none at least that good (0: the true best).
  const searches = new Map();
  const answers = new Map();
  let lead = null; // the map that gave the last answer, searched first so the others can stop sooner
  const bestAt = (rank, parts) => {
    const key = `${rank}|${parts.join(',')}`;
    if (answers.has(key)) return answers.get(key);
    const stats = buildStats(rank, parts, game.stats.rankStatsById, game.stats.partStatsByClassSlot);
    let best = null;
    let bestIndex = -1;
    if (stats) {
      // The maps in their order, the last answer's first; the answer is the same as in map order (a later map only
      // wins when it is better, an earlier one when it is at least as good).
      const order = maps.map((m, i) => i);
      if (lead !== null) { order.splice(order.indexOf(lead), 1); order.unshift(lead); }
      for (const i of order) {
        const onMap = maps[i];
        const allowed = routeFinder.usableSectors({ onMap, rank, states });
        if (!allowed.length) continue;
        const values = new Map(allowed.map((x) => [x.id, routeFinder.sectorValue(x, dataOf.get(x.id), stats, prices)]));
        const searchKey = `${onMap[0].map}|${allowed.map((x) => x.id).join(',')}|${stats.speed}|${stats.range}|${allowed.map((x) => values.get(x.id).exp).join(',')}`;
        // To matter here, this map's route must beat the best so far (or tie it, from an earlier map).
        const atLeast = best ? best.expPerHour * (1 - 1e-6) : 0;
        const was = searches.get(searchKey);
        let r;
        if (was && (was.below === 0 || was.below <= atLeast)) r = was.route;
        else {
          const found = routeFinder.findRoutes({ sectors: allowed, start: calc.startFor(onMap[0].id, game.startingPoints), stats, maxStops: 5, maxHours, values, rankBy: 'exp', opens, states, bestOnly: true, atLeast })[0] || null;
          const sure = found && found.expPerHour >= atLeast;
          r = sure ? found : null;
          searches.set(searchKey, { route: r, below: sure || atLeast === 0 ? 0 : atLeast });
        }
        if (r && (!best || r.expPerHour > best.expPerHour + 1e-9 || (Math.abs(r.expPerHour - best.expPerHour) <= 1e-9 && i < bestIndex))) { best = r; bestIndex = i; }
      }
    }
    if (best) lead = bestIndex;
    let answer = null;
    if (best) {
      const p = calc.plan({ route: best.route, stats, partClasses: parts.map((l) => CLASS_OF[l]), game, data, prices, repairKitCost });
      answer = { route: best.route, hours: best.hours, exp: best.exp, expPerHour: best.expPerHour, range: best.range,
        tanks: best.route.reduce((s, id) => s + (game.sectors.get(id).tanks || 0), 0), kits: p && p.kitsPerVoyage !== null ? p.kitsPerVoyage : 0 };
    }
    answers.set(key, answer);
    return answer;
  };
  const score = (rank, parts, route) => {
    const stats = buildStats(rank, parts, game.stats.rankStatsById, game.stats.partStatsByClassSlot);
    const sectors = route.map((id) => game.sectors.get(id));
    if (!stats || !sectors.length || sectors.some((x) => !x || x.rankReq > rank)) return null;
    const start = calc.startFor(sectors[0].id, game.startingPoints);
    if (calc.rangeUsed(sectors, start) > stats.range) return null;
    let seconds = 12 * 3600;
    let exp = 0;
    let at = start;
    for (const x of sectors) { seconds += routeFinder.leg(at, x, stats.speed).seconds; exp += routeFinder.sectorValue(x, dataOf.get(x.id), stats, prices).exp; at = x; }
    if (maxHours && seconds > maxHours * 3600) return null;
    return exp / (seconds / 3600);
  };
  return { bestAt, score, states };
}

// Each stage of a plan made through an FC's reading (read: Map id -> { unlocked }), told when a sector it hasn't
// discovered yet would give a better route at that rank (every: searches() with every sector):
// stage.better = { route, expPerHour, missing: [ids] } or null.
function markBetter(plan, every, read) {
  for (const st of plan.stages) {
    const better = every ? every.bestAt(st.fromRank, st.parts) : null;
    const missing = better ? better.route.filter((id) => !(read.get(id) || {}).unlocked) : [];
    st.better = better && missing.length && better.expPerHour > st.expPerHour * 1.0001 ? { route: better.route, expPerHour: better.expPerHour, missing } : null;
  }
  return plan;
}

// Every sub's plan for one request (ipc/calculator.js, run in subs/levelling-worker.js so a newer request can stop it).
// job: { game (with expToNext), data, prices, repairKitCost, read (Map id -> { unlocked, explored }, or null), maxHours,
// suggest, standardOnly, subs: [{ key, rank, exp, target, parts, owned: ['letter|slot'] }] } -> [{ key, rank, target, ...plan }]
function plansFor(job) {
  const { game, read } = job;
  const searchFor = (r) => searches({ game, data: job.data, prices: job.prices, repairKitCost: job.repairKitCost, read: r, maxHours: job.maxHours });
  const search = searchFor(read);
  const every = read ? searchFor(null) : null;
  const partRank = partRanks(game.parts);
  return job.subs.map((s) => {
    const plan = levellingPlan({ rank: s.rank, exp: s.exp, target: s.target, expToNext: game.expToNext, parts: s.parts, bestAt: search.bestAt, score: search.score,
      suggest: !!job.suggest, standardOnly: !!job.standardOnly, owned: new Set(s.owned || []), partRank });
    if (read) markBetter(plan, every, read);
    return { key: s.key, rank: s.rank, target: s.target, ...plan };
  });
}

module.exports = { plansFor, searches, markBetter, partRanks, MAX_VOYAGES, MIN_GAIN, MAX_SWAPS, STANDARD, ALL_PARTS, simulate, partsWith, levellingPlan };
