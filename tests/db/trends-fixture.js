// The Trends tab's answers for a made-up history, for the plugin's own Trends page to be checked against (plugin 2.0
// Trends stage: the plugin reads companion_metric_history itself, with the same chart query as db/metric-series.js).
// It writes made-up characters, Free Companies and their recorded values, then asks the app's own calls the way the
// Trends tab, the Summary tiles and the charts on other tabs do (ipc/trends.js: get-metric-catalog,
// get-metric-subjects, get-metric-series), and writes the rows and the answers to one file:
//
//   node tests/db/trends-fixture.js ../XIVFleetCompanion/tests/FleetWriterTests/trends-fixture.json
//
// Without a file it only checks that every request works. Set PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE for a
// scratch server, as its administrator: it makes and drops a database named fleet_trends_check.
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const Module = require('module');

// ipc/trends.js registers its calls with Electron when loaded and works on the app's saved database: both stood in
// for (its calls kept so they can be asked as the window asks them; the database is this script's).
const handlers = new Map();
const original = Module._load;
Module._load = function load(request, ...rest) {
  if (request === 'electron') return { ipcMain: { handle(name, fn) { handlers.set(name, fn); } }, app: { getPath: () => '.', getVersion: () => '0' }, safeStorage: {}, BrowserWindow: { getAllWindows: () => [] } };
  return original.call(this, request, ...rest);
};
const NAME = 'fleet_trends_check';
const settings = () => ({ host: process.env.PGHOST, port: process.env.PGPORT, user: process.env.PGUSER, password: process.env.PGPASSWORD, database: NAME });
const db = require('../../db');
let shared = null;
db.withClient = async (work, onError) => { try { return await work(shared); } catch (err) { return onError(err); } };
db.loadPostgresConfig = () => settings();
db.createPgClient = (config) => new Client(config);
require('../../ipc/trends');
Module._load = original;

const DB = path.join(__dirname, '..', '..', 'db');
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const SALVAGE = [22500, 22501, 22502, 22503, 22504, 22505, 22506, 22507];

// mulberry32, as the other fixtures.
function randomFrom(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

async function insert(client, table, rows) {
  for (let start = 0; start < rows.length; start += 500) {
    const batch = rows.slice(start, start + 500);
    const cols = Object.keys(batch[0]);
    const values = [];
    const tuples = batch.map((r) => `(${cols.map((c) => { values.push(typeof r[c] === 'bigint' ? r[c].toString() : r[c]); return `$${values.length}`; }).join(', ')})`);
    await client.query(`INSERT INTO ${table} (${cols.join(', ')}) VALUES ${tuples.join(', ')}`, values);
  }
}

// Made-up characters (some in Free Companies, one with no world, one renamed in the sort order) and 40 days of their
// values: each changes now and then (a row when it changes) with an hourly "still the same" row in between, as the
// plugin records them. A few start late (their charts begin with a gap) and one character stopped being recorded.
function madeUp(now) {
  const random = randomFrom(2026);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const t = { companion_character_current: [], character_sort_order: [], companion_character_housing: [], companion_metric_history: [] };
  const fcs = [9232379236109516800n, 9232379236109516801n, 9232379236109516802n];
  for (const [k, fc] of fcs.entries()) {
    // The FC's own rows: one housing row per member (the newest name counts).
    t.companion_character_housing.push({ cid: 18014498578009000n + BigInt(k), fc_id: fc, fc_name: k === 2 ? null : `Company ${k}`, fc_master: k === 1 ? null : `Leader ${k}`,
      updated_at: new Date(now - (k + 1) * HOUR) });
  }
  const characters = [];
  for (let i = 0; i < 9; i++) {
    const cid = 18014498578000000n + BigInt(i);
    const fc = i < 7 ? fcs[i % 3] : null;
    characters.push({ cid, fc });
    t.companion_character_current.push({ cid, name: `Char${i}`, world: i === 4 ? null : pick(['Maduin', 'Golem', 'Siren']), account_label: pick(['A', 'B', null]),
      gil: 0, ceruleum: 0, repair_kits: 0, retainer_count: 0, submarine_count: 0, num_sub_slots: 4, fc_id: fc,
      first_seen_at: new Date(now - 60 * DAY), last_synced_at: new Date(now - 60000) });
    if (i !== 3) t.character_sort_order.push({ cid, sort_index: (i * 7) % 10 });
  }
  const start = now - 40 * DAY;
  function record(subjectType, subjectId, metric, base, wobble, { from = start, until = now, every = 6 } = {}) {
    let value = base;
    let at = from + random() * HOUR;
    let lastWritten = null;
    while (at < until) {
      if (lastWritten === null || random() < 0.35) {
        value = Math.max(0, Math.round(value + (random() - 0.4) * wobble));
        t.companion_metric_history.push({ recorded_at: new Date(at), subject_type: subjectType, subject_id: subjectId, metric, value });
        lastWritten = value;
      } else {
        // An hourly "still the same" row.
        t.companion_metric_history.push({ recorded_at: new Date(at), subject_type: subjectType, subject_id: subjectId, metric, value: lastWritten });
      }
      at += (every * (0.5 + random())) * HOUR;
    }
  }
  for (const [i, { cid, fc }] of characters.entries()) {
    const from = i === 5 ? now - 10 * DAY : start;          // started late
    const until = i === 6 ? now - 12 * DAY : now;           // no longer recorded
    record('character', cid, 'gil', 1e6 + random() * 5e7, 4e5, { from, until });
    record('character', cid, 'ceruleum', 3000 + random() * 6000, 900, { from, until });
    record('character', cid, 'repair_kits', 500 + random() * 2000, 300, { from, until });
    record('character', cid, 'retainer_count', 2 + Math.floor(random() * 8), 1, { from, until, every: 48 });
    record('character', cid, 'submarine_count', 1 + Math.floor(random() * 4), 1, { from, until, every: 72 });
    record('character', cid, 'num_sub_slots', 4, 0, { from, until, every: 96 });
    if (fc && i < 3) record('character', cid, 'fc_points', 1e5 + random() * 2e6, 3e4, { from, until });
    for (const id of SALVAGE) if (random() < 0.6) record('character', cid, `item_qty:${id}`, Math.floor(random() * 30), 6, { from, until, every: 12 });
  }
  for (const fc of fcs) {
    record('fc', fc, 'fc_points', 2e5 + random() * 4e6, 5e4);
    for (const id of SALVAGE) if (random() < 0.5) record('fc', fc, `item_qty:${id}`, Math.floor(random() * 50), 8, { every: 12 });
  }
  return t;
}

// The newest row of each value, as the plugin keeps companion_metric_latest.
function latestOf(history) {
  const latest = new Map();
  for (const r of history) {
    const key = `${r.subject_type}|${r.subject_id}|${r.metric}`;
    const kept = latest.get(key);
    if (!kept || kept.recorded_at <= r.recorded_at) latest.set(key, r);
  }
  return [...latest.values()].map((r) => ({ subject_type: r.subject_type, subject_id: r.subject_id, metric: r.metric, value: r.value, recorded_at: r.recorded_at }));
}

const prices = { 22500: 8000, 22501: 9000, 22502: 10000, 22503: 13000, 22504: 27000, 22505: 28500, 22506: 30000, 22507: 34500 };
const items = (weightOf, subjectType) => SALVAGE.map((id) => ({ metric: `item_qty:${id}`, subjectType, weight: weightOf(id) }));

// The requests the Trends tab, the Summary tiles, the cards on other tabs and the detail panel make (renderer/trends.jsx).
function requests(now, firstRecorded, ids) {
  const ago = (ms) => new Date(now - ms).toISOString();
  const at = new Date(now).toISOString();
  return [
    { name: 'gil, whole fleet, 30 days', from: ago(30 * DAY), to: at, points: 150, parts: [{ metric: 'gil', subjectType: 'character' }] },
    { name: 'gil, 4 characters compared (one never recorded), 7 days', from: ago(7 * DAY), to: at, points: 168,
      parts: [{ metric: 'gil', subjectType: 'character' }], subjectIds: [ids.c[0], ids.c[5], ids.c[6], '18014498578999999'] },
    { name: 'ceruleum, whole fleet, 24 hours', from: ago(DAY), to: at, points: 144, parts: [{ metric: 'ceruleum', subjectType: 'character' }] },
    { name: 'repair kits, one character, 90 days', from: ago(90 * DAY), to: at, points: 150, parts: [{ metric: 'repair_kits', subjectType: 'character' }], subjectIds: [ids.c[2]] },
    { name: 'salvage value, whole fleet (characters and FC chests), 1 year', from: ago(365 * DAY), to: at, points: 150,
      parts: [...items((id) => prices[id], 'character'), ...items((id) => prices[id], 'fc')] },
    { name: 'salvage items, Free Companies compared, 7 days', from: ago(7 * DAY), to: at, points: 168, parts: items(() => 1, 'fc'), subjectIds: ids.f },
    { name: 'FC points, whole fleet, all time', from: new Date(firstRecorded).toISOString(), to: at, points: 150, parts: [{ metric: 'fc_points', subjectType: 'fc' }] },
    { name: 'FC points, a character leading its FC, 30 days', from: ago(30 * DAY), to: at, points: 120, parts: [{ metric: 'fc_points', subjectType: 'character' }], subjectIds: [ids.c[1]] },
    { name: 'retainers, whole fleet, 30 days (a Summary tile size)', from: ago(30 * DAY), to: at, points: 30, parts: [{ metric: 'retainer_count', subjectType: 'character' }] },
    { name: 'gil, zoomed into 20 minutes (not rounded to minutes)', from: new Date(now - 3 * DAY - 7777).toISOString(), to: new Date(now - 3 * DAY + 20 * 60000 - 7777).toISOString(),
      points: 150, parts: [{ metric: 'gil', subjectType: 'character' }] },
    { name: 'gil, zoomed into 5 hours (rounded to minutes)', from: new Date(now - 5 * DAY - 12345).toISOString(), to: new Date(now - 5 * DAY + 5 * HOUR - 12345).toISOString(),
      points: 150, parts: [{ metric: 'gil', subjectType: 'character' }] },
    { name: 'sub slots, a character, before anything was recorded', from: ago(400 * DAY), to: ago(300 * DAY), points: 20, parts: [{ metric: 'num_sub_slots', subjectType: 'character' }], subjectIds: [ids.c[0]] },
    { name: 'refused: the end before the start', from: at, to: ago(DAY), points: 20, parts: [{ metric: 'gil', subjectType: 'character' }] },
    { name: 'refused: too many points', from: ago(DAY), to: at, points: 1001, parts: [{ metric: 'gil', subjectType: 'character' }] },
  ];
}

const plain = (v) => (typeof v === 'bigint' ? v.toString() : v instanceof Date ? v.getTime() : v);
const rowOf = (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, plain(v)]));

(async () => {
  const out = process.argv[2];
  const admin = new Client();
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${NAME}`);
  await admin.query(`CREATE DATABASE ${NAME}`);
  const client = new Client(settings());
  await client.connect();
  shared = client;
  const realNow = Date.now;
  try {
    await client.query(fs.readFileSync(path.join(DB, 'schema.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(DB, 'views.sql'), 'utf8'));
    // Whole seconds, so the requests' times are the same on both sides.
    const now = Math.floor(realNow() / 1000) * 1000;
    const tables = madeUp(now);
    // A value recorded exactly at a chart point (the start of the 30-day charts, rounded to the minute): it counts there.
    tables.companion_metric_history.push({ recorded_at: new Date(Math.floor((now - 30 * DAY) / 60000) * 60000), subject_type: 'character',
      subject_id: tables.companion_character_current[0].cid, metric: 'gil', value: 777777 });
    for (const [table, rows] of Object.entries(tables)) if (rows.length) await insert(client, table, rows);
    const latest = latestOf(tables.companion_metric_history);
    await insert(client, 'companion_metric_latest', latest);
    const firstRecorded = Math.min(...tables.companion_metric_history.map((r) => r.recorded_at.getTime()));
    const ids = { c: tables.companion_character_current.map((c) => c.cid.toString()), f: ['9232379236109516800', '9232379236109516801', '9232379236109516802'] };

    Date.now = () => now;
    const catalog = await handlers.get('get-metric-catalog')();
    const subjects = await handlers.get('get-metric-subjects')();
    const series = [];
    for (const request of requests(now, firstRecorded, ids)) {
      const { name, ...asked } = request;
      const answer = await handlers.get('get-metric-series')(null, asked);
      series.push({ name, request: asked, answer });
      const shown = answer.success ? `${answer.series.length} series, ${answer.series.reduce((n, s) => n + s.values.filter((v) => v !== null).length, 0)} values` : `refused: ${answer.error}`;
      console.log(`${name}: ${shown}`);
    }
    Date.now = realNow;
    if (!catalog.success || !subjects.success) throw new Error(catalog.error || subjects.error);
    console.log(`catalog: ${catalog.rows.length} values; subjects: ${subjects.characters.length} characters, ${subjects.fcs.length} Free Companies`);

    if (out) {
      fs.writeFileSync(out, `${JSON.stringify({
        about: 'Written by XIVFleetCompanion-App tests/db/trends-fixture.js: a made-up recorded history and the app\'s Trends answers for it.',
        now,
        tables: Object.fromEntries(Object.entries({ ...tables, companion_metric_latest: latest }).map(([k, rows]) => [k, rows.map(rowOf)])),
        catalog: { ...catalog, rows: catalog.rows.map((r) => ({ ...r, firstRecorded: plain(r.firstRecorded), lastRecorded: plain(r.lastRecorded) })) },
        subjects,
        series,
      })}\n`);
      console.log(`written to ${out}`);
    }
  } finally {
    Date.now = realNow;
    await client.end();
    await admin.query(`DROP DATABASE IF EXISTS ${NAME}`);
    await admin.end();
  }
})().catch((e) => { console.error(e); process.exit(1); });
