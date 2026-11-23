// The Sub Calculator's Route Finder: the best routes for a build on one map, and what a Free Company can explore next.
// The plugin's RouteFinder.cs is the same, checked against this through tests/db/calculator-fixture.js.
//
// Routes: every set of up to 5 sectors the sub may go to, each sent in the fastest order its range allows (the least
// range on a tie), as calc.bestOrder picks it. Orders are built a stop at a time; one that is no faster and uses no
// less range than another order of the same sectors ending at the same sector can't lead anywhere better, so it is
// dropped (each leg's time and range don't depend on the stops before it). A route over the sub's range or the
// longest voyage is never kept.
const calc = require('./calculator');

const FIXED_VOYAGE_SECONDS = 12 * 60 * 60; // as subs/rank-up.js voyage()
const MAX_STOPS = 5;
const RANK_BY = ['exp', 'gil', 'item'];

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
// One leg (from `from` to `to`, then surveying `to`): its seconds at this speed and the range it uses, as
// rank-up.js voyage() and calculator.js rangeUsed() add them up.
function leg(from, to, speed) {
  const s = Math.max(1, Number(speed) || 0);
  const d = distance(from, to);
  return {
    seconds: Math.floor(d * 3990 / (s * 100) * 60) + Math.floor(to.surveyMinutes * 7000 / (s * 100) * 60),
    range: Math.floor(d * 0.035) + (Number(to.surveyDistance) || 0),
  };
}

// ---- What a Free Company has explored ----

// Each sector's state for one FC: 'explored'; 'discovered' (unlocked, not explored yet: any voyage there explores it);
// 'chance' (not discovered, but the sector it opens from is: each voyage there may open it); 'locked' (further off).
// read: Map sectorId -> { unlocked, explored } as the plugin last read it, or null when the FC hasn't been read (then
// every sector is null: unknown). openerOf: Map sectorId -> the sector it opens from (0 or missing: open from the start).
function sectorStates(sectorIds, read, openerOf) {
  const states = new Map();
  for (const id of sectorIds) {
    if (!read) { states.set(id, null); continue; }
    const r = read.get(id);
    if (r && r.explored) states.set(id, 'explored');
    else if (r && r.unlocked) states.set(id, 'discovered');
    else {
      const from = read.get(openerOf.get(id));
      states.set(id, from && from.unlocked ? 'chance' : 'locked');
    }
  }
  return states;
}

// The sectors each sector opens: Map openerId -> [sectorId].
function opensOf(openerOf) {
  const out = new Map();
  for (const [id, from] of openerOf) if (from) out.set(from, [...(out.get(from) || []), id]);
  return out;
}

// ---- Routes ----

// The sectors on a map a route may use: within the sub's rank, discovered by the FC (any while it isn't read), and not
// left out. onMap: the map's sectors; states: from sectorStates; leaveOut: ids.
function usableSectors({ onMap, rank, states, leaveOut = [] }) {
  return onMap.filter((x) => x.rankReq <= rank && !leaveOut.includes(x.id)
    && [null, undefined, 'explored', 'discovered'].includes(states.get(x.id)));
}

// What one sector brings on one voyage for this build, from subs/calculator.js: experience with the sure bonus, gil
// and each item's average count, and the loot tier reached (sure, or only by the lower figure).
function sectorValue(sector, dataSector, stats, prices) {
  if (!dataSector) return { exp: sector.expReward, gil: 0, items: new Map(), tier: null, tierSure: null };
  const result = calc.sectorResult(dataSector, stats);
  const loot = calc.sectorLoot(dataSector, result);
  const items = new Map();
  let gil = 0;
  for (const l of loot) {
    items.set(l.itemId, (items.get(l.itemId) || 0) + l.perVoyage);
    gil += l.perVoyage * (prices.get(l.itemId) || 0);
  }
  return { exp: sector.expReward * (1 + calc.bonusExp(result).sure / 100), gil, items, tier: result.tier, tierSure: result.tierSure };
}

// The routes. sectors: the map's sectors the sub may go to ({ id, x, y, z, surveyMinutes, surveyDistance, expReward });
// start: the map's starting point; stats: the build's; maxStops (1-5); maxHours (null: any); must: sector ids every route
// has; values: Map id -> sectorValue; rankBy 'exp' | 'gil' | 'item' (itemId); opens: Map id -> [ids it may open];
// states: Map id -> sectorStates' state; exploreFirst: routes exploring or with chances at new sectors first.
// bestOnly (ranking by experience): only the best route is wanted (the Levelling Plan), so an order that can't beat the
// best found so far however it goes on is not followed; the answer is the same as the whole list's first, sooner.
// atLeast (with bestOnly): experience an hour already had elsewhere (another map); a route below it may be left out,
// so the answer is the best route only when that is at least atLeast (else it's below atLeast, or none).
// [{ route: [ids], hours, range, exp, expPerHour, gilPerVoyage, gilPerDay, itemPerDay, explores, chances }], best first.
function findRoutes({ sectors, start, stats, maxStops = MAX_STOPS, maxHours = null, must = [], values, rankBy = 'exp', itemId = null,
  opens = new Map(), states = new Map(), exploreFirst = false, bestOnly = false, atLeast = 0 }) {
  if (!start || !stats || !sectors.length) return [];
  const list = sectors.slice().sort((a, b) => a.id - b.id);
  const n = list.length;
  if (n > 30) throw new Error('A map has at most 30 sectors.'); // each is a bit of a set
  const stops = Math.max(1, Math.min(MAX_STOPS, Number(maxStops) || MAX_STOPS));
  const rangeMax = Number(stats.range) || 0;
  const secondsMax = maxHours ? maxHours * 3600 : Infinity;
  const mustMask = list.reduce((m, s, i) => (must.includes(s.id) ? m | (1 << i) : m), 0);
  const first = list.map((s) => leg(start, s, stats.speed));
  const legs = list.map((a) => list.map((b) => leg(a, b, stats.speed)));

  // bestOnly: the most experience an hour any order could still reach, from its experience and seconds so far: with m
  // more stops, at most the m best sectors' experience, and at least the m shortest ways into a sector (its survey and
  // the shortest leg to it) in time.
  const pruning = bestOnly && rankBy === 'exp' && !exploreFirst;
  const expOf = list.map((s) => (values.get(s.id) || { exp: 0 }).exp);
  const top = [0];
  for (const e of expOf.slice().sort((a, b) => b - a)) top.push(top[top.length - 1] + Math.max(0, e));
  const into = list.map((_, j) => { let m = Infinity; for (let i = 0; i < n; i++) if (i !== j) m = Math.min(m, legs[i][j].seconds); return Number.isFinite(m) ? m : 0; });
  const least = [0];
  for (const c of into.slice().sort((a, b) => a - b)) least.push(least[least.length - 1] + c);
  let bestRate = pruning && atLeast > 0 ? atLeast / 3600 : -Infinity;
  const couldBeat = (exp, seconds, size) => {
    if (!pruning || bestRate <= 0) return true;
    for (let m = 0; m <= stops - size && m < top.length; m++) {
      if ((exp + top[m]) / (seconds + least[m]) >= bestRate * (1 - 1e-9)) return true;
    }
    return false;
  };
  // A good route to start from, so little is followed that can't beat it: from each sector, the next stop that gives
  // the most experience an hour so far, while it fits.
  if (pruning && !mustMask) {
    for (let i = 0; i < n; i++) {
      let at = i;
      let seconds = FIXED_VOYAGE_SECONDS + first[i].seconds;
      let range = first[i].range;
      let exp = expOf[i];
      let used = 1 << i;
      if (range > rangeMax || seconds > secondsMax) continue;
      bestRate = Math.max(bestRate, exp / seconds);
      for (let size = 1; size < stops; size++) {
        let pick = -1;
        let pickRate = -Infinity;
        for (let j = 0; j < n; j++) {
          if (used & (1 << j)) continue;
          const l = legs[at][j];
          if (range + l.range > rangeMax || seconds + l.seconds > secondsMax) continue;
          const rate = (exp + expOf[j]) / (seconds + l.seconds);
          if (rate > pickRate) { pickRate = rate; pick = j; }
        }
        if (pick < 0) break;
        seconds += legs[at][pick].seconds; range += legs[at][pick].range; exp += expOf[pick]; used |= 1 << pick; at = pick;
        bestRate = Math.max(bestRate, exp / seconds);
      }
    }
  }

  // Orders built a stop at a time: per set of sectors (a bit each) and the last one, the orders not beaten on both time
  // and range by another. { seconds, range, last: index, before: the label one stop shorter }.
  let layer = new Map();
  const best = new Map(); // set -> the fastest order in range (least range on a tie)
  const offer = (map, key, label) => {
    const was = map.get(key);
    if (!was) { map.set(key, [label]); return; }
    for (const o of was) if (o.seconds <= label.seconds && o.range <= label.range) return;
    const kept = was.filter((o) => !(label.seconds <= o.seconds && label.range <= o.range));
    kept.push(label);
    map.set(key, kept);
  };
  const keep = (mask, label) => {
    if (pruning && (mask & mustMask) === mustMask) bestRate = Math.max(bestRate, label.exp / label.seconds);
    const was = best.get(mask);
    if (!was || label.seconds < was.seconds || (label.seconds === was.seconds && label.range < was.range)) best.set(mask, label);
  };
  for (let i = 0; i < n; i++) {
    const label = { seconds: FIXED_VOYAGE_SECONDS + first[i].seconds, range: first[i].range, last: i, before: null, exp: expOf[i] };
    if (label.range > rangeMax || label.seconds > secondsMax) continue;
    offer(layer, (1 << i) * 32 + i, label);
  }
  for (let size = 1; size <= stops; size++) {
    const next = new Map();
    for (const [key, labels] of layer) {
      const mask = Math.floor(key / 32);
      const last = key % 32;
      for (const label of labels) {
        keep(mask, label);
        if (size === stops) continue;
        for (let j = 0; j < n; j++) {
          if (mask & (1 << j)) continue;
          const l = legs[last][j];
          const grown = { seconds: label.seconds + l.seconds, range: label.range + l.range, last: j, before: label, exp: label.exp + expOf[j] };
          if (grown.range > rangeMax || grown.seconds > secondsMax) continue;
          if (!couldBeat(grown.exp, grown.seconds, size + 1)) continue;
          offer(next, (mask | (1 << j)) * 32 + j, grown);
        }
      }
    }
    layer = next;
  }

  const routes = [];
  for (const [mask, label] of best) {
    if ((mask & mustMask) !== mustMask) continue;
    const ids = [];
    for (let at = label; at; at = at.before) ids.unshift(list[at.last].id);
    const hours = label.seconds / 3600;
    const perDay = 24 / hours;
    let exp = 0;
    let gil = 0;
    let item = 0;
    let explores = 0;
    let chances = 0;
    for (const id of ids) {
      const v = values.get(id);
      exp += v.exp;
      gil += v.gil;
      if (itemId !== null) item += v.items.get(Number(itemId)) || 0;
      if (states.get(id) === 'discovered') explores++;
      for (const target of opens.get(id) || []) if (states.get(target) === 'chance') chances++;
    }
    routes.push({ route: ids, hours, range: label.range, exp, expPerHour: exp / hours, gilPerVoyage: gil, gilPerDay: gil * perDay,
      itemPerDay: itemId !== null ? item * perDay : null, explores, chances });
  }
  const score = (r) => (rankBy === 'gil' ? r.gilPerDay : rankBy === 'item' ? r.itemPerDay || 0 : r.expPerHour);
  const newOnes = (r) => r.explores + r.chances;
  const sorted = routes.sort((a, b) => (exploreFirst ? newOnes(b) - newOnes(a) : 0) || score(b) - score(a) || a.hours - b.hours
    || a.route.length - b.route.length || (a.route.join(',') < b.route.join(',') ? -1 : a.route.join(',') > b.route.join(',') ? 1 : 0));
  return pruning ? sorted.slice(0, 1) : sorted;
}

// ---- Unlocks ----

// What an FC can explore next. sectors: every sector ({ id, map, letter, rankReq }); maps: [{ id, name }] in map order;
// states: from sectorStates; openerOf: as there.
// { maps: [{ id, name, total, explored, discovered, open }], sure: [ids], chance: [{ id, from }],
//   nextMap: { id, name, first, steps: [{ id, how: 'go' | 'explore' | 'chance' }] } | null }
function unlocks({ sectors, maps, states, openerOf }) {
  const byMap = new Map();
  for (const s of sectors) byMap.set(s.map, [...(byMap.get(s.map) || []), s]);
  const mapRows = maps.filter((m) => byMap.has(m.id)).map((m) => {
    const list = byMap.get(m.id);
    const count = (state) => list.filter((s) => states.get(s.id) === state).length;
    const explored = count('explored');
    const discovered = count('discovered');
    return { id: m.id, name: m.name, total: list.length, explored, discovered, open: explored + discovered > 0 };
  });
  const sure = sectors.filter((s) => states.get(s.id) === 'discovered').map((s) => s.id);
  const chance = sectors.filter((s) => states.get(s.id) === 'chance').map((s) => ({ id: s.id, from: openerOf.get(s.id) }));
  // The first map not open yet: its first sector, and the way to it from a sector already discovered.
  let nextMap = null;
  const closed = mapRows.find((m) => !m.open);
  if (closed) {
    const first = byMap.get(closed.id).slice().sort((a, b) => a.id - b.id)[0];
    const chain = [first.id];
    const seen = new Set(chain);
    let at = first.id;
    while (true) {
      const from = openerOf.get(at);
      if (!from || seen.has(from)) break;
      chain.unshift(from);
      seen.add(from);
      const st = states.get(from);
      if (st === 'explored' || st === 'discovered') break;
      at = from;
    }
    const head = states.get(chain[0]);
    if (head === 'explored' || head === 'discovered') {
      nextMap = { id: closed.id, name: closed.name, first: first.id,
        steps: chain.map((id, i) => ({ id, how: i > 0 ? 'chance' : head === 'discovered' ? 'explore' : 'go' })) };
    }
  }
  return { maps: mapRows, sure, chance, nextMap };
}

// ---- Fight Club routes against what the FC has discovered ----

// A Fight Club route's sector ids ("MROJZ"): its letters on the first map (lowest id) that has every one, as Fight
// Club's routes are written without the map; null when no map has them all. maps: [{ id, byLetter: Map letter -> id }].
function routeIds(route, maps) {
  const letters = String(route || '').replace(/-/g, '');
  for (const m of maps.slice().sort((a, b) => a.id - b.id)) {
    const ids = [];
    let i = 0;
    while (i < letters.length) {
      const two = letters.slice(i, i + 2);
      if (two.length === 2 && m.byLetter.has(two)) { ids.push(m.byLetter.get(two)); i += 2; } else if (m.byLetter.has(letters[i])) { ids.push(m.byLetter.get(letters[i])); i += 1; } else break;
    }
    if (i === letters.length && ids.length) return ids;
  }
  return null;
}

// The Fight Club route a sub at `rank` would run (options: submarine-builds.js fightClubOptions; bestOf: its bestOf),
// checked against the sectors its FC has discovered (read: Map id -> { unlocked }, null when not read). missing: the
// route's sectors not discovered yet; alt: the best option the FC can run now (all its sectors discovered), or null.
function fightClubCheck({ options, rank, maps, read, bestOf }) {
  const found = bestOf(options, rank);
  if (!found || !read) return { best: found, missing: [], alt: null };
  const discovered = (id) => !!(read.get(id) || {}).unlocked;
  const ids = routeIds(found.row.route, maps);
  if (!ids) return { best: found, missing: [], alt: null };
  const missing = ids.filter((id) => !discovered(id));
  if (!missing.length) return { best: found, missing, alt: null };
  const runnable = options.filter((o) => { const r = routeIds(o.row.route, maps); return r && r.every(discovered); });
  return { best: found, missing, alt: bestOf(runnable, rank) };
}

module.exports = { MAX_STOPS, RANK_BY, leg, sectorStates, opensOf, usableSectors, sectorValue, findRoutes, unlocks, routeIds, fightClubCheck };
