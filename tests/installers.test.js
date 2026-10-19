// "Set up this PC": what each kind of PC gets, the pinned downloads, PostgreSQL's answers file, downloading
// with the checksum check (from a stand-in server), Tailscale's sign-in output, and the whole run with the
// Windows parts stood in.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const inst = require('../setup/installers');
const { stepsFor, runSetup } = require('../setup/run-setup');

test('each kind of PC gets what it needs, and nothing already installed is downloaded again', () => {
  const p = (role, o) => inst.setupPlan(role, o);
  const pick = (x) => [x.installPostgres, x.installTailscale, x.createDatabase, x.openConnections, x.askConnection];
  assert.deepStrictEqual(pick(p('onepc')), [true, false, true, false, false], 'one PC: PostgreSQL only');
  assert.deepStrictEqual(pick(p('dbhost')), [true, true, true, true, false], 'database PC: PostgreSQL, Tailscale, open to others');
  assert.deepStrictEqual(pick(p('dbhost', { sameNetwork: true })), [true, false, true, true, false], 'same house: no Tailscale');
  assert.deepStrictEqual(pick(p('connect')), [false, true, false, false, true], 'connecting PC: Tailscale only');
  assert.deepStrictEqual(pick(p('plugin', { sameNetwork: true })), [false, false, false, false, true], 'plugin PC at home: nothing to install');
  const already = p('dbhost', { installed: { postgres: true, tailscale: true } });
  assert.deepStrictEqual(pick(already), [false, false, true, true, false]);
  assert.ok(already.alreadyPostgres && already.alreadyTailscale && already.tailscale);
  assert.strictEqual(p('nonsense'), null);
});

test('the setup screen lists the steps in order, with one permission prompt for everything that needs it', () => {
  assert.deepStrictEqual(stepsFor(inst.setupPlan('dbhost')).map((s) => s.id), ['downloadPostgres', 'downloadTailscale', 'admin', 'database']);
  assert.match(stepsFor(inst.setupPlan('dbhost')).find((s) => s.id === 'admin').label, /^Install PostgreSQL, install Tailscale, let other PCs connect \(Windows asks/);
  assert.deepStrictEqual(stepsFor(inst.setupPlan('dbhost', { installed: { postgres: true, tailscale: true } })).map((s) => s.id), ['admin', 'database']);
  assert.deepStrictEqual(stepsFor(inst.setupPlan('connect', { installed: { tailscale: true } })), []);
});

test('the downloads come from the makers over https, with a full checksum; ARM PCs get Tailscale but not PostgreSQL', () => {
  for (const what of ['postgres', 'tailscale']) {
    const f = inst.downloadFor(what, 'x64');
    assert.match(f.url, what === 'postgres' ? /^https:\/\/get\.enterprisedb\.com\/postgresql\// : /^https:\/\/pkgs\.tailscale\.com\/stable\//);
    assert.match(f.sha256, /^[0-9A-F]{64}$/);
  }
  assert.match(inst.downloadFor('tailscale', 'arm64').url, /arm64\.msi$/);
  assert.strictEqual(inst.downloadFor('postgres', 'arm64'), null);
});

test("PostgreSQL's answers file: quiet install, the master password, no pgAdmin or Stack Builder", () => {
  const text = inst.postgresOptions('Secret Pass 1', 5433);
  assert.deepStrictEqual(text.trim().split('\r\n'), ['mode=unattended', 'unattendedmodeui=none', 'superpassword=Secret Pass 1', 'serverport=5433', 'disable-components=pgAdmin,stackbuilder']);
  assert.throws(() => inst.postgresOptions('a\nb'), /line breaks/);
  assert.ok(inst.installSucceeded(0) && inst.installSucceeded(3010) && !inst.installSucceeded(1603));
});

test('suggested passwords are 16 letters and digits without look-alikes', () => {
  const pw = inst.suggestPassword();
  assert.match(pw, /^[A-HJ-NP-Za-km-z2-9]{16}$/);
  assert.notStrictEqual(pw, inst.suggestPassword());
});

test("Tailscale's sign-in address and status are read from its output", () => {
  assert.strictEqual(inst.loginUrl('\nTo authenticate, visit:\n\n\thttps://login.tailscale.com/a/1a2b3c\n'), 'https://login.tailscale.com/a/1a2b3c');
  assert.strictEqual(inst.loginUrl('Success.'), null);
  assert.deepStrictEqual(inst.tailscaleStatus(JSON.stringify({ BackendState: 'Running', Self: { TailscaleIPs: ['100.64.184.100', 'fd7a:115c::1'] } })),
    { signedIn: true, address: '100.64.184.100', state: 'Running' });
  assert.deepStrictEqual(inst.tailscaleStatus(JSON.stringify({ BackendState: 'NeedsLogin', Self: {} })), { signedIn: false, address: null, state: 'NeedsLogin' });
  assert.strictEqual(inst.tailscaleStatus('not json').signedIn, false);
});

function server(body) {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      if (req.url === '/moved') { res.writeHead(302, { Location: '/file.exe' }); res.end(); return; }
      if (req.url === '/missing') { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Length': body.length });
      res.write(body.subarray(0, body.length / 2));
      setTimeout(() => res.end(body.subarray(body.length / 2)), 20);
    });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}

test('downloads follow redirects, report progress, check the checksum, and leave nothing behind when wrong', async () => {
  const body = crypto.randomBytes(200000);
  const sha256 = crypto.createHash('sha256').update(body).digest('hex').toUpperCase();
  const s = await server(body);
  const base = `http://127.0.0.1:${s.address().port}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-'));
  try {
    const progress = [];
    const got = await inst.download({ url: `${base}/moved`, sha256 }, path.join(dir, 'a.exe'), (f) => progress.push(f));
    assert.ok(fs.readFileSync(got).equals(body));
    assert.ok(progress.length >= 2 && progress[progress.length - 1] === 1, `progress: ${progress}`);

    await assert.rejects(inst.download({ url: `${base}/file.exe`, sha256: '0'.repeat(64) }, path.join(dir, 'b.exe')), /file\.exe: the downloaded file isn't the expected one/);
    await assert.rejects(inst.download({ url: `${base}/missing`, sha256 }, path.join(dir, 'c.exe')), /missing: the download site answered 404/);
    assert.deepStrictEqual(fs.readdirSync(dir), ['a.exe'], 'nothing left from the failed downloads');

    let fetched = 0;
    const counting = (url) => { fetched++; return fetch(url); };
    await inst.downloadOnce({ url: `${base}/file.exe`, sha256 }, path.join(dir, 'a.exe'), () => {}, counting);
    assert.strictEqual(fetched, 0, 'a good earlier download is used again');
  } finally {
    s.close();
  }
});

function fakeDeps(over = {}) {
  const log = [];
  const deps = {
    platform: 'win32',
    arch: 'x64',
    downloadDir: fs.mkdtempSync(path.join(os.tmpdir(), 'setup-dl-')),
    detect: async () => ({ postgres: false, tailscale: false }),
    download: async (file, dest, onProgress) => { onProgress(0.5); fs.writeFileSync(dest, 'x'); log.push(`download ${path.basename(dest)}`); return dest; },
    ranges: () => ['100.64.0.0/10', '192.168.1.0/24'],
    runElevated: async (steps, onProgress) => {
      for (const s of steps) log.push(`admin ${s.kind}${s.optionFile ? ` options=${JSON.stringify(fs.readFileSync(s.optionFile, 'utf8').split('\r\n')[2])}` : ''}`);
      onProgress([{ kind: steps[0].kind, ok: true, message: 'PostgreSQL is installed.' }]);
      return { ok: true, results: steps.map((s) => ({ kind: s.kind, ok: true, message: `${s.kind} done.` })) };
    },
    recordInstalled: (what) => log.push(`record ${JSON.stringify(what)}`),
    connectAdmin: async ({ port, password }) => { log.push(`connect ${port} ${password}`); return { end: async () => log.push('end') }; },
    createDatabase: async (admin, r) => { log.push(`create ${r.database} ${r.user} ${r.password}`); return { ok: true }; },
    saveConfig: (c) => log.push(`save ${c.host} ${c.port} ${c.database} ${c.user}`),
    wait: async () => {},
    ...over,
  };
  return { deps, log };
}
const INPUT = { role: 'dbhost', masterPassword: 'Master pass 1', appPassword: 'App pass 22', database: 'fleet', user: 'fleet_app' };

test('the whole setup for a database PC: downloads, one permission prompt, then the database and the saved connection', async () => {
  const { deps, log } = fakeDeps();
  const reports = [];
  const r = await runSetup(INPUT, deps, (steps) => reports.push(steps.map((s) => `${s.id}:${s.state}`).join(' ')));
  assert.strictEqual(r.ok, true, r.error);
  assert.deepStrictEqual(log, [
    'download postgresql-18.6-5-windows-x64.exe', 'download tailscale-setup-1.104.1-amd64.msi',
    'admin installPostgres options="superpassword=Master pass 1"', 'admin installTailscale', 'admin openConnections',
    'record {"postgres":{"port":5432},"tailscale":true}', 'connect 5432 Master pass 1', 'create fleet fleet_app App pass 22', 'end', 'save localhost 5432 fleet fleet_app',
  ]);
  assert.strictEqual(reports[reports.length - 1], 'downloadPostgres:done downloadTailscale:done admin:done database:done');
  assert.deepStrictEqual(fs.readdirSync(deps.downloadDir), [], 'installed downloads are removed');
  assert.ok(!fs.readdirSync(os.tmpdir()).some((d) => d.startsWith('xiv-fleet-pg-') && fs.existsSync(path.join(os.tmpdir(), d, 'options.txt'))), 'the file with the master password is gone');
});

test('PostgreSQL still starting is waited for; a wrong master password is not', async () => {
  let tries = 0;
  const starting = fakeDeps({ connectAdmin: async () => { if (++tries < 3) throw Object.assign(new Error('starting up'), { code: '57P03' }); return { end: async () => {} }; } });
  assert.strictEqual((await runSetup(INPUT, starting.deps)).ok, true);
  assert.strictEqual(tries, 3);

  let wrongTries = 0;
  const wrong = fakeDeps({ detect: async () => ({ postgres: true, tailscale: true }), connectAdmin: async () => { wrongTries++; throw Object.assign(new Error('password authentication failed'), { code: '28P01' }); } });
  const r = await runSetup(INPUT, wrong.deps);
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /refused the master password/);
  assert.strictEqual(wrongTries, 1);
});

test('a failed download or a turned-down permission prompt stops the setup and says why', async () => {
  const dl = fakeDeps({ download: async () => { throw new Error("Couldn't download x.exe: the download site answered 503"); } });
  const r1 = await runSetup(INPUT, dl.deps);
  assert.deepStrictEqual([r1.ok, r1.error], [false, "Couldn't download x.exe: the download site answered 503"]);
  assert.strictEqual(r1.steps.find((s) => s.id === 'downloadPostgres').state, 'failed');

  const denied = fakeDeps({ runElevated: async () => ({ ok: false, error: "Windows' permission prompt was turned down, so nothing was changed." }) });
  const r2 = await runSetup(INPUT, denied.deps);
  assert.match(r2.error, /turned down/);
  assert.ok(!denied.log.some((l) => l.startsWith('create')), 'no database is made');

  const stepFails = fakeDeps({ runElevated: async () => ({ ok: false, results: [{ kind: 'installPostgres', ok: false, message: "PostgreSQL's installer stopped with code 1603." }] }) });
  assert.match((await runSetup(INPUT, stepFails.deps)).error, /code 1603/);
  assert.ok(!stepFails.log.some((l) => l.startsWith('record')), 'nothing is noted as installed');

  const laterFails = fakeDeps({ runElevated: async () => ({ ok: false, results: [{ kind: 'installPostgres', ok: true, message: 'PostgreSQL is installed.' }, { kind: 'installTailscale', ok: false, message: "Tailscale's installer stopped with code 1603." }] }) });
  assert.match((await runSetup(INPUT, laterFails.deps)).error, /Tailscale's installer/);
  assert.ok(laterFails.log.includes('record {"postgres":{"port":5432},"tailscale":false}'), 'PostgreSQL is still noted as installed by the app');
});

test('only on Windows', async () => {
  const { deps } = fakeDeps({ platform: 'linux' });
  assert.match((await runSetup(INPUT, deps)).error, /only be done on Windows/);
});
