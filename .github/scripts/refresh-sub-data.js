// Makes the Sub Calculator's data file afresh (see subs/calculator-data.js for what it holds) from:
//   - XIVStats (github.com/Infiziert90/FFXIVGachaSpreadsheet, MIT licence): loot and records per sector, and the
//     breakpoints table in its calculator;
//   - Pepper's FFXIV Ship Guide's "Breakpoint data consolidated" sheet: its breakpoints, shown beside XIVStats' where
//     they differ;
// and checks the result against the game's own sector list (xivapi/ffxiv-datamining).
//
//   node .github/scripts/refresh-sub-data.js [file ...]
//
// Writes subs/calculator-data.json, or the files named (the plugin's copy). Run by hand, or each day by sub-data.yml,
// which publishes what it makes for the app and plugin to download. Releases ship the committed copy.
// Nothing here stops a release: when XIVStats can't be read, or what comes back doesn't pass the checks, the file
// stays as it is; when Pepper's sheet can't be read, Pepper's breakpoints stay as they were. Each is said on a
// "::warning::" line, which GitHub shows on the run. Node's own fetch only, no packages.
const fs = require('fs');
const path = require('path');
const { FILE, problems } = require('../../subs/calculator-data');

const XIVSTATS = 'https://raw.githubusercontent.com/Infiziert90/FFXIVGachaSpreadsheet/master/website';
const XIVSTATS_COMMIT = 'https://api.github.com/repos/Infiziert90/FFXIVGachaSpreadsheet/commits/master';
const PEPPER_SHEET = '1x3XYlnAURpBs4oDNRrGTf4mW_Gix5zTxJCKTNfjygsM';
const PEPPER = `https://docs.google.com/spreadsheets/d/${PEPPER_SHEET}`;
const GAME_SECTORS = 'https://raw.githubusercontent.com/xivapi/ffxiv-datamining/master/csv/en/SubmarineExploration.csv';
// A Pepper figure this far from XIVStats' is taken as a typo in the sheet (it has a few, e.g. 5 for 55) and left out.
const PEPPER_TYPO_GAP = 20;

const warn = (text) => console.log(`::warning title=Sub Calculator data::${text}`);

async function get(url, as = 'text') {
  const res = await fetch(url, { headers: { 'user-agent': 'xiv-fleet-companion-release' }, signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return as === 'json' ? res.json() : res.text();
}

// XIVStats' calculator keeps its breakpoints in sector.ts: `28: CreateBreakpoint(130, 150, 155, 200, 120),`.
function parseBreakpoints(ts) {
  const start = ts.indexOf('MapBreakpoints');
  if (start < 0) throw new Error('sector.ts has no MapBreakpoints');
  const out = new Map();
  for (const m of ts.slice(start).matchAll(/(\d+)\s*:\s*CreateBreakpoint\(\s*([\d\s,]+)\)/g)) {
    const values = m[2].split(',').map((v) => Number(v.trim()));
    if (values.length === 5 && values.every(Number.isInteger)) out.set(Number(m[1]), values);
  }
  return out;
}

const decode = (s) => s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
// A sheet page's rows, as lists of cell texts.
function sheetRows(html) {
  return html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/g, '').split(/<\/tr>/i).map((row) =>
    row.split(/<\/t[dh]>/i).map((cell) => decode(cell.replace(/<[^>]+>/g, '')).trim()).filter((c) => c !== ''));
}
// Pepper's rows: "AB: The Rimilala Trench Bottom", rank, T2, T3, normal, optimal, double dip (favor).
function pepperRows(rows) {
  const out = [];
  for (const cells of rows) {
    for (let i = 0; i < cells.length; i++) {
      const m = cells[i].match(/^([A-Z]{1,2})\s*:\s*(.+)$/);
      if (!m) continue;
      const nums = cells.slice(i + 1, i + 7);
      if (nums.length === 6 && nums.every((c) => /^\d+$/.test(c))) out.push({ letter: m[1], name: m[2], values: nums.slice(1).map(Number) });
      break;
    }
  }
  return out;
}
// A sector letter's place on its map: A 0 ... Z 25, AA 26 ...
const letterIndex = (l) => (l.length === 1 ? l.charCodeAt(0) - 65 : 26 * (l.charCodeAt(0) - 64) + l.charCodeAt(1) - 65);
const nameKey = (n) => String(n).toLowerCase().replace(/\([^)]*\)/g, '').replace(/\bthe\b/g, '').replace(/[^a-z0-9]/g, '');

async function readPepper() {
  const front = await get(`${PEPPER}/htmlview`);
  const gids = [...new Set([...front.matchAll(/gid=(\d+)/g)].map((m) => m[1]))];
  if (!gids.length) throw new Error("the sheet lists no tabs");
  const rows = [];
  for (const gid of gids) rows.push(...pepperRows(sheetRows(await get(`${PEPPER}/htmlview/sheet?headers=false&gid=${gid}`))).map((r) => ({ ...r, tab: gid })));
  if (rows.length < 50) throw new Error(`only ${rows.length} rows found`);
  return rows;
}

// The game's sectors (not the maps' starting points), for the coverage check.
async function readGameSectors() {
  const lines = (await get(GAME_SECTORS)).split(/\r?\n/).filter(Boolean);
  const head = lines[0].split(',');
  const col = (name) => head.indexOf(name);
  const [id, dest, start] = [col('#'), col('Destination'), col('StartingPoint')];
  return lines.slice(1).map((l) => l.split(',')).filter((c) => c[dest] && c[start] === 'False').map((c) => ({ id: Number(c[id]), name: c[dest] }));
}

function lowestSeen(pools) {
  const keys = ['MinT2', 'MinT3', 'MinNormal', 'MinOptimal', 'MinFavor'];
  const seen = keys.map((k) => {
    const values = Object.values(pools).map((p) => p.Stats && p.Stats[k]).filter((v) => Number.isInteger(v) && v > 0 && v < 10000);
    return values.length ? Math.min(...values) : null;
  });
  return seen.every((v) => v === null) ? null : seen;
}

function makeSector(s, breakpoints) {
  const pools = {};
  for (const [key, pool] of Object.entries(s.Pools || {})) {
    const tier = key.replace(/^Tier/, '');
    pools[tier] = {
      records: pool.Records,
      stats: pool.Stats || {},
      loot: Object.values(pool.Rewards || {}).map((r) => [r.Id, r.Amount, r.Total, r.WasT3 || 0,
        ...r.MinMax.Poor, ...r.MinMax.Normal, ...r.MinMax.Optimal]),
    };
  }
  return {
    id: s.Id, name: s.Name, letter: s.Letter, rank: s.Rank, unlockedFrom: s.UnlockedFrom ?? null, records: s.Records,
    xivstats: breakpoints.get(s.Id) || null, pepper: null, seen: lowestSeen(s.Pools || {}), pools,
  };
}

async function main(targets) {
  const old = fs.existsSync(targets[0]) ? JSON.parse(fs.readFileSync(targets[0], 'utf8')) : null;

  let data;
  try {
    const [subs, ts, updated, commit] = await Promise.all([
      get(`${XIVSTATS}/static/data/Submarines.json`, 'json'),
      get(`${XIVSTATS}/src/lib/submarines/sector.ts`),
      get(`${XIVSTATS}/static/data/LastUpdate.json`, 'json'),
      get(XIVSTATS_COMMIT, 'json').then((c) => c.sha).catch(() => null),
    ]);
    const breakpoints = parseBreakpoints(ts);
    const sectors = Object.values(subs.Sectors || {}).map((s) => makeSector(s, breakpoints)).sort((a, b) => a.id - b.id);
    data = { about: { xivstats: { updated: new Date(updated).toISOString(), commit }, pepper: null, made: new Date().toISOString() }, sectors };
  } catch (e) {
    warn(`XIVStats couldn't be read (${e.message}); the data stays as it was.`);
    return 0;
  }

  // Pepper's breakpoints, matched to sectors by name and letter.
  const byName = new Map();
  for (const s of data.sectors) byName.set(nameKey(s.name), [...(byName.get(nameKey(s.name)) || []), s]);
  try {
    const rows = await readPepper();
    const unmatched = [];
    const typos = [];
    const byId = new Map(data.sectors.map((s) => [s.id, s]));
    const byNameOf = (r) => { const found = byName.get(nameKey(r.name)) || []; return found.find((s) => s.letter === r.letter) || (found.length === 1 ? found[0] : null); };
    // A sheet tab is one map, its sectors numbered in letter order: where a name is spelled differently from XIVStats',
    // the letter finds it (the map's first id, from the tab's other rows, plus the letter's place).
    const firstIdOfTab = new Map();
    for (const r of rows) {
      const s = byNameOf(r);
      if (s && s.letter === r.letter && !firstIdOfTab.has(r.tab)) firstIdOfTab.set(r.tab, s.id - letterIndex(r.letter));
    }
    for (const r of rows) {
      let sector = byNameOf(r);
      if (!sector && firstIdOfTab.has(r.tab)) {
        const s = byId.get(firstIdOfTab.get(r.tab) + letterIndex(r.letter));
        if (s && s.letter === r.letter) sector = s;
      }
      if (!sector) { unmatched.push(`${r.letter}: ${r.name}`); continue; }
      sector.pepper = r.values.map((v, i) => {
        const x = sector.xivstats && sector.xivstats[i];
        if (x != null && Math.abs(v - x) > PEPPER_TYPO_GAP) { typos.push(`${sector.name} ${v} (XIVStats ${x})`); return x; }
        return v;
      });
    }
    data.about.pepper = { sheet: PEPPER_SHEET, fetched: new Date().toISOString() };
    if (unmatched.length) console.log(`Pepper rows with no matching sector (${unmatched.length}): ${unmatched.join('; ')}`);
    if (typos.length) console.log(`Pepper figures taken as typos and replaced by XIVStats' (${typos.length}): ${typos.join('; ')}`);
  } catch (e) {
    warn(`Pepper's sheet couldn't be read (${e.message}); its breakpoints stay as they were.`);
    const before = new Map((old?.sectors || []).map((s) => [s.id, s.pepper]));
    for (const s of data.sectors) s.pepper = before.get(s.id) ?? null;
    data.about.pepper = old?.about?.pepper ?? null;
  }

  // Sectors the game has but the data doesn't (new ones XIVStats hasn't reached yet): the calculator says "no data".
  try {
    const known = new Set(data.sectors.map((s) => s.id));
    const missing = (await readGameSectors()).filter((s) => !known.has(s.id));
    if (missing.length) warn(`No XIVStats data yet for ${missing.length} sector(s): ${missing.map((s) => `${s.id} ${s.name}`).join(', ')}.`);
    const noBreakpoints = data.sectors.filter((s) => !s.xivstats);
    if (noBreakpoints.length) warn(`XIVStats has no breakpoints for: ${noBreakpoints.map((s) => s.name).join(', ')}.`);
  } catch (e) {
    warn(`The game's sector list couldn't be read (${e.message}); coverage not checked.`);
  }

  // Sectors with no breakpoints can't be used: kept out, as the check above says.
  data.sectors = data.sectors.filter((s) => s.xivstats);
  const wrong = problems(data);
  if (wrong.length) {
    warn(`The new data didn't pass the checks, so it stays as it was: ${wrong.slice(0, 5).join(' ')}`);
    return 0;
  }
  const text = `${JSON.stringify(data, null, 0).replace(/\{"id":/g, '\n{"id":')}\n`;
  for (const target of targets) fs.writeFileSync(target, text);
  const differing = data.sectors.filter((s) => s.pepper && s.pepper.some((v, i) => v !== s.xivstats[i])).length;
  console.log(`Sub Calculator data: ${data.sectors.length} sectors, XIVStats updated ${data.about.xivstats.updated}, ` +
    `Pepper ${data.about.pepper ? 'read' : 'not read'}, ${differing} sector(s) where the two differ. Written to ${targets.join(', ')}.`);
  return 0;
}

const targets = process.argv.slice(2).map((t) => path.resolve(t));
main(targets.length ? targets : [FILE]).then((code) => { process.exitCode = code; }, (e) => {
  warn(`Refreshing failed (${e.message}); the data stays as it was.`);
});
