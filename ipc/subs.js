// Submarines: the Subs view (routes, gil/day, speed/range), low fuel/repair warnings, Fight Club builds toggle.
const { ipcMain } = require('electron');
const { notSyncedCharacters, readBehindMinutes, readLoginPcs } = require('../characters/not-synced');
const { loadSharedCharacters } = require('../characters/shared-sync');
const { withClient, snapshotFragments } = require('../db');
const { metricWindow } = require('../db/metric-window');
const forecastVoyages = require('../subs/voyage-forecast');
const { partLetter, computeTargetRoute, nextFightClubBuild, computeCurrentGilPerDay, decodeRoute, computeStat, STATS, fightClubOptions, bestOf, formatRouteWithDashes } = require('../subs/submarine-builds');
const { fightClubCheck } = require('../subs/route-finder');
const calculatorData = require('../subs/calculator-data');
const rankUp = require('../subs/rank-up');
const accuracy = require('../subs/forecast-accuracy');
const { columnsByKey } = require('./shopping');
const { targetBuildAt, repairKitCostFrom, FIGHT_CLUB_COLUMNS } = require('./parts');

const MEASURE_WINDOW_DAYS = 7;
// How far back collections are looked at for a sub's bonus experience (its last few voyages).
const BONUS_WINDOW_DAYS = 14;
const DAY = 24 * 60 * 60 * 1000;
const quote = (name) => `"${name.replace(/"/g, '""')}"`;

// Real, plugin-written submarine data - no n8n involved. Adds the full
// economics engine on top: Current route (decoded from raw points),
// Target route + Target gil/day (Fight Club's best-Gil/Hr
// recommendation at this rank), Current gil/day (actual installed
// route/parts matched against Fight Club), and Speed/Range (base-at-
// rank + installed part bonuses). Port of the old n8n Parse Submarine
// Dashboard economics engine.
async function loadSubmarines(client) {
  const { latestCharacter } = await snapshotFragments(client);

  const result = await client.query(`
    SELECT s.cid, s.sub_name, s.level, s.part1, s.part2, s.part3, s.part4,
           s.points, s.return_time, s.updated_at, so.sort_index,
           coalesce((to_jsonb(s)->>'slot')::int, substring(s.sub_name FROM '^Submersible-([1-4])$')::int) AS slot,
           s.current_exp, s.next_level_exp,
           c.name AS character_name, c.world, c.account_label, c.fc_id,
           ct.craft_enabled
    FROM companion_submarine_snapshot s
    LEFT JOIN character_sort_order so ON s.cid = so.cid
    LEFT JOIN ${latestCharacter} c ON c.cid = s.cid
    LEFT JOIN sub_craft_toggle ct ON ct.cid = s.cid AND ct.sub_name = s.sub_name
    WHERE s.level > 0
    ORDER BY so.sort_index NULLS LAST, s.cid,
             coalesce((to_jsonb(s)->>'slot')::int, substring(s.sub_name FROM '^Submersible-([1-4])$')::int), s.sub_name
  `);

  const explorationResult = await client.query(`SELECT id, location FROM ffxiv_submarineexploration`);
  const pointLetterById = new Map();
  for (const row of explorationResult.rows) {
    const id = Number(row.id);
    if (id && row.location) pointLetterById.set(id, row.location);
  }
  const validRouteLetters = new Set(pointLetterById.values());
  const mapOfPoint = await loadSectorMaps(client);

  const { rankStatsById, partStatsByClassSlot } = await loadStatTables(client);

  const fightClubRows = (await client.query(`SELECT ${FIGHT_CLUB_COLUMNS} FROM fight_club_routes ORDER BY id`)).rows;
  const repairKitCost = await repairKitCostFrom(client);
  const topRank = Math.max(0, ...[...rankStatsById.keys()].filter((r) => rankStatsById.get(r).speed !== null));
  // Fight Club's routes against the sectors each FC has discovered (read in its workshop by the plugin): each map's
  // letters, each FC's reading, and the sector each opens from (XIVStats).
  const options = fightClubOptions(fightClubRows, repairKitCost);
  const lettersByMap = new Map();
  for (const [id, letter] of pointLetterById) {
    const m = mapOfPoint.get(id);
    if (!m) continue;
    if (!lettersByMap.has(m.id)) lettersByMap.set(m.id, { id: m.id, byLetter: new Map() });
    lettersByMap.get(m.id).byLetter.set(letter, id);
  }
  const maps = [...lettersByMap.values()];
  const reads = await fcSectorReads(client);
  const openerOf = new Map(calculatorData.load().sectors.map((d) => [d.id, Number(d.unlockedFrom) || 0]));

  const rows = result.rows.map((row) => {
    const partLetters = [row.part1, row.part2, row.part3, row.part4].map(partLetter);
    const rank = row.level;

    const currentRoute = decodeRoute(row.points, pointLetterById);
    const target = computeTargetRoute(rank, fightClubRows, repairKitCost, validRouteLetters);
    const currentGilDay = computeCurrentGilPerDay(rank, currentRoute, partLetters, fightClubRows, repairKitCost);

    const nextLevelExp = Number(row.next_level_exp) || 0;
    const currentExp = Number(row.current_exp) || 0;
    // At most 99: 99.6% isn't the next rank yet (it would show as "68.100" and sort as 69).
    const rankProgressPct = nextLevelExp > 0 ? Math.min(99, Math.round((currentExp / nextLevelExp) * 100)) : null;

    return {
      cid: row.cid,
      sub_name: row.sub_name,
      character_name: row.character_name,
      world: row.world,
      account_label: row.account_label,
      fc_id: row.fc_id,
      part_letters: partLetters,
      // Fight Club's next more profitable build, for Next build when the Sub Rules have nothing ahead.
      fc_next_build: nextFightClubBuild({
        rank, top: topRank, currentParts: partLetters, currentNet: currentGilDay === '' ? null : currentGilDay,
        fightClubRows, repairKitCost, validRouteLetters,
      }),
      rank,
      rank_progress_pct: rankProgressPct,
      current_setup: partLetters.join('-'),
      current_route: currentRoute,
      current_map: routeMap(row.points, mapOfPoint),
      target_route: target.route,
      target_gil_day: target.gilPerDay,
      target_blocked: blockedTarget(fightClubCheck({ options, rank, maps, read: reads.get(String(row.fc_id)) || null, bestOf }), pointLetterById, openerOf, validRouteLetters),
      current_gil_day: currentGilDay,
      speed: computeStat(rank, partLetters, 'speed', rankStatsById, partStatsByClassSlot),
      range: computeStat(rank, partLetters, 'range', rankStatsById, partStatsByClassSlot),
      return_time: row.return_time,
      sort_index: row.sort_index,
      craft_enabled: row.craft_enabled === true,
      slot: row.slot,
      current_exp: currentExp,
      next_level_exp: nextLevelExp,
      points: row.points
    };
  });

  return rows;
}

// The five stats per rank (ffxiv_submarinerank's bonuses) and per part (ffxiv_submarinepart), for computeStat and
// buildStats. A stat whose column the game data doesn't have is left out, so it reads as unknown rather than 0.
async function loadStatTables(client) {
  const rankCols = await columnsByKey(client, 'ffxiv_submarinerank');
  const partCols = await columnsByKey(client, 'ffxiv_submarinepart');
  const rankStat = STATS.map((s) => [s, rankCols.get(`${s}bonus`)]).filter(([, c]) => c);
  const partStat = STATS.map((s) => [s, partCols.get(s)]).filter(([, c]) => c);
  const quote = (c) => `"${c.replace(/"/g, '""')}"`;
  const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

  const rankStatsById = new Map();
  const ranks = await client.query(`SELECT id${rankStat.map(([s, c]) => `, ${quote(c)} AS ${s}`).join('')} FROM ffxiv_submarinerank`);
  for (const row of ranks.rows) rankStatsById.set(Number(row.id), Object.fromEntries(rankStat.map(([s]) => [s, num(row[s])])));

  const partStatsByClassSlot = new Map();
  const parts = await client.query(`SELECT class, slot${partStat.map(([s, c]) => `, ${quote(c)} AS ${s}`).join('')} FROM ffxiv_submarinepart`);
  for (const row of parts.rows) partStatsByClassSlot.set(`${row.class}|${row.slot}`, Object.fromEntries(partStat.map(([s]) => [s, Number(row[s]) || 0])));
  return { rankStatsById, partStatsByClassSlot };
}

// Each Free Company's sectors as the plugin last read them in its workshop (database update 18): Map fcId -> Map
// sectorId -> { unlocked, explored }. Empty before update 18 or any reading.
async function fcSectorReads(client) {
  const out = new Map();
  try {
    for (const r of (await client.query('SELECT fc_id, sector_id, unlocked, explored FROM companion_fc_sub_sector')).rows) {
      const fc = String(r.fc_id);
      if (!out.has(fc)) out.set(fc, new Map());
      out.get(fc).set(Number(r.sector_id), { unlocked: r.unlocked === true || Number(r.unlocked) === 1, explored: r.explored === true || Number(r.explored) === 1 });
    }
  } catch { /* no table yet */ }
  return out;
}

// A sub's Fight Club target its FC can't run yet (route-finder.js fightClubCheck), for the Subs and Route Optimization
// pages: { needs: [{ letter, from }] (from: the letter it opens from, or null), alt: { route, gilPerDay } | null }, or null.
function blockedTarget(check, letterOf, openerOf, validRouteLetters) {
  if (!check.missing.length) return null;
  return {
    needs: check.missing.map((id) => ({ letter: letterOf.get(id) || String(id), from: openerOf.get(id) ? letterOf.get(openerOf.get(id)) || null : null })),
    alt: check.alt ? { route: formatRouteWithDashes(check.alt.row.route, validRouteLetters), gilPerDay: Math.round(check.alt.net) } : null,
  };
}

// Which map (sea) each sector is on, from game data: sector id -> { id, name } (the game's own map
// number: 1 Deep-sea Site, 2 Sea of Ash, ...). Empty when the game data has no Map column.
async function loadSectorMaps(client) {
  const mapOfPoint = new Map();
  const cols = await columnsByKey(client, 'ffxiv_submarineexploration');
  if (!cols.has('map')) return mapOfPoint;
  const names = new Map();
  const mapCols = await columnsByKey(client, 'ffxiv_submarinemap');
  if (mapCols.has('name')) {
    const { rows } = await client.query(`SELECT id, ${quote(mapCols.get('name'))} AS name FROM ffxiv_submarinemap`);
    for (const r of rows) names.set(Number(r.id), r.name || '');
  }
  const { rows } = await client.query(`SELECT id, ${quote(cols.get('map'))} AS map FROM ffxiv_submarineexploration`);
  for (const r of rows) {
    const id = Number(r.map);
    if (Number(r.id) > 0 && id > 0) mapOfPoint.set(Number(r.id), { id, name: names.get(id) || '' });
  }
  return mapOfPoint;
}

// The map a route is on (its first sector's), or null.
function routeMap(pointsBuffer, mapOfPoint) {
  const first = Array.from(pointsBuffer || []).find((b) => b > 0);
  return (first && mapOfPoint.get(first)) || null;
}

// Game data the rank-up dates need: experience per rank, and each route sector's position, experience
// and survey time. Missing tables or columns leave that part out (the dates then fall back or are blank).
async function loadRankUpGameData(client) {
  const expToNext = new Map();
  const rankCols = await columnsByKey(client, 'ffxiv_submarinerank');
  if (rankCols.has('exptonext')) {
    const { rows } = await client.query(`SELECT id, ${quote(rankCols.get('exptonext'))} AS exp FROM ffxiv_submarinerank`);
    for (const r of rows) expToNext.set(Number(r.id), Number(r.exp) || 0);
  }
  const sectors = new Map();
  const startingPoints = [];
  const cols = await columnsByKey(client, 'ffxiv_submarineexploration');
  const want = { x: 'x', y: 'y', z: 'z', expReward: 'expreward', surveyMinutes: 'surveydurationmin', starting: 'startingpoint' };
  if (Object.values(want).every((key) => cols.has(key))) {
    const select = Object.entries(want).map(([as, key]) => `${quote(cols.get(key))} AS "${as}"`).join(', ');
    const { rows } = await client.query(`SELECT id, ${select} FROM ffxiv_submarineexploration`);
    for (const r of rows) {
      const sector = {
        id: Number(r.id), x: Number(r.x) || 0, y: Number(r.y) || 0, z: Number(r.z) || 0,
        expReward: Number(r.expReward) || 0, surveyMinutes: Number(r.surveyMinutes) || 0,
      };
      if (String(r.starting).toLowerCase() === 'true') startingPoints.push(sector);
      else sectors.set(sector.id, sector);
    }
  }
  return { expToNext, sectors, startingPoints };
}

// Each recorded voyage's sectors, from SubmarineTracker's loot (companion_voyage_loot) since `since`:
// Map "fc_id|sub_name" -> [{ returnedAt (ms), sectors: [id, ...] }]. Empty without the table.
async function loadVoyageRoutes(client, since) {
  const out = new Map();
  let rows;
  try {
    ({ rows } = await client.query(`
      SELECT fc_id, sub_name, returned_at, array_agg(sector ORDER BY leg NULLS LAST, sector) AS sectors
      FROM companion_voyage_loot
      WHERE returned_at >= $1 AND sub_name IS NOT NULL
      GROUP BY fc_id, sub_name, sub_register, returned_at`, [since]));
  } catch (err) {
    if (err.code === '42P01' || err.code === '42703') return out;
    throw err;
  }
  for (const r of rows) {
    const key = `${r.fc_id}|${r.sub_name}`;
    if (!out.has(key)) out.set(key, []);
    out.get(key).push({ returnedAt: new Date(r.returned_at).getTime(), sectors: r.sectors.map(Number) });
  }
  return out;
}

// Adds each sub's rank-up estimate: rank_up = { method, perDay | voyage, bonus, buildAhead, nextRank,
// nextRankAt, voyages, nextBuild: { rank, build, at, voyages } | null, maxRank }. Worked out voyage by voyage
// (voyage-forecast.js) when its route and speed are known: 'voyages' with its own measured bonus, or
// 'calculated' from game data alone until it has a few collections recorded. Otherwise 'measured' from its
// last week's experience (rank-up.js).
async function addRankUps(client, subs) {
  const game = await loadRankUpGameData(client);
  const stats = await loadStatTables(client);
  const rules = (await client.query('SELECT rank, cid_override, sub_filter, hull, stern, bow, bridge FROM sub_build_rules ORDER BY id')).rows;
  const fightClubRows = (await client.query(`SELECT ${FIGHT_CLUB_COLUMNS} FROM fight_club_routes ORDER BY id`)).rows;
  const repairKitCost = await repairKitCostFrom(client);
  const top = rankUp.maxRank(game.expToNext);

  // Recorded rank and experience per slot (plugin 0.7.0), over the window plus the value before it.
  const now = Date.now();
  const windowStart = new Date(now - MEASURE_WINDOW_DAYS * DAY);
  const historyStart = new Date(now - BONUS_WINDOW_DAYS * DAY);
  const cids = [...new Set(subs.map((s) => String(s.cid)))];
  const metrics = [1, 2, 3, 4].flatMap((slot) => [`sub_rank:${slot}`, `sub_exp:${slot}`]);
  const points = await metricWindow(client, 'character', metrics, historyStart, cids);
  const voyageRoutes = await loadVoyageRoutes(client, historyStart);
  const routeExp = (ids) => (ids.length && ids.every((id) => game.sectors.has(id)) ? ids.reduce((sum, id) => sum + game.sectors.get(id).expReward, 0) : null);

  for (const sub of subs) {
    const cid = String(sub.cid);
    const series = rankUp.totalExpSeries(points.get(`${cid}|sub_rank:${sub.slot}`) || [], points.get(`${cid}|sub_exp:${sub.slot}`) || [], game.expToNext);
    const latestAt = series.length ? series[series.length - 1].at : 0;
    const measured = series.length ? rankUp.measuredRate(series, windowStart.getTime(), Math.max(now, latestAt)) : null;

    const sectorIds = Array.from(sub.points || []).filter((b) => b > 0);
    const sectors = sectorIds.map((id) => game.sectors.get(id));
    const start = sectorIds.length ? rankUp.startFor(sectorIds[0], game.startingPoints) : null;
    const trip = typeof sub.speed === 'number' ? rankUp.voyage(sectors, start, sub.speed) : null;
    const returnAt = Number(sub.return_time) > 0 ? Number(sub.return_time) * 1000 : null;

    const buildAt = (rank) => targetBuildAt({ rank, slot: sub.slot, cid, craftEnabled: sub.craft_enabled, rules, fightClubRows, repairKitCost });
    // The Sub Rules (or, for a sub with Fight Club builds ticked, Fight Club's build at each rank); when they have nothing ahead,
    // Fight Club's next more profitable build.
    const fromRules = rankUp.nextBuildRank(sub.rank, top, buildAt);
    const fightClub = !fromRules && sub.fc_next_build && sub.fc_next_build.rank <= top ? sub.fc_next_build : null;
    const switchTo = fromRules || fightClub;
    const untilRank = Math.min(top, Math.max(sub.rank + 1, switchTo ? switchTo.rank : 0));

    // This sub's bonus: each collection against the route of the voyages collected (SubmarineTracker's
    // loot), or its current route when those aren't recorded.
    const recorded = voyageRoutes.get(`${sub.fc_id}|${sub.sub_name}`) || [];
    const samples = forecastVoyages.collections(series).map((c) => {
      const these = recorded.filter((v) => v.returnedAt > c.from && v.returnedAt <= c.at);
      const bases = these.map((v) => routeExp(v.sectors));
      const base = these.length ? (bases.every((b) => b !== null) ? bases.reduce((a, b) => a + b, 0) : null) : (trip ? trip.exp : null);
      return { gained: c.gained, base };
    });
    const bonus = trip ? forecastVoyages.bonusFactor(samples) : null;

    // Its parts now, then its Sub Rules builds from the rank it switches (a blank in a rule keeps the part).
    const lettersAt = (rank) => {
      if (!switchTo || rank < switchTo.rank) return sub.part_letters;
      const build = (fightClub ? fightClub.build : buildAt(rank)) || [];
      return sub.part_letters.map((letter, i) => build[i] || letter);
    };
    const voyageAt = (rank) => {
      const speed = computeStat(rank, lettersAt(rank), 'speed', stats.rankStatsById, stats.partStatsByClassSlot);
      const v = typeof speed === 'number' ? rankUp.voyage(sectors, start, speed) : null;
      return v ? { exp: v.exp * (bonus ? bonus.factor : 1), hours: v.hours } : null;
    };
    const reached = trip ? forecastVoyages.forecast({ rank: sub.rank, exp: sub.current_exp, untilRank, expToNext: game.expToNext, voyageAt, returnAt, now }) : new Map();

    let method = null;
    let dateFor = () => null;
    if (reached.size) {
      method = bonus ? 'voyages' : 'calculated';
      dateFor = (rank) => reached.get(rank) || null;
    } else if (measured) {
      method = 'measured';
      const out = { returnAt, hours: trip ? trip.hours : null };
      dateFor = (rank) => rankUp.rankDate({ rank: sub.rank, exp: sub.current_exp, targetRank: rank, expToNext: game.expToNext, measured, out, now });
    }

    const next = sub.rank < top ? dateFor(sub.rank + 1) : null;
    const switchAt = switchTo ? dateFor(switchTo.rank) : null;
    const firstVoyage = trip ? voyageAt(sub.rank) : null;

    sub.rank_up = {
      method,
      outAtSea: method === 'measured' && returnAt > now,
      perDay: method === 'measured' ? measured.perDay : null,
      voyage: firstVoyage && method !== 'measured' ? { exp: Math.round(firstVoyage.exp), hours: firstVoyage.hours } : null,
      bonus: method === 'voyages' ? bonus : null,
      buildAhead: method !== 'measured' && !!switchTo && !!switchAt,
      maxRank: top,
      nextRank: sub.rank < top ? sub.rank + 1 : null,
      nextRankAt: next && next.at ? next.at : null,
      voyages: next && next.voyages ? next.voyages : null,
      nextBuild: switchTo ? {
        rank: switchTo.rank,
        build: switchTo.build.map((letter) => letter || '·').join(''),
        parts: switchTo.build.map((letter) => letter || ''),
        at: switchAt && switchAt.at ? switchAt.at : null,
        voyages: switchAt && switchAt.voyages ? switchAt.voyages : null,
        fightClub: fightClub ? { route: fightClub.route, net: fightClub.net, gain: fightClub.gain } : null,
      } : null,
    };
    delete sub.points;
    delete sub.part_letters;
    delete sub.fc_next_build;
  }
  return subs;
}

// Saves each sub's Next rank date, at most once an hour (whichever copy of the app gets there first), so
// get-forecast-accuracy can later compare it with the real rank-up. Dates older than 30 days are dropped.
// Never stops the Subs page: a database without the table (or a login that may not write) is skipped, and
// said once in the app's log.
let forecastSaveWarned = false;
async function saveForecasts(client, subs) {
  const due = subs.filter((s) => s.slot && s.rank_up && s.rank_up.nextRank && s.rank_up.nextRankAt);
  if (!due.length) return;
  try {
    const { rows: [saved] } = await client.query(
      `SELECT EXISTS (SELECT 1 FROM companion_rankup_forecast WHERE made_at = date_trunc('hour', now())) AS done`);
    if (saved.done) return;
    await client.query(
      `INSERT INTO companion_rankup_forecast (cid, slot, rank, made_at, predicted_at, sub_name)
       SELECT cid, slot, rank, date_trunc('hour', now()), predicted_at, sub_name
       FROM unnest($1::numeric[], $2::int[], $3::int[], $4::timestamptz[], $5::text[]) AS f(cid, slot, rank, predicted_at, sub_name)
       ON CONFLICT DO NOTHING`,
      [due.map((s) => String(s.cid)), due.map((s) => s.slot), due.map((s) => s.rank_up.nextRank),
        due.map((s) => new Date(s.rank_up.nextRankAt).toISOString()), due.map((s) => s.sub_name)]);
    await client.query(`DELETE FROM companion_rankup_forecast WHERE made_at < now() - make_interval(days => $1)`, [accuracy.KEEP_DAYS]);
  } catch (err) {
    if (err.code !== '42P01' && !forecastSaveWarned) {
      forecastSaveWarned = true;
      console.warn(`Could not save the Next rank dates (the Subs page's forecast line needs them): ${err.message}`);
    }
  }
}

// How close the saved Next rank dates came to the real rank-ups (forecast-accuracy.js), with each sub's and
// character's name: { count, averageOff, checks }, or null before the database has the table.
async function loadForecastAccuracy(client) {
  let saved;
  try {
    ({ rows: saved } = await client.query(
      `SELECT cid::text AS cid, slot, rank, made_at, predicted_at, sub_name FROM companion_rankup_forecast
       WHERE made_at >= now() - make_interval(days => $1)`, [accuracy.KEEP_DAYS]));
  } catch (err) {
    if (err.code === '42P01') return null;
    throw err;
  }
  const bySub = new Map();
  for (const r of saved) {
    const key = `${r.cid}|${r.slot}`;
    if (!bySub.has(key)) bySub.set(key, { cid: r.cid, slot: r.slot, subName: r.sub_name, latest: 0, predictions: [] });
    const sub = bySub.get(key);
    const madeAt = new Date(r.made_at).getTime();
    sub.predictions.push({ rank: Number(r.rank), madeAt, predictedAt: new Date(r.predicted_at).getTime() });
    // Its name as last saved (a sub can be renamed).
    if (madeAt >= sub.latest) { sub.latest = madeAt; sub.subName = r.sub_name; }
  }
  if (!bySub.size) return accuracy.summarize([]);

  const since = new Date(Date.now() - (accuracy.KEEP_DAYS + 1) * DAY);
  const cids = [...new Set([...bySub.values()].map((s) => s.cid))];
  const { latestCharacter } = await snapshotFragments(client);
  const characters = new Map((await client.query(`SELECT cid::text AS cid, name, fc_id FROM ${latestCharacter} c WHERE c.cid = ANY($1::numeric[])`, [cids])).rows
    .map((c) => [c.cid, c]));
  const points = await metricWindow(client, 'character', [1, 2, 3, 4].map((slot) => `sub_rank:${slot}`), since, cids);
  const voyages = await loadVoyageRoutes(client, since);

  const checks = [];
  for (const sub of bySub.values()) {
    const character = characters.get(sub.cid) || {};
    const returns = (voyages.get(`${character.fc_id}|${sub.subName}`) || []).map((v) => v.returnedAt);
    const ups = accuracy.rankUps(points.get(`${sub.cid}|sub_rank:${sub.slot}`) || [], returns);
    for (const c of accuracy.checkSub(sub.predictions, ups)) checks.push({ ...c, subName: sub.subName, characterName: character.name || '' });
  }
  return accuracy.summarize(checks);
}

// Saves this hour's Next rank dates without a window open: the nightly backup (backups/app.js) calls this,
// so the forecast line gets at least one set a day. Never throws.
async function saveForecastsNow() {
  try {
    await withClient(async (client) => saveForecasts(client, await loadSubmarinesWithRankUps(client)),
      (err) => console.warn(`Could not save the Next rank dates: ${err.message}`));
  } catch (err) {
    console.warn(`Could not save the Next rank dates: ${err.message}`);
  }
}

// Every sub with its rank-up dates and next build (the Subs page's rows; Look ahead on the Parts page).
async function loadSubmarinesWithRankUps(client) {
  return addRankUps(client, await loadSubmarines(client));
}

ipcMain.handle('get-submarines', async () => {
  return withClient(async (client) => {
    const rows = await loadSubmarinesWithRankUps(client);
    await saveForecasts(client, rows);
    return { success: true, rows };
  }, (err) => {
    return { success: false, error: err.message };
  });
});

// Each sub's next build rank (as the Subs page works it out), for the Levelling Plan's default target; nothing saved.
ipcMain.handle('get-sub-next-builds', async () => withClient(async (client) => {
  const rows = await loadSubmarinesWithRankUps(client);
  return { success: true, rows: rows.filter((s) => s.rank_up && s.rank_up.nextBuild).map((s) => ({ cid: String(s.cid), subName: s.sub_name, rank: s.rank_up.nextBuild.rank })) };
}, (err) => ({ success: false, error: err.message })));

ipcMain.handle('get-forecast-accuracy', async () => {
  return withClient(async (client) => {
    return { success: true, accuracy: await loadForecastAccuracy(client) };
  }, (err) => {
    return { success: false, error: err.message };
  });
});

// Characters below either threshold, EXCLUDING fully-unbuilt
// characters (zero real subs in companion_submarine_snapshot) -
// matches the old n8n suppression logic: a fresh account's
// default-zero fuel/repair isn't a real problem worth flagging.
ipcMain.handle('get-fleet-warnings', async () => {
  return withClient(async (client) => {
    const { latestCharacter } = await snapshotFragments(client);

    const thresholdResult = await client.query(
      `SELECT setting_key, setting_value FROM fleet_economics_settings
       WHERE setting_key IN ('low_repair_kit_threshold', 'low_ceruleum_threshold')`
    );
    const byKey = {};
    for (const row of thresholdResult.rows) byKey[row.setting_key] = Number(row.setting_value);
    const repairKitThreshold = byKey.low_repair_kit_threshold ?? 0;
    const ceruleumThreshold = byKey.low_ceruleum_threshold ?? 0;

    const result = await client.query(`
      SELECT c.cid, c.name, c.world, c.account_label, c.snapshot_at AS last_synced_at,
             c.repair_kits, c.ceruleum,
             (SELECT COUNT(*) FROM companion_submarine_snapshot s WHERE s.cid = c.cid AND s.level > 0)::int AS subs_built
      FROM ${latestCharacter} c
      ORDER BY c.cid
    `);

    // Characters the plugin no longer syncs keep their last supplies; they are left out and named.
    const behind = notSyncedCharacters(result.rows, await readBehindMinutes(client), await readLoginPcs(client));
    const notSynced = result.rows.filter((r) => behind.has(String(r.cid)))
      .map((r) => ({ cid: r.cid, name: r.name, world: r.world, account_label: r.account_label, behind_ms: behind.get(String(r.cid)) }));

    const warnings = result.rows
      .filter((r) => !behind.has(String(r.cid)))
      .filter((r) => Number(r.subs_built) > 0)
      .filter((r) => r.repair_kits < repairKitThreshold || r.ceruleum < ceruleumThreshold)
      .map((r) => ({
        cid: r.cid,
        character_name: r.name,
        world: r.world,
        account_label: r.account_label,
        repair_kits: r.repair_kits,
        ceruleum: r.ceruleum,
        low_repair: r.repair_kits < repairKitThreshold,
        low_ceruleum: r.ceruleum < ceruleumThreshold
      }));

    // Characters two setups of the plugin keep overwriting (characters/shared-sync.js).
    const sharedSync = await loadSharedCharacters(client, latestCharacter);

    return { success: true, rows: warnings, notSynced, sharedSync, repairKitThreshold, ceruleumThreshold };
  }, (err) => {
    return { success: false, error: err.message };
  });
});

ipcMain.handle('set-craft-enabled', async (event, { cid, subName, enabled } = {}) => {
  return withClient(async (client) => {
    await client.query(
      `INSERT INTO sub_craft_toggle (cid, sub_name, craft_enabled, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (cid, sub_name) DO UPDATE SET craft_enabled = EXCLUDED.craft_enabled, updated_at = now()`,
      [cid, subName, enabled]
    );
    return { success: true };
  }, (err) => {
    return { success: false, error: err.message };
  });
});

module.exports = { loadSubmarines, loadSubmarinesWithRankUps, saveForecastsNow, loadForecastAccuracy, loadStatTables, loadRankUpGameData };
