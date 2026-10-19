// Settings → Database → Speed check: what makes the tabs slow to load. How long connecting to the database
// takes (every tab opens a fresh connection), how long one question to it takes, how the app finds each
// character's current name and world (the plugin's current table, or the slower search of the history),
// how big the database is, and what else it is busy with. It only reads. The window then times each tab's
// loading itself, and speedFindings() turns all of it into plain-language findings.
const { chooseSnapshotSource } = require('./snapshot-fragments');

const CONNECT_TRIES = 3;
const ROUND_TRIPS = 5;
// Above these, it's worth saying.
const SLOW_CONNECT_MS = 300;
const SLOW_ROUND_TRIP_MS = 40;
const SLOW_TAB_MS = 1500;

const median = (list) => {
  const sorted = [...list].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null;
};
const ms = (start, now) => Math.round(now() - start);

// config: the saved connection; createClient(config) makes a client (db/index.js createPgClient).
async function measureDatabase(config, { createClient, now = () => performance.now() }) {
  const result = { connectMs: [], roundTripMs: null, source: null, sizes: null, busy: null };
  for (let i = 0; i < CONNECT_TRIES; i++) {
    const start = now();
    const c = createClient(config);
    try {
      await c.connect();
      await c.query('SELECT 1');
      result.connectMs.push(ms(start, now));
    } finally {
      await c.end().catch(() => {});
    }
  }

  const client = createClient(config);
  try {
    await client.connect();
    const trips = [];
    for (let i = 0; i < ROUND_TRIPS; i++) {
      const start = now();
      await client.query('SELECT 1');
      trips.push(ms(start, now));
    }
    result.roundTripMs = median(trips);

    const start = now();
    const choice = await chooseSnapshotSource(client);
    // Each table only when it exists: a newer database has no history table, and a question naming a missing
    // table fails even where it wouldn't be read.
    const has = (await client.query(`SELECT to_regclass('companion_character_current') IS NOT NULL AS current,
                                            to_regclass('companion_character_snapshot') IS NOT NULL AS history`)).rows[0];
    const newest = async (sql) => (await client.query(sql)).rows[0].at;
    const times = {
      current_at: has.current ? await newest('SELECT max(last_synced_at) AS at FROM companion_character_current') : null,
      history_at: has.history ? await newest('SELECT max(snapshot_at) AS at FROM companion_character_snapshot') : null,
    };
    result.source = { ...choice, checkMs: ms(start, now), currentAt: times.current_at, historyAt: times.history_at };

    const sizes = await client.query(`
      SELECT c.relname AS table, pg_total_relation_size(c.oid) AS bytes, greatest(c.reltuples, 0)::bigint AS rows
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind = 'r' AND n.nspname = 'public'
       ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 5`);
    const total = (await client.query('SELECT pg_database_size(current_database()) AS bytes')).rows[0].bytes;
    result.sizes = { totalBytes: Number(total), biggest: sizes.rows.map((r) => ({ table: r.table, bytes: Number(r.bytes), rows: Number(r.rows) })) };

    // Other connections to this database that are working right now (a backup, the plugin writing, a clean-up).
    const busy = (await client.query(`
      SELECT count(*) FILTER (WHERE state = 'active')::int AS active,
             count(*) FILTER (WHERE application_name ILIKE 'pg_dump%')::int AS backups
        FROM pg_stat_activity
       WHERE datname = current_database() AND pid <> pg_backend_pid()`)).rows[0];
    result.busy = { active: busy.active, backups: busy.backups };
  } finally {
    await client.end().catch(() => {});
  }
  return result;
}

// From `tailscale ping` output: how this PC reaches the database PC. "pong from desktop2 (100.64.1.2) via
// DERP(nyc) in 48ms" goes through one of Tailscale's relay servers; "via 192.168.1.20:41641" is direct.
function tailscaleRoute(output) {
  const pongs = String(output || '').split(/\r?\n/).filter((l) => /^pong from /.test(l.trim()));
  const last = pongs[pongs.length - 1];
  if (!last) return null;
  const m = /via (\S+) in ([\d.]+)ms/.exec(last);
  if (!m) return null;
  const relay = /^DERP\(([^)]*)\)/.exec(m[1]);
  return { relay: !!relay, relayName: relay ? relay[1] : null, via: m[1], ms: Math.round(Number(m[2])) };
}

const seconds = (n) => `${(n / 1000).toFixed(1)} seconds`;
const minutesBetween = (a, b) => Math.round((new Date(a) - new Date(b)) / 60000);

// measured: measureDatabase()'s result plus { tailscale: tailscaleRoute() or null, local: true when the
// database is on this PC }; tabs: [{ tab, ms, error }] as the window timed them. Returns [{ level: 'ok' |
// 'slow', text }], the slow ones first.
function speedFindings(measured, tabs = []) {
  const out = [];
  const connect = median(measured.connectMs);
  if (connect !== null) {
    out.push(connect > SLOW_CONNECT_MS
      ? { level: 'slow', text: `Connecting to the database takes ${connect} ms, and every tab connects afresh each time it loads. That alone adds ${connect} ms or more to each tab.` }
      : { level: 'ok', text: `Connecting to the database takes ${connect} ms.` });
  }
  if (measured.roundTripMs !== null) {
    out.push(measured.roundTripMs > SLOW_ROUND_TRIP_MS
      ? { level: 'slow', text: `Each question to the database takes ${measured.roundTripMs} ms to come back, before any work is done. A tab asks several, so the distance to the database PC adds up.` }
      : { level: 'ok', text: `Each question to the database takes ${measured.roundTripMs} ms to come back.` });
  }
  const ts = measured.tailscale;
  if (ts && ts.relay) {
    out.push({ level: 'slow', text: `Tailscale can't reach the database PC directly, so everything goes through its relay server${ts.relayName ? ` (${ts.relayName})` : ''}, ${ts.ms} ms each way. Restarting Tailscale on both PCs often gets a direct connection back.` });
  } else if (ts) {
    out.push({ level: 'ok', text: `Tailscale reaches the database PC directly (${ts.ms} ms).` });
  }

  const src = measured.source;
  if (src && src.useCurrent) {
    out.push({ level: 'ok', text: "Characters are read from the plugin's current table, the fast way." });
  } else if (src && src.currentAt && src.historyAt) {
    const behind = minutesBetween(src.historyAt, src.currentAt);
    out.push({ level: 'slow', text: `Characters are read the slow way, from the whole history, because the plugin's current table is ${behind} minutes behind its history. A PC with an old plugin, or one that stopped part-way through a sync, can cause this. Check every PC's plugin version on the PCs tab.` });
  } else if (src && !src.useCurrent) {
    out.push({ level: 'slow', text: `Characters are read the slow way, from the whole history${src.hasCidIndex ? '' : ', without the index that speeds that up'}.` });
  }

  if (measured.busy && measured.busy.backups > 0) {
    out.push({ level: 'slow', text: 'A backup of the database is running right now, which slows everything else down until it finishes.' });
  } else if (measured.busy && measured.busy.active > 2) {
    out.push({ level: 'slow', text: `The database is busy with ${measured.busy.active} other jobs right now (the plugin syncing, a clean-up). Try the speed check again in a few minutes.` });
  }

  const slowTabs = tabs.filter((t) => !t.error && t.ms > SLOW_TAB_MS).sort((a, b) => b.ms - a.ms);
  if (slowTabs.length) {
    out.push({ level: 'slow', text: `Slowest tabs: ${slowTabs.map((t) => `${t.tab} (${seconds(t.ms)})`).join(', ')}.` });
  } else if (tabs.length) {
    out.push({ level: 'ok', text: `Every tab loaded its data in under ${seconds(SLOW_TAB_MS)}.` });
  }
  for (const t of tabs.filter((x) => x.error)) out.push({ level: 'slow', text: `${t.tab} couldn't load: ${t.error}` });

  return [...out.filter((f) => f.level === 'slow'), ...out.filter((f) => f.level === 'ok')];
}

// Runs `work(client)` with every database question it asks timed: { ms, questions: [{ ms, rows, bytes, what }] },
// the slowest question first. `what` is the start of the question, enough to tell which one it is.
async function traceQueries(client, work, now = () => performance.now()) {
  const questions = [];
  const traced = Object.create(client);
  traced.query = async (sql, params) => {
    const start = now();
    const result = await client.query(sql, params);
    const rows = result && Array.isArray(result.rows) ? result.rows : [];
    questions.push({ ms: Math.round(now() - start), rows: rows.length, bytes: JSON.stringify(rows).length, what: String(sql).replace(/\s+/g, ' ').trim().slice(0, 120) });
    return result;
  };
  const start = now();
  await work(traced);
  return { ms: Math.round(now() - start), questions: questions.sort((a, b) => b.ms - a.ms) };
}

// The detail part of the report: for each part measured, its time and its slowest questions.
function detailLines(details, top = 6) {
  const lines = [];
  for (const d of details || []) {
    if (d.error) {
      lines.push(`  ${d.part}: couldn't measure (${d.error})`);
      continue;
    }
    const kb = d.questions.reduce((t, q) => t + q.bytes, 0) / 1024;
    lines.push(`  ${d.part}: ${d.ms} ms, ${d.questions.length} questions, ${kb.toFixed(0)} KB`);
    for (const q of d.questions.slice(0, top)) lines.push(`    ${q.ms} ms, ${q.rows} rows, ${(q.bytes / 1024).toFixed(0)} KB: ${q.what}`);
  }
  return lines;
}

// The whole result as text, to copy and send.
function speedReport({ measured, tabs, findings, details = null, appVersion, when = new Date() }) {
  const mb = (b) => `${(b / 1048576).toFixed(1)} MB`;
  const lines = [`XIV Fleet Companion ${appVersion} speed check, ${when.toLocaleString()}`, ''];
  for (const f of findings) lines.push(`${f.level === 'slow' ? '[slow]' : '[ok]  '} ${f.text}`);
  lines.push('', `Connecting: ${measured.connectMs.join(', ')} ms. One question: ${measured.roundTripMs} ms.`);
  if (measured.tailscale) lines.push(`Tailscale: via ${measured.tailscale.via}, ${measured.tailscale.ms} ms.`);
  if (measured.source) {
    const s = measured.source;
    lines.push(`Characters: ${s.useCurrent ? 'current table' : 'history'}; current table up to ${s.currentAt ? new Date(s.currentAt).toLocaleString() : '-'}, history up to ${s.historyAt ? new Date(s.historyAt).toLocaleString() : '-'}; history indexes: ${s.hasCidIndex ? 'yes' : 'no'}/${s.hasFcIndex ? 'yes' : 'no'}.`);
  }
  if (measured.sizes) {
    lines.push(`Database: ${mb(measured.sizes.totalBytes)}. Biggest: ${measured.sizes.biggest.map((t) => `${t.table} ${mb(t.bytes)} (${t.rows} rows)`).join(', ')}.`);
  }
  if (measured.busy) lines.push(`Other work running: ${measured.busy.active}, backups: ${measured.busy.backups}.`);
  lines.push('', 'Tabs:');
  for (const t of tabs) lines.push(`  ${t.tab}: ${t.error ? `error (${t.error})` : `${t.ms} ms`}`);
  if (details && details.length) lines.push('', "Where Income and Summary spend their time (each question: the database PC's work plus the trip back):", ...detailLines(details));
  return lines.join('\n');
}

module.exports = { measureDatabase, tailscaleRoute, speedFindings, speedReport, traceQueries, detailLines, SLOW_TAB_MS };
