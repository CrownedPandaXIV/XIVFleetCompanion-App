// The Sub Calculator's outside data (subs/calculator-data.json): per sector, the loot each tier can give and the
// breakpoints, from XIVStats (MIT licence, collected from players running the Tracky plugin) with Pepper's FFXIV Ship
// Guide's breakpoints beside them. Sector names, ranks, positions and parts come from the game's own files, not this.
// .github/scripts/refresh-sub-data.js makes the file. The copy shipped is the one in the repository; every 6 hours
// .github/workflows/sub-data.yml makes it afresh and, when it changed and passes .github/scripts/check-sub-data.js,
// publishes it in the Releases repository, where the app (sub-data-update.js) downloads it to its own folder. The newer
// of the two is used (by about.made). No Electron here.
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

// When the data was made (ms), 0 when it doesn't say.
const madeAt = (data) => {
  const t = Date.parse(data && data.about && data.about.made);
  return Number.isFinite(t) ? t : 0;
};
// Whether `data` is fine to use and newer than `than`.
const usableOver = (data, than) => problems(data).length === 0 && madeAt(data) > madeAt(than);

let downloadedFile = null;
let cached = null;
let shipped = null;

// Where the downloaded copy is kept (the app's own folder); set once at start.
function useFolder(dir) {
  downloadedFile = path.join(dir, 'calculator-data.json');
  cached = null;
}

// The data to use: the downloaded copy when it is fine and newer than the shipped one, else the shipped one (read once).
// A file named: that file.
function load(file = FILE) {
  if (file !== FILE) return JSON.parse(fs.readFileSync(file, 'utf8'));
  if (cached) return cached;
  shipped = shipped || JSON.parse(fs.readFileSync(FILE, 'utf8'));
  cached = shipped;
  if (downloadedFile) {
    try {
      const got = JSON.parse(fs.readFileSync(downloadedFile, 'utf8'));
      if (usableOver(got, shipped)) cached = got;
    } catch { /* none downloaded yet, or not readable: the shipped data */ }
  }
  return cached;
}

// A downloaded copy (parsed): kept and used from now on when it is fine and newer than the data in use. Returns
// whether it was. The file is written whole first, then swapped in, so a cut-off write never leaves half a file.
function adopt(data) {
  if (!downloadedFile || !usableOver(data, load())) return false;
  const temp = `${downloadedFile}.new`;
  fs.writeFileSync(temp, JSON.stringify(data));
  fs.renameSync(temp, downloadedFile);
  cached = data;
  return true;
}

// The data in use, for Settings → Data: { made (ISO), downloaded: true when it is a downloaded copy, else the one this
// version shipped with }.
function inUse() {
  const data = load();
  return { made: data.about && data.about.made ? data.about.made : null, downloaded: data !== shipped };
}

module.exports = { FILE, BREAKPOINTS, problems, load, useFolder, adopt, madeAt, inUse };
