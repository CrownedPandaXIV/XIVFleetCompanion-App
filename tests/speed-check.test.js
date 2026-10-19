// Settings → Database → Speed check (db/speed-check.js): reading `tailscale ping`, the findings and the report.
const test = require('node:test');
const assert = require('node:assert');
const { measureDatabase, tailscaleRoute, speedFindings, speedReport } = require('../db/speed-check');

test("Tailscale's route to the database PC: relay or direct", () => {
  assert.deepStrictEqual(tailscaleRoute('pong from desktop2 (100.64.1.2) via DERP(nyc) in 48ms\npong from desktop2 (100.64.1.2) via DERP(nyc) in 51ms\n'),
    { relay: true, relayName: 'nyc', via: 'DERP(nyc)', ms: 51 });
  assert.deepStrictEqual(tailscaleRoute('pong from desktop2 (100.64.1.2) via DERP(nyc) in 48ms\r\npong from desktop2 (100.64.1.2) via 192.168.1.20:41641 in 3ms\r\n'),
    { relay: false, relayName: null, via: '192.168.1.20:41641', ms: 3 });
  assert.strictEqual(tailscaleRoute('no matching peer'), null);
  assert.strictEqual(tailscaleRoute(''), null);
});

const quick = {
  connectMs: [40, 35, 38], roundTripMs: 2, tailscale: null,
  source: { useCurrent: true, hasCidIndex: true, hasFcIndex: true, currentAt: '2026-10-18T10:00:00Z', historyAt: '2026-10-18T10:00:00Z' },
  sizes: { totalBytes: 50 * 1048576, biggest: [{ table: 'companion_metric_history', bytes: 30 * 1048576, rows: 400000 }] },
  busy: { active: 0, backups: 0 },
};

test('a quick database: only ok findings', () => {
  const f = speedFindings(quick, [{ tab: 'Summary', ms: 400 }, { tab: 'Subs', ms: 120 }]);
  assert.ok(f.every((x) => x.level === 'ok'), JSON.stringify(f));
  assert.ok(f.some((x) => /current table, the fast way/.test(x.text)));
  assert.ok(f.some((x) => /Every tab loaded its data in under 1.5 seconds/.test(x.text)));
});

test('each cause of slowness is named, slow ones first, slowest tab first', () => {
  const slow = {
    ...quick,
    connectMs: [900, 1200, 1000], roundTripMs: 90,
    tailscale: { relay: true, relayName: 'nyc', via: 'DERP(nyc)', ms: 80 },
    source: { useCurrent: false, hasCidIndex: true, hasFcIndex: true, currentAt: '2026-10-18T09:00:00Z', historyAt: '2026-10-18T10:00:00Z' },
    busy: { active: 3, backups: 1 },
  };
  const f = speedFindings(slow, [{ tab: 'Subs', ms: 2000 }, { tab: 'Summary', ms: 6400 }, { tab: 'PCs', error: 'timeout' }, { tab: 'Trends', ms: 300 }]);
  const text = f.map((x) => x.text).join('\n');
  assert.match(text, /Connecting to the database takes 1000 ms/);
  assert.match(text, /takes 90 ms to come back/);
  assert.match(text, /relay server \(nyc\), 80 ms/);
  assert.match(text, /slow way, from the whole history, because the plugin's current table is 60 minutes behind/);
  assert.match(text, /A backup of the database is running/);
  assert.match(text, /Slowest tabs: Summary \(6.4 seconds\), Subs \(2.0 seconds\)\./);
  assert.match(text, /PCs couldn't load: timeout/);
  const firstOk = f.findIndex((x) => x.level === 'ok');
  assert.ok(firstOk === -1 || f.slice(firstOk).every((x) => x.level === 'ok'), 'slow findings come first');
});

test('the report holds the numbers to send', () => {
  const tabs = [{ tab: 'Summary', ms: 400 }];
  const report = speedReport({ measured: quick, tabs, findings: speedFindings(quick, tabs), appVersion: '0.34.0', when: new Date('2026-10-18T10:00:00Z') });
  assert.match(report, /XIV Fleet Companion 0.34.0 speed check/);
  assert.match(report, /Connecting: 40, 35, 38 ms\. One question: 2 ms\./);
  assert.match(report, /Characters: current table/);
  assert.match(report, /companion_metric_history 30.0 MB \(400000 rows\)/);
  assert.match(report, /Summary: 400 ms/);
});

test('measuring connects three times, then asks on one connection, and always closes', async () => {
  let t = 0;
  const now = () => (t += 10);
  const opened = [];
  const createClient = () => {
    const c = { ended: false, queries: [] };
    c.connect = async () => {};
    c.end = async () => { c.ended = true; };
    c.query = async (sql) => {
      c.queries.push(sql);
      if (/to_regclass\('companion_character_current'\) IS NOT NULL AS has_current/.test(sql)) return { rows: [{ has_current: true, has_snapshot: false }] };
      if (/AS current,/.test(sql)) return { rows: [{ current: true, history: false }] };
      if (/FROM companion_character_current/.test(sql)) return { rows: [{ at: '2026-10-18T10:00:00Z' }] };
      if (/pg_total_relation_size/.test(sql)) return { rows: [{ table: 'x', bytes: '100', rows: '5' }] };
      if (/pg_database_size/.test(sql)) return { rows: [{ bytes: '1000' }] };
      if (/pg_stat_activity/.test(sql)) return { rows: [{ active: 1, backups: 0 }] };
      return { rows: [{}] };
    };
    opened.push(c);
    return c;
  };
  const m = await measureDatabase({}, { createClient, now });
  assert.strictEqual(opened.length, 4);
  assert.ok(opened.every((c) => c.ended));
  assert.deepStrictEqual(m.connectMs, [10, 10, 10]);
  assert.strictEqual(m.roundTripMs, 10);
  assert.strictEqual(m.source.useCurrent, true);
  assert.deepStrictEqual(m.sizes, { totalBytes: 1000, biggest: [{ table: 'x', bytes: 100, rows: 5 }] });
  assert.deepStrictEqual(m.busy, { active: 1, backups: 0 });
  assert.ok(opened[3].queries.every((q) => /^\s*SELECT/i.test(q)), 'only reads');
  assert.ok(!opened[3].queries.some((q) => /FROM companion_character_snapshot/.test(q)), 'no question names the missing history table');
  assert.strictEqual(m.source.currentAt, '2026-10-18T10:00:00Z');
  assert.strictEqual(m.source.historyAt, null);
});

test('the detail: each database question timed, the slowest first, and in the report', async () => {
  const { traceQueries, detailLines } = require('../db/speed-check');
  let t = 0;
  const now = () => t;
  const client = {
    async query(sql) {
      t += /slow/.test(sql) ? 3000 : 20;
      return { rows: /slow/.test(sql) ? [{ a: 1 }, { a: 2 }] : [] };
    },
  };
  const traced = await traceQueries(client, async (c) => {
    await c.query('SELECT 1');
    await c.query(`SELECT   slow
      FROM somewhere`);
    await c.query('SELECT 2');
  }, now);
  assert.strictEqual(traced.ms, 3040);
  assert.deepStrictEqual(traced.questions.map((q) => [q.ms, q.rows, q.what]), [[3000, 2, 'SELECT slow FROM somewhere'], [20, 0, 'SELECT 1'], [20, 0, 'SELECT 2']]);
  const lines = detailLines([{ part: 'Loot', ...traced }, { part: 'Income figures', error: 'timeout' }]);
  assert.match(lines[0], /^ {2}Loot: 3040 ms, 3 questions, 0 KB$/);
  assert.match(lines[1], /^ {4}3000 ms, 2 rows, 0 KB: SELECT slow FROM somewhere$/);
  assert.strictEqual(lines[lines.length - 1], "  Income figures: couldn't measure (timeout)");
  const report = speedReport({ measured: quick, tabs: [], findings: [], details: [{ part: 'Loot', ...traced }], appVersion: 'x' });
  assert.match(report, /Where Income and Summary spend their time \(each question: the database PC.s work plus the trip back\):\n {2}Loot: 3040 ms/);
});
