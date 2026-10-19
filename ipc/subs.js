// Submarines: the Subs view (routes, gil/day, speed/range), low fuel/repair warnings, Craft? toggle.
const { ipcMain } = require('electron');
const { notSyncedCharacters, readBehindMinutes } = require('../characters/not-synced');
const { withClient, snapshotFragments } = require('../db');
const { metricWindow } = require('../db/metric-window');
const forecastVoyages = require('../subs/voyage-forecast');
const { partLetter, computeTargetRoute, nextFightClubBuild, computeCurrentGilPerDay, decodeRoute, computeStat } = require('../subs/submarine-builds');
const rankUp = require('../subs/rank-up');
const { columnsByKey } = require('./shopping');
const { targetBuildAt, repairKitCostFrom, FIGHT_CLUB_COLUMNS } = require('./parts');

const MEASURE_WINDOW_DAYS = 7;
// How far back collections are looked at for a sub's bonus experience (its last few voyages).
const BONUS_WINDOW_DAYS = 14;
const DAY = 24 * 60 * 60 * 1000;
const quote = (name) => `"${name.replace(/"/g, '""')}"`;

// Real, plugin-written submarine data - no n8n involved. Adds the full
// economics engine on top: Current Route (decoded from raw points),
// Target Route + Target Gil/Day (Fight Club's best-Gil/Hr
// recommendation at this rank), Current Gil/Day (actual installed
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

  const fightClubRows = (await client.query(`SELECT ${FIGHT_CLUB_COLUMNS} FROM fight_club_routes`)).rows;
  const repairKitCost = await repairKitCostFrom(client);
  const topRank = Math.max(0, ...[...rankStatsById.keys()].filter((r) => rankStatsById.get(r).speed !== null));

  const rows = result.rows.map((row) => {
    const partLetters = [row.part1, row.part2, row.part3, row.part4].map(partLetter);
    const rank = row.level;

    const currentRoute = decodeRoute(row.points, pointLetterById);
    const target = computeTargetRoute(rank, fightClubRows, repairKitCost, validRouteLetters);
    const currentGilDay = computeCurrentGilPerDay(rank, currentRoute, partLetters, fightClubRows, repairKitCost);

    const nextLevelExp = Number(row.next_level_exp) || 0;
    const currentExp = Number(row.current_exp) || 0;
    const rankProgressPct = nextLevelExp > 0 ? Math.round((currentExp / nextLevelExp) * 100) : null;

    return {
      cid: row.cid,
      sub_name: row.sub_name,
      character_name: row.character_name,
      world: row.world,
      account_label: row.account_label,
      fc_id: row.fc_id,
      part_letters: partLetters,
      // Fight Club's next more profitable build, for Next Build when the Sub Rules have nothing ahead.
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

// Speed and range per rank (ffxiv_submarinerank) and per part (ffxiv_submarinepart), for computeStat.
async function loadStatTables(client) {
  const rankStatsResult = await client.query(`SELECT id, speed_bonus, range_bonus FROM ffxiv_submarinerank`);
  const rankStatsById = new Map();
  for (const row of rankStatsResult.rows) {
    const rank = Number(row.id);
    rankStatsById.set(rank, {
      speed: row.speed_bonus === null || row.speed_bonus === '' ? null : Number(row.speed_bonus),
      range: row.range_bonus === null || row.range_bonus === '' ? null : Number(row.range_bonus),
    });
  }

  const partStatsResult = await client.query(`SELECT class, slot, speed, range FROM ffxiv_submarinepart`);
  const partStatsByClassSlot = new Map();
  for (const row of partStatsResult.rows) {
    partStatsByClassSlot.set(`${row.class}|${row.slot}`, {
      speed: Number(row.speed) || 0,
      range: Number(row.range) || 0,
    });
  }
  return { rankStatsById, partStatsByClassSlot };
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
  const rules = (await client.query('SELECT rank, cid_override, sub_filter, hull, stern, bow, bridge FROM sub_build_rules')).rows;
  const fightClubRows = (await client.query(`SELECT ${FIGHT_CLUB_COLUMNS} FROM fight_club_routes`)).rows;
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
    // The Sub Rules (or, for a Craft? sub, Fight Club's build at each rank); when they have nothing ahead,
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

ipcMain.handle('get-submarines', async () => {
  return withClient(async (client) => {
    return { success: true, rows: await addRankUps(client, await loadSubmarines(client)) };
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
             (SELECT COUNT(*) FROM companion_submarine_snapshot s WHERE s.cid = c.cid AND s.level > 0) AS subs_built
      FROM ${latestCharacter} c
      ORDER BY c.cid
    `);

    // Characters the plugin no longer syncs keep their last supplies; they are left out and named.
    const behind = notSyncedCharacters(result.rows, await readBehindMinutes(client));
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

    return { success: true, rows: warnings, notSynced, repairKitThreshold, ceruleumThreshold };
  }, (err) => {
    return { success: false, error: err.message };
  });
});

ipcMain.handle('set-craft-enabled', async (event, { cid, subName, enabled }) => {
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

module.exports = { loadSubmarines };
