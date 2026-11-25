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
const MIN_GAIN = 0.03; // a swap is looked at only for at least 3% more experience an hour
// No cap on swaps (1.13.4: the fewest days): every swap that makes the plan shorter. This many at most, only so a plan
// that kept finding hours to save can't run on.
const MAX_SWAPS = 24;
// The chance each sector on a voyage opens each sector it leads to (Pepper's guide: 20-30%), unless the page says
// otherwise. The plan counts on the expected visits: at 25%, a sector opens on the 4th voyage through the one before it.
const UNLOCK_CHANCE = 0.25;
// How far ahead (ranks) the plan starts opening a sector a later stage will want, tried in turn; the shortest plan wins.
// null: no voyages just to open sectors (it still opens what its routes pass); Infinity: as soon as it can. (Measured on
// the game data: 0, 5, 15 and 40 ranks ahead made the same plans as Infinity, or within 1%.)
const LOOKAHEADS = [null, Infinity];
const STANDARD = ['S', 'U', 'W', 'C', 'Y'];
const ALL_PARTS = ['S', 'U', 'W', 'C', 'Y', 'S+', 'U+', 'W+', 'C+', 'Y+'];

const routeKey = (r) => r.route.join('-');

// The plan with the parts each rank uses. rank, exp: where the sub is (exp: into this rank); target: the rank to reach;
// expToNext: Map rank -> experience to the next; partsAt(rank) -> [4 letters]; bestAt(rank, parts, open, must) -> the
// voyage it would run: { route: [ids], hours, exp, expPerHour, range, tanks, kits } or null when nothing fits (open:
// the sectors it may use, { set, key }, or null for the searches' own; must: a sector the route has to go to).
// unlock (only through an FC's reading): { open: Set of the sectors discovered, chance, opens: Map id -> [ids it leads
// to], openerOf: Map id -> the sector it opens from, rankOf: Map id -> rank needed, targets: [[id, rank]] the sectors
// the plan with every sector uses and from which rank, lookahead: ranks ahead (null: none) }. Each voyage then gives
// every sector its route passes a chance at each sector it leads to; one opens once its chances add up to a whole
// (expected visits). When a target is due within the lookahead and isn't open, the voyage goes on the best route through
// the open sector its chain starts from.
// { stages: [{ fromRank, toRank, route, parts, voyages, hours, exp, expPerVoyage, expPerHour (the stage's averages), tanks,
//   kits, discovers: [ids it opens], toOpen: { via, next, target } | null, openAt }], voyages, hours, tanks, kits, expNeeded,
//   reached, stuckAt, stuckOpen }
const keyOf = (set) => [...set].sort((a, b) => a - b).join(',');
function simulate({ rank, exp = 0, target, expToNext, partsAt, bestAt, unlock = null }) {
  const stages = [];
  let r = Number(rank);
  let into = Number(exp) || 0;
  let expNeeded = -into;
  for (let k = r; k < target; k++) expNeeded += Number(expToNext.get(k)) || 0;
  let stuckAt = null;
  const open = unlock ? new Set(unlock.open) : null;
  // What's open now, as a stage and the searches see it: a copy, as `open` keeps growing.
  let openNow = unlock ? { set: new Set(open), key: keyOf(open) } : null;
  const progress = new Map();
  for (let n = 0; n < MAX_VOYAGES && r < target; n++) {
    const parts = partsAt(r);
    let best = bestAt(r, parts, openNow);
    let toOpen = null;
    if (unlock && unlock.lookahead !== null && unlock.lookahead !== undefined) {
      for (const [t, need] of unlock.targets) {
        if (open.has(t) || need > r + unlock.lookahead) continue;
        // The open sector its chain starts from, and the next one along it.
        let x = t;
        let next = t;
        for (let guard = 0; x && !open.has(x) && guard < 300; guard++) { next = x; x = unlock.openerOf.get(x) || 0; }
        if (!x || !open.has(x) || (unlock.rankOf.get(x) || 0) > r) continue;
        if (best && best.route.includes(x)) break; // its route passes it already
        const via = bestAt(r, parts, openNow, x);
        if (via) { best = via; toOpen = { via: x, next, target: t }; }
        break;
      }
    }
    if (!best || !(best.exp > 0) || !(best.hours > 0)) { stuckAt = r; break; }
    const last = stages[stages.length - 1];
    const same = last && routeKey(last) === routeKey(best) && last.parts.join() === parts.join() && (last.toOpen ? last.toOpen.via : null) === (toOpen ? toOpen.via : null);
    let stage = same ? last : null;
    if (!stage) {
      stage = { fromRank: r, toRank: r, route: best.route, parts: parts.slice(), voyages: 0, hours: 0, exp: 0, expPerVoyage: 0, expPerHour: 0, tanks: 0, kits: 0,
        discovers: [], toOpen, openAt: openNow };
      stages.push(stage);
    }
    stage.voyages += 1;
    stage.hours += best.hours;
    // The stage's own averages: experience a voyage still grows with rank inside a stage.
    stage.exp += best.exp;
    stage.expPerVoyage = stage.exp / stage.voyages;
    stage.expPerHour = stage.exp / stage.hours;
    stage.tanks += best.tanks || 0;
    stage.kits += best.kits || 0;
    if (unlock) {
      let changed = false;
      for (const id of best.route) {
        for (const t of unlock.opens.get(id) || []) {
          if (open.has(t)) continue;
          const p = (progress.get(t) || 0) + unlock.chance;
          if (p >= 1 - 1e-9) { open.add(t); progress.delete(t); stage.discovers.push(t); changed = true; } else progress.set(t, p);
        }
      }
      if (changed) openNow = { set: new Set(open), key: keyOf(open) };
    }
    into += best.exp;
    for (let step = Number(expToNext.get(r)) || 0; step > 0 && into >= step && r < target; step = Number(expToNext.get(r)) || 0) {
      into -= step;
      r += 1;
    }
    stage.toRank = r;
    if (!(Number(expToNext.get(r)) > 0) && r < target) { stuckAt = r; break; }
  }
  const sum = (k) => stages.reduce((s, x) => s + x[k], 0);
  return { stages, voyages: sum('voyages'), hours: sum('hours'), tanks: sum('tanks'), kits: sum('kits'), expNeeded: Math.max(0, expNeeded), reached: r >= target, stuckAt, stuckOpen: openNow };
}

// The parts at each rank: the build, with each swap from its rank on. swaps: [{ atRank, slot, to }] in rank order.
function partsWith(parts, swaps) {
  return (rank) => {
    const out = parts.slice();
    for (const s of swaps) if (rank >= s.atRank) out[s.slot] = s.to;
    return out;
  };
}

// The plan, and with suggestions the part swaps on the way: the one with the fewest hours found.
// Each swap is one part changed from a rank on. At the start of each stage, and at each rank a part can first be fitted
// from, every one-part swap (Standard parts only when standardOnly; only parts the sub's rank allows, partRank(letter,
// slot) -> the rank it needs) is looked at two ways: on the route being run there (score(rank, parts, route) ->
// experience an hour, null when it can't fly it) and on the best route the new parts allow (bestAt). The best of each
// way, at least MIN_GAIN better, has the whole plan worked out with it; the shorter is kept when it makes the plan
// shorter, and the next ranks looked at after it. owned: Set "letter|slot" of parts the player has. Each swap says
// how many hours it saves. unlock: as simulate's, without lookahead: each way of opening sectors ahead (LOOKAHEADS) is
// tried and the shortest kept.
// { ...simulate's answer, swaps: [{ atRank, slot, from, to, owned, gain, savedHours }], keepHours, lookahead }
function levellingPlan({ rank, exp, target, expToNext, parts, bestAt, score = null, suggest = false, standardOnly = false, owned = new Set(), partRank = () => 0,
  unlock = null }) {
  const better = (a, b) => !b || (a.reached && !b.reached) || (a.reached === b.reached && a.hours < b.hours - 1e-9);
  // The way of opening sectors ahead that makes the build's own plan shortest.
  let lookahead = null;
  let keep = null;
  for (const la of unlock ? LOOKAHEADS : [null]) {
    const tried = simulate({ rank, exp, target, expToNext, partsAt: () => parts, bestAt, unlock: unlock ? { ...unlock, lookahead: la } : null });
    if (better(tried, keep)) { keep = tried; lookahead = la; }
  }
  const sim = (swaps) => simulate({ rank, exp, target, expToNext, partsAt: partsWith(parts, swaps), bestAt, unlock: unlock ? { ...unlock, lookahead } : null });
  if (!suggest) return { ...keep, swaps: [], keepHours: keep.hours, lookahead };
  const letters = standardOnly ? STANDARD : ALL_PARTS;
  // The ranks a part becomes possible at, on the way.
  const opens = new Set();
  for (const to of letters) for (let slot = 0; slot < 4; slot++) { const r = Number(partRank(to, slot)) || 0; if (r > rank && r < target) opens.add(r); }
  const swaps = [];
  let plan = keep;
  // A plan stuck where its parts can't fly any route: the one-part swap at that rank that gets it to the target
  // soonest, if any does.
  if (plan.stuckAt !== null && !plan.reached) {
    const at = plan.stuckAt;
    const now = partsWith(parts, swaps)(at);
    let pick = null;
    let pickPlan = null;
    for (let slot = 0; slot < 4; slot++) {
      for (const to of letters) {
        if (to === now[slot] || (Number(partRank(to, slot)) || 0) > at) continue;
        const tried = now.slice();
        tried[slot] = to;
        if (!bestAt(at, tried, plan.stuckOpen)) continue;
        const swap = { atRank: at, slot, from: now[slot], to, owned: owned.has(`${to}|${slot}`), gain: null };
        const next = sim([swap]);
        if (!next.reached) continue;
        if (!pickPlan || next.hours < pickPlan.hours - 1e-9 || (Math.abs(next.hours - pickPlan.hours) <= 1e-9 && swap.owned && !pick.owned)) { pick = swap; pickPlan = next; }
      }
    }
    if (pick) { pick.savedHours = null; swaps.push(pick); plan = pickPlan; }
  }
  let after = -Infinity; // the last rank looked at
  while (swaps.length < MAX_SWAPS) {
    const points = [...new Set([...plan.stages.map((st) => st.fromRank), ...opens])].filter((r) => r > after && r < target).sort((a, b) => a - b);
    if (!points.length) break;
    const at = points[0];
    // The stage being run at that rank.
    let stage = null;
    for (const st of plan.stages) if (st.fromRank <= at) stage = st;
    if (!stage) { after = at; continue; }
    const now = partsWith(parts, swaps)(at);
    const onRoute = score ? score(at, now, stage.route) : null;
    const bestNow = bestAt(at, now, stage.openAt);
    const onBest = bestNow ? bestNow.expPerHour : null;
    // The best swap each way: the most gain; on a tie, a part you own, then the earlier slot and letter.
    const top = { route: null, best: null };
    const offer = (way, cand) => {
      const was = top[way];
      if (cand.gain >= MIN_GAIN && (!was || cand.gain > was.gain + 1e-9 || (Math.abs(cand.gain - was.gain) <= 1e-9 && cand.owned && !was.owned))) top[way] = cand;
    };
    for (let slot = 0; slot < 4; slot++) {
      for (const to of letters) {
        if (to === now[slot] || (Number(partRank(to, slot)) || 0) > at) continue;
        const tried = now.slice();
        tried[slot] = to;
        const base = { atRank: at, slot, from: now[slot], to, owned: owned.has(`${to}|${slot}`) };
        if (onRoute) {
          const v = score(at, tried, stage.route);
          if (v !== null && v !== undefined) offer('route', { ...base, gain: v / onRoute - 1 });
        }
        if (onBest) {
          const b = bestAt(at, tried, stage.openAt);
          if (b) offer('best', { ...base, gain: b.expPerHour / onBest - 1 });
        }
      }
    }
    let pick = null;
    let pickPlan = null;
    const seen = new Set();
    for (const cand of [top.route, top.best]) {
      if (!cand || seen.has(`${cand.slot}|${cand.to}`)) continue;
      seen.add(`${cand.slot}|${cand.to}`);
      const next = sim([...swaps, cand]);
      // Kept only when the whole plan gets shorter (a faster route now can't make a later stage slower than it saves).
      if (!(next.reached && (!plan.reached || next.hours < plan.hours - 1e-9))) continue;
      if (!pickPlan || next.hours < pickPlan.hours - 1e-9) { pick = cand; pickPlan = next; }
    }
    // Nothing more at this rank: on to the next. Else this rank is looked at again, for another part.
    if (!pick) { after = at; continue; }
    pick.savedHours = plan.hours - pickPlan.hours;
    swaps.push(pick);
    plan = pickPlan;
  }
  return { ...plan, swaps, keepHours: keep.hours, lookahead };
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
  // open: { set, key } the sectors it may use (the Levelling Plan opening them as it goes), else the reading's; must: a
  // sector every route has to go to (a voyage to open what comes after it).
  const bestAt = (rank, parts, open = null, must = null) => {
    const key = `${rank}|${parts.join(',')}|${open ? open.key : '-'}|${must || ''}`;
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
        if (must && !onMap.some((x) => x.id === must)) continue;
        const allowed = open ? onMap.filter((x) => x.rankReq <= rank && open.set.has(x.id)) : routeFinder.usableSectors({ onMap, rank, states });
        if (!allowed.length || (must && !allowed.some((x) => x.id === must))) continue;
        const values = new Map(allowed.map((x) => [x.id, routeFinder.sectorValue(x, dataOf.get(x.id), stats, prices)]));
        const searchKey = `${onMap[0].map}|${allowed.map((x) => x.id).join(',')}|${stats.speed}|${stats.range}|${allowed.map((x) => values.get(x.id).exp).join(',')}|${must || ''}`;
        // To matter here, this map's route must beat the best so far (or tie it, from an earlier map).
        const atLeast = best ? best.expPerHour * (1 - 1e-6) : 0;
        const was = searches.get(searchKey);
        let r;
        if (was && (was.below === 0 || was.below <= atLeast)) r = was.route;
        else {
          const found = routeFinder.findRoutes({ sectors: allowed, start: calc.startFor(onMap[0].id, game.startingPoints), stats, maxStops: 5, maxHours, values, rankBy: 'exp', opens, states, bestOnly: true, atLeast,
            must: must ? [must] : [] })[0] || null;
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
  return { bestAt, score, states, openerOf, opens };
}

// Each stage of a plan made through an FC's reading (read: Map id -> { unlocked }), told when a sector it hasn't
// discovered yet would give a route at least 1% better at one of its ranks (every: searches() with every sector; own:
// searches() through the reading): stage.better = { atRank, route, expPerHour, gain, missing: [ids] } (the first rank
// it happens at) or null.
function markBetter(plan, every, read, own) {
  for (const st of plan.stages) {
    st.better = null;
    if (!every) continue;
    for (let r = st.fromRank; r < Math.max(st.toRank, st.fromRank + 1); r++) {
      const better = every.bestAt(r, st.parts);
      if (!better) continue;
      // Not open yet at this stage: as the plan has opened them by then, else as the FC was read.
      const missing = better.route.filter((id) => (st.openAt ? !st.openAt.set.has(id) : !(read.get(id) || {}).unlocked));
      if (!missing.length) continue;
      const now = own ? own.bestAt(r, st.parts, st.openAt || null) : null;
      const base = now ? now.expPerHour : st.expPerHour;
      if (better.expPerHour >= base * 1.01) { st.better = { atRank: r, route: better.route, expPerHour: better.expPerHour, gain: better.expPerHour / base - 1, missing }; break; }
    }
  }
  return plan;
}

// Where each part swap shows: before the first stage that uses it (the first voyage leaving at its rank or above; a
// swap found where a new part opens can fall inside a stage, as when a voyage goes from rank 49 to 51), at that
// stage's rank, when the sub is back in port to change it. -> [[{ ...swap, showRank }] per stage]
function swapsByStage(plan) {
  const out = plan.stages.map(() => []);
  for (const s of plan.swaps || []) {
    const i = plan.stages.findIndex((st) => st.fromRank >= s.atRank);
    if (i >= 0) out[i].push({ ...s, showRank: plan.stages[i].fromRank });
  }
  return out;
}

// Every sub's plan for one request (ipc/calculator.js, run in subs/calculator-worker.js so a newer request can stop it).
// job: { game (with expToNext), data, prices, repairKitCost, read (Map id -> { unlocked, explored }, or null), maxHours,
// suggest, standardOnly, subs: [{ key, rank, exp, target, parts, owned: ['letter|slot'] }] } -> [{ key, rank, target, ...plan }]
// What the plan needs to open sectors as it goes (simulate's unlock), for one sub through an FC's reading: the sectors
// discovered, how each opens, and the targets: each sector the same sub's plan with every sector uses, from the rank it
// first uses it.
function unlockFor({ game, read, search, every, chance, rank, exp, target, parts }) {
  const open = new Set([...game.sectors.keys()].filter((id) => { const r = read.get(id); return r && (r.unlocked || r.explored); }));
  const all = simulate({ rank, exp, target, expToNext: game.expToNext, partsAt: () => parts, bestAt: every.bestAt });
  const targets = [];
  const seen = new Set();
  for (const st of all.stages) for (const id of st.route) if (!seen.has(id)) { seen.add(id); targets.push([id, st.fromRank]); }
  const rankOf = new Map([...game.sectors.values()].map((x) => [x.id, x.rankReq]));
  return { open, chance, opens: search.opens, openerOf: search.openerOf, rankOf, targets };
}

function plansFor(job) {
  const { game, read } = job;
  const searchFor = (r) => searches({ game, data: job.data, prices: job.prices, repairKitCost: job.repairKitCost, read: r, maxHours: job.maxHours });
  const search = searchFor(read);
  const every = read ? searchFor(null) : null;
  const partRank = partRanks(game.parts);
  const chance = Math.min(1, Math.max(0.01, Number(job.unlockChance) || UNLOCK_CHANCE));
  return job.subs.map((s) => {
    const unlock = read ? unlockFor({ game, read, search, every, chance, rank: s.rank, exp: s.exp, target: s.target, parts: s.parts }) : null;
    const plan = levellingPlan({ rank: s.rank, exp: s.exp, target: s.target, expToNext: game.expToNext, parts: s.parts, bestAt: search.bestAt, score: search.score,
      suggest: !!job.suggest, standardOnly: !!job.standardOnly, owned: new Set(s.owned || []), partRank, unlock });
    if (read) markBetter(plan, every, read, search);
    // The open sectors at each stage were for the working out only: not sent to the page.
    const stages = plan.stages.map(({ openAt, ...st }) => st);
    const { stuckOpen, ...rest } = plan;
    return { key: s.key, rank: s.rank, target: s.target, ...rest, stages, unlockChance: read ? chance : null, swapsByStage: swapsByStage(plan) };
  });
}

module.exports = { swapsByStage, plansFor, searches, markBetter, partRanks, unlockFor, MAX_VOYAGES, MIN_GAIN, MAX_SWAPS, UNLOCK_CHANCE, LOOKAHEADS, STANDARD, ALL_PARTS, simulate, partsWith, levellingPlan };
