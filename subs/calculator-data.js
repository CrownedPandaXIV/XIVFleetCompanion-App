// The Sub Calculator's outside data (subs/calculator-data.json): per sector, the loot each tier can give and the
// breakpoints, from XIVStats (MIT licence, collected from players running the Tracky plugin) with Pepper's FFXIV Ship
// Guide's breakpoints beside them. Sector names, ranks, positions and parts come from the game's own files, not this.
// .github/scripts/refresh-sub-data.js makes the file; it is made again at each release. No Electron here.
//
// The file:
//   about:   { xivstats: { updated, commit }, pepper: { sheet, fetched } | null, made }
//   sectors: [{ id, name, letter, rank, unlockedFrom, records, xivstats, pepper, seen, pools }]
//     xivstats / pepper / seen: breakpoints [T2, T3, normal, optimal, favor] (surveillance for T2 and T3, retrieval for
//       normal and optimal, favor for a double dip). xivstats is XIVStats' table, pepper Pepper's sheet (null when the
//       sheet has no row for it), seen the lowest stat XIVStats' records show getting each one (null when none did).
//     pools: { "1" | "2" | "3": { records, stats, loot: [[itemId, times, total, wasT3, poorMin, poorMax, normalMin,
//       normalMax, optimalMin, optimalMax]] } } as XIVStats counts them: records = voyages that rolled this tier,
//       times = how often the item came, total = how many in all.
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'calculator-data.json');
const BREAKPOINTS = ['t2', 't3', 'normal', 'optimal', 'favor'];
const LOOT_FIELDS = 10;

const isCount = (n) => Number.isInteger(n) && n >= 0;
const isBreakpoints = (b) => Array.isArray(b) && b.length === 5 && b.every(isCount);

// What is wrong with the data, as plain sentences (none when it is fine to use).
function problems(data) {
  const out = [];
  if (!data || typeof data !== 'object') return ['The data is not an object.'];
  if (!data.about || !data.about.xivstats || !data.about.xivstats.updated) out.push('It does not say when XIVStats was last updated.');
  if (!Array.isArray(data.sectors) || !data.sectors.length) return [...out, 'It has no sectors.'];
  const seenIds = new Set();
  for (const s of data.sectors) {
    const name = `Sector ${s && s.id}`;
    if (!s || !isCount(s.id) || s.id === 0) { out.push(`${name}: no id.`); continue; }
    if (seenIds.has(s.id)) out.push(`${name}: listed twice.`);
    seenIds.add(s.id);
    if (!isBreakpoints(s.xivstats)) out.push(`${name}: no XIVStats breakpoints.`);
    if (s.pepper !== null && !isBreakpoints(s.pepper)) out.push(`${name}: Pepper's breakpoints are not five numbers.`);
    if (s.seen !== null && !(Array.isArray(s.seen) && s.seen.length === 5 && s.seen.every((v) => v === null || isCount(v)))) out.push(`${name}: the seen minimums are not five numbers.`);
    if (!s.pools || typeof s.pools !== 'object' || !s.pools['1']) { out.push(`${name}: no Tier 1 loot.`); continue; }
    for (const [tier, pool] of Object.entries(s.pools)) {
      if (!['1', '2', '3'].includes(tier)) out.push(`${name}: a loot tier "${tier}".`);
      if (!pool || !isCount(pool.records) || !Array.isArray(pool.loot)) { out.push(`${name}: Tier ${tier} loot is not a list.`); continue; }
      if (pool.loot.some((l) => !Array.isArray(l) || l.length !== LOOT_FIELDS || !l.every(isCount))) out.push(`${name}: Tier ${tier} has an item that is not ${LOOT_FIELDS} numbers.`);
    }
  }
  return out;
}

let cached = null;
// The data shipped with the app (read once).
function load(file = FILE) {
  if (file === FILE && cached) return cached;
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (file === FILE) cached = data;
  return data;
}

module.exports = { FILE, BREAKPOINTS, problems, load };
