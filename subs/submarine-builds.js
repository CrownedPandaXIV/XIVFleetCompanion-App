// Submarine part and route helpers shared by the Subs and Parts views: part item IDs, repair-kit
// costs, Fight Club route and build parsing, gil/day and speed/range. No database access here.

// Same item-ID -> class-letter mapping used in AllaganToolsConnector.cs
// and the old n8n Parse Submarine Dashboard node - kept in sync with
// both by hand, since it reflects real, unchanging game item IDs.
const SUB_PART_CLASS = {
  21792: 'S', 21793: 'S', 21794: 'S', 21795: 'S',
  21796: 'U', 21797: 'U', 21798: 'U', 21799: 'U',
  22526: 'W', 22527: 'W', 22528: 'W', 22529: 'W',
  23903: 'C', 23904: 'C', 23905: 'C', 23906: 'C',
  24344: 'Y', 24345: 'Y', 24346: 'Y', 24347: 'Y',
  24348: 'S+', 24349: 'S+', 24350: 'S+', 24351: 'S+',
  24352: 'U+', 24353: 'U+', 24354: 'U+', 24355: 'U+',
  24356: 'W+', 24357: 'W+', 24358: 'W+', 24359: 'W+',
  24360: 'C+', 24361: 'C+', 24362: 'C+', 24363: 'C+',
  24364: 'Y+', 24365: 'Y+', 24366: 'Y+', 24367: 'Y+',
};
function partLetter(itemId) {
  return SUB_PART_CLASS[itemId] || String(itemId);
}

// Repair-kit cost per part class - fixed game table (Modified is a flat
// 6 kits regardless of base class), ported directly from the old n8n
// economics engine.
const REPAIR_KITS_BY_CLASS = {
  Shark: 1, Unkiu: 2, Whale: 3, Coelacanth: 4, Syldra: 5,
  'Shark+': 6, 'Unkiu+': 6, 'Whale+': 6, 'Coelacanth+': 6, 'Syldra+': 6,
};
const LETTER_TO_CLASS_NAME = { S: 'Shark', U: 'Unkiu', W: 'Whale', C: 'Coelacanth', Y: 'Syldra' };

// Letter -> ffxiv_submarinepart.class numeric id. Confirmed against
// real in-game tooltips (rank + speed/range matched exactly for all 10
// classes x 4 slots) - not a guess. Modified is base+5, not
// alphabetical (class numbering follows unlock order: Whale/Unkiu/
// Shark/Coelacanth/Syldra, not S/U/W/C/Y).
const LETTER_TO_PART_CLASS_ID = {
  W: 1, U: 2, S: 3, C: 4, Y: 5,
  'W+': 6, 'U+': 7, 'S+': 8, 'C+': 9, 'Y+': 10,
};

function repairKitsFor(partLetters) {
  return partLetters.reduce((sum, letter) => {
    const modified = letter.endsWith('+');
    const base = modified ? letter.slice(0, -1) : letter;
    const className = LETTER_TO_CLASS_NAME[base];
    const key = modified ? `${className}+` : className;
    return sum + (REPAIR_KITS_BY_CLASS[key] || 0);
  }, 0);
}

// Net gil/day for a Fight Club row with a specific build installed,
// spreading that build's repair-kit cost over the row's own real
// repair-cycle length (voyages-until-break x hours / 24).
function netGilPerDay(row, partLetters, repairKitCost) {
  const gilPerDay = Number(row.gil_sub_day) || 0;
  const hours = Number(row.hours) || 24;
  const repairMatch = String(row.repair_times || '').match(/^(\d+)/);
  const voyagesUntilBreak = repairMatch ? Number(repairMatch[1]) : null;
  if (!voyagesUntilBreak) return gilPerDay;
  const cycleDays = (voyagesUntilBreak * hours) / 24;
  const kits = repairKitsFor(partLetters);
  const repairCostPerDay = (kits * repairKitCost) / cycleDays;
  return gilPerDay - repairCostPerDay;
}

// Fight Club's Route column has no separators (e.g. "MROJZ"). Sector
// Points letters run A-Z then AA/AB/... once a map needs more than 26
// points, so a naive per-character split would misparse a multi-letter
// waypoint. Tokenizes against the real set of valid letters instead.
function formatRouteWithDashes(routeStr, validRouteLetters) {
  if (!routeStr) return '';
  const tokens = [];
  let i = 0;
  while (i < routeStr.length) {
    const twoChar = routeStr.slice(i, i + 2);
    const oneChar = routeStr.slice(i, i + 1);
    if (validRouteLetters.has(twoChar)) {
      tokens.push(twoChar);
      i += 2;
    } else {
      tokens.push(oneChar);
      i += 1;
    }
  }
  return tokens.join('-');
}

// Target Route + Target Gil/Day: among every Fight Club row whose Rec
// Build threshold this rank clears, picks whichever has the highest
// Gil/Hr, matching the sheet's own recommendation logic. Only
// activates at rank 85+.
function computeTargetRoute(rank, fightClubRows, repairKitCost, validRouteLetters) {
  if (rank < 85) return { route: '', gilPerDay: '' };
  let best = null;
  for (const row of fightClubRows) {
    const recBuild = parseRankBuild(row.rec_build_notes);
    if (!recBuild) continue;
    if (rank < recBuild.rank) continue;
    const gilHr = Number(row.gil_hr) || 0;
    if (!best || gilHr > best.gilHr) best = { row, recBuild, gilHr };
  }
  if (!best) return { route: '', gilPerDay: '' };
  const partLetters = best.recBuild.parts.map((p) => (p.modified ? `${p.letter}+` : p.letter));
  const net = netGilPerDay(best.row, partLetters, repairKitCost);
  return { route: formatRouteWithDashes(best.row.route, validRouteLetters), gilPerDay: Math.round(net) };
}

// Current Gil/Day: matches the sub's ACTUAL current route + installed
// parts against Fight Club. Route-name variants at different durations
// are the same sectors at different speeds, so among rows sharing this
// route name, use whichever duration-variant's threshold this sub's
// actual rank/parts clears.
function computeCurrentGilPerDay(rank, currentRouteLetters, installedPartLetters, fightClubRows, repairKitCost) {
  if (!currentRouteLetters) return '';
  const routeName = currentRouteLetters.replace(/-/g, '');
  const matchingRows = fightClubRows.filter((r) => r.route === routeName);
  if (matchingRows.length === 0) return '';

  for (const row of matchingRows) {
    const unmod = parseRankBuild(row.unmod_min_rank);
    const modded = parseRankBuild(row.min_rank_build);
    const qualifies = (unmod && rank >= unmod.rank) || (modded && rank >= modded.rank);
    if (qualifies) {
      return Math.round(netGilPerDay(row, installedPartLetters, repairKitCost));
    }
  }
  return '';
}

// Decodes the raw points bytea (one byte per waypoint, 0 = unused
// slot) into a dashed letter route, using
// ffxiv_submarineexploration's real Point ID -> sector letter mapping.
function decodeRoute(pointsBuffer, pointLetterById) {
  if (!pointsBuffer || pointsBuffer.length === 0) return '';
  const bytes = Array.from(pointsBuffer);
  return bytes
    .filter((b) => b > 0)
    .map((b) => pointLetterById.get(b) || `?${b}`)
    .join('-');
}

// Speed/Range: base-at-rank (ffxiv_submarinerank) plus each installed
// part's bonus (ffxiv_submarinepart, via the confirmed class/slot
// mapping). Returns '' (not 0) if the rank's base data or any part's
// data is missing, since a partial total would look valid but be
// wrong.
function computeStat(rank, partLetters, statKey, rankStatsById, partStatsByClassSlot) {
  const base = rankStatsById.get(rank);
  if (!base || base[statKey] === null) return '';
  let total = base[statKey];
  for (let i = 0; i < 4; i++) {
    const classId = LETTER_TO_PART_CLASS_ID[partLetters[i]];
    const partStats = partStatsByClassSlot.get(`${classId}|${i}`);
    if (!partStats) return '';
    total += partStats[statKey];
  }
  return total;
}

// Parses a Fight Club "Rec Build (NOTES)" cell like "128: WSUC++" (uniform
// modifier) or "128: W+S+U+C" (per-letter modifier) into
// { rank, parts: [{letter, modified}, x4] }. Mirrors the old n8n
// Parse Submarine Dashboard / Parse Parts Needed parsing exactly.
function parseRankBuild(str) {
  if (!str) return null;
  const m = String(str).match(/^(\d+)\s*:\s*(.+)$/);
  if (!m) return null;
  const rank = Number(m[1]);
  const buildStr = m[2].trim();

  const allModMatch = buildStr.match(/^([SUWCY])([SUWCY])([SUWCY])([SUWCY])\+\+$/);
  if (allModMatch) {
    return { rank, parts: [1, 2, 3, 4].map((i) => ({ letter: allModMatch[i], modified: true })) };
  }

  const perLetterMatch = buildStr.match(/^([SUWCY]\+?){4}$/);
  if (perLetterMatch) {
    const parts = [];
    let rest = buildStr;
    for (let i = 0; i < 4; i++) {
      const letter = rest[0];
      const modified = rest[1] === '+';
      parts.push({ letter, modified });
      rest = rest.slice(modified ? 2 : 1);
    }
    if (parts.length === 4) return { rank, parts };
  }

  return null;
}

module.exports = {
  partLetter,
  parseRankBuild,
  computeTargetRoute,
  computeCurrentGilPerDay,
  decodeRoute,
  computeStat,
};
