// Submarines: the Subs view (routes, gil/day, speed/range), low fuel/repair warnings, Craft? toggle.
const { ipcMain } = require('electron');
const { notSyncedCharacters, readBehindMinutes } = require('../characters/not-synced');
const { withClient, snapshotFragments } = require('../db');
const { metricWindow } = require('../db/metric-window');
const { partLetter, computeTargetRoute, computeCurrentGilPerDay, decodeRoute, computeStat } = require('../subs/submarine-builds');
const rankUp = require('../subs/rank-up');
const { columnsByKey } = require('./shopping');
const { targetBuildAt } = require('./parts');

const MEASURE_WINDOW_DAYS = 7;
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
           c.name AS character_name, c.world, c.account_label,
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

  const fightClubResult = await client.query(`
    SELECT route, hours, repair_times, gil_sub_day, gil_hr, rec_build_notes,
           unmod_min_rank, min_rank_build
    FROM fight_club_routes
  `);
  const fightClubRows = fightClubResult.rows;

  const repairKitResult = await client.query(
    `SELECT setting_value FROM fleet_economics_settings WHERE setting_key = 'repair_kit_cost'`
  );
  const repairKitCost = repairKitResult.rows.length > 0 ? Number(repairKitResult.rows[0].setting_value) : 0;

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

// Adds each sub's rank-up estimate: rank_up = { method, perDay | voyage, nextRank, nextRankAt,
// voyages, nextBuild: { rank, build, at, voyages } | null, maxRank } (see rank-up.js).
async function addRankUps(client, subs) {
  const game = await loadRankUpGameData(client);
  const rules = (await client.query('SELECT rank, cid_override, sub_filter, hull, stern, bow, bridge FROM sub_build_rules')).rows;
  const fightClubRows = (await client.query('SELECT rec_build_notes, gil_hr FROM fight_club_routes')).rows;
  const top = rankUp.maxRank(game.expToNext);

  // Recorded rank and experience per slot (plugin 0.7.0), over the window plus the value before it.
  const now = Date.now();
  const windowStart = new Date(now - MEASURE_WINDOW_DAYS * DAY);
  const cids = [...new Set(subs.map((s) => String(s.cid)))];
  const metrics = [1, 2, 3, 4].flatMap((slot) => [`sub_rank:${slot}`, `sub_exp:${slot}`]);
  const points = await metricWindow(client, 'character', metrics, windowStart, cids);

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
    const calculated = trip ? { ...trip, returnAt } : null;
    const out = { returnAt, hours: trip ? trip.hours : null };

    const method = measured ? 'measured' : calculated ? 'calculated' : null;
    const rate = { measured: method === 'measured' ? measured : null, calculated: method === 'calculated' ? calculated : null };
    const dateFor = (targetRank) => rankUp.rankDate({ rank: sub.rank, exp: sub.current_exp, targetRank, expToNext: game.expToNext, ...rate, out, now });

    const next = sub.rank < top ? dateFor(sub.rank + 1) : null;
    const buildAt = (rank) => targetBuildAt({ rank, slot: sub.slot, cid, craftEnabled: sub.craft_enabled, rules, fightClubRows });
    const switchTo = rankUp.nextBuildRank(sub.rank, top, buildAt);
    const switchAt = switchTo ? dateFor(switchTo.rank) : null;

    sub.rank_up = {
      method,
      outAtSea: method === 'measured' && returnAt > now,
      perDay: measured ? measured.perDay : null,
      voyage: calculated ? { exp: calculated.exp, hours: calculated.hours } : null,
      maxRank: top,
      nextRank: sub.rank < top ? sub.rank + 1 : null,
      nextRankAt: next && next.at ? next.at : null,
      voyages: next && next.voyages ? next.voyages : null,
      nextBuild: switchTo ? {
        rank: switchTo.rank,
        build: switchTo.build.map((letter) => letter || '·').join(''),
        at: switchAt && switchAt.at ? switchAt.at : null,
        voyages: switchAt && switchAt.voyages ? switchAt.voyages : null,
      } : null,
    };
    delete sub.points;
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
