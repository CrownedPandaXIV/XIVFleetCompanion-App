// "Let other PCs connect": PostgreSQL's settings files, the address ranges let in, finding PostgreSQL's
// Windows service, the firewall rule, and the whole run against files in a temporary folder.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ra = require('../setup/remote-access');
const { homeNetworkCidrs } = require('../setup/help');
const { checkRequest } = require('../setup/create-database');

const CONF = [
  '# - Connection Settings -',
  '',
  "#listen_addresses = 'localhost'\t\t# what IP address(es) to listen on;",
  'port = 5433\t\t\t\t# (change requires restart)',
  '',
].join('\r\n');
const HBA = [
  '# TYPE  DATABASE        USER            ADDRESS                 METHOD',
  'host    all             all             127.0.0.1/32            md5',
  'host    replication     all             127.0.0.1/32            trust',
  '',
].join('\n');

test("listen_addresses becomes '*' under the commented-out default, keeping Windows line endings", () => {
  const out = ra.setListenAddresses(CONF);
  assert.ok(out.includes("#listen_addresses = 'localhost'\t\t# what IP address(es) to listen on;\r\nlisten_addresses = '*'\r\n"));
  assert.strictEqual(ra.setListenAddresses(out), out, 'running it again changes nothing');
});

test('an active listen_addresses line is replaced, noting what it was; a missing one is added', () => {
  assert.strictEqual(ra.setListenAddresses("listen_addresses = 'localhost'\n"), "listen_addresses = '*'\t\t# was: listen_addresses = 'localhost'\n");
  assert.strictEqual(ra.setListenAddresses('port = 5432'), "port = 5432\nlisten_addresses = '*'\n");
});

test('the new access lines use the password check already used for this PC, and are added once', () => {
  assert.strictEqual(ra.passwordMethod(HBA), 'md5');
  assert.strictEqual(ra.passwordMethod('host all all 127.0.0.1/32 trust\n'), 'scram-sha-256');
  const out = ra.addAccessLines(HBA, ['100.64.0.0/10', '192.168.1.0/24']);
  const added = out.slice(HBA.length).trim().split('\n');
  assert.match(added[0], /^# Added by XIV Fleet Companion/);
  assert.deepStrictEqual(added.slice(1).map((l) => l.split(/\s+/)), [['host', 'all', 'all', '100.64.0.0/10', 'md5'], ['host', 'all', 'all', '192.168.1.0/24', 'md5']]);
  assert.strictEqual(ra.addAccessLines(out, ['100.64.0.0/10', '192.168.1.0/24']), out, 'running it again changes nothing');
  assert.strictEqual(ra.addAccessLines(out, ['10.0.0.0/8']).split('# Added by').length, 3, 'a new range is added on its own');
});

test('home networks come from the addresses on this PC; Tailscale is always let in', () => {
  const interfaces = {
    Ethernet: [{ address: '192.168.1.20', cidr: '192.168.1.20/24', family: 'IPv4', internal: false }],
    'Wi-Fi': [{ address: '10.1.2.3', cidr: '10.1.2.3/16', family: 'IPv4', internal: false }],
    Tailscale: [{ address: '100.101.102.103', cidr: '100.101.102.103/32', family: 'IPv4', internal: false }],
    'vEthernet (WSL)': [{ address: '172.20.0.1', cidr: '172.20.0.1/20', family: 'IPv4', internal: false }],
  };
  assert.deepStrictEqual(homeNetworkCidrs(interfaces), ['192.168.1.20/24', '10.1.2.3/16']);
  assert.deepStrictEqual(ra.rangesToAllow(homeNetworkCidrs(interfaces)), ['100.64.0.0/10', '192.168.1.0/24', '10.1.0.0/16']);
  assert.strictEqual(ra.networkOf('172.16.5.9/12'), '172.16.0.0/12');
});

test("PostgreSQL's Windows services are read from their command lines", () => {
  const out = 'postgresql-x64-16|"C:\\Program Files\\PostgreSQL\\16\\bin\\pg_ctl.exe" runservice -N "postgresql-x64-16" -D "C:\\Program Files\\PostgreSQL\\16\\data" -w\r\n'
    + 'postgresql-14|C:\\pg14\\bin\\pg_ctl.exe runservice -N postgresql-14 -D E:\\pgdata -w\r\n';
  assert.deepStrictEqual(ra.parseServices(out), [
    { service: 'postgresql-x64-16', dataDir: 'C:\\Program Files\\PostgreSQL\\16\\data', installDir: 'C:\\Program Files\\PostgreSQL\\16' },
    { service: 'postgresql-14', dataDir: 'E:\\pgdata', installDir: 'C:\\pg14' },
  ]);
  assert.strictEqual(ra.confPort(CONF), 5433);
  assert.strictEqual(ra.confPort('#port = 5432'), 5432);
});

test('the firewall rule is for the port, from Tailscale and the local network only', () => {
  assert.deepStrictEqual(ra.firewallArgs(5433).slice(-3), ['protocol=TCP', 'localport=5433', 'remoteip=100.64.0.0/10,LocalSubnet']);
});

function dataDir(conf, hba) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgdata-'));
  fs.writeFileSync(path.join(dir, 'postgresql.conf'), conf);
  fs.writeFileSync(path.join(dir, 'pg_hba.conf'), hba);
  return dir;
}
function fakeRun(firewallRuleExists = false) {
  const calls = [];
  const run = async (file, args) => {
    calls.push([file, ...args].join(' '));
    if (args.includes('show')) return { ok: firewallRuleExists, stdout: '', stderr: '' };
    return { ok: true, stdout: '', stderr: '' };
  };
  return { run, calls };
}

test('the whole run: picks the PostgreSQL on the port, edits both files with copies kept, opens the firewall and restarts', async () => {
  const other = dataDir('port = 5432\n', HBA);
  const dir = dataDir(CONF, HBA);
  const { run, calls } = fakeRun();
  const now = () => new Date('2026-10-17T12:00:00Z');
  const request = { port: 5433, ranges: ['100.64.0.0/10', '192.168.1.0/24'], services: [{ service: 'pg-other', dataDir: other }, { service: 'postgresql-x64-16', dataDir: dir }] };
  const r = await ra.applyRemoteAccess(request, { run, now });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.service, 'postgresql-x64-16');
  assert.strictEqual(r.changed.length, 3);
  assert.ok(fs.readFileSync(path.join(dir, 'postgresql.conf'), 'utf8').includes("listen_addresses = '*'"));
  assert.ok(fs.readFileSync(path.join(dir, 'pg_hba.conf'), 'utf8').includes('192.168.1.0/24'));
  assert.strictEqual(fs.readFileSync(path.join(dir, 'postgresql.conf.before-xiv-fleet-20261017-120000'), 'utf8'), CONF);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'pg_hba.conf.before-xiv-fleet-20261017-120000'), 'utf8'), HBA);
  assert.strictEqual(fs.readFileSync(path.join(other, 'pg_hba.conf'), 'utf8'), HBA, 'the other PostgreSQL is left alone');
  assert.ok(calls.some((c) => c.includes('firewall add rule') && c.includes('localport=5433')));
  assert.ok(calls.some((c) => c.includes("Restart-Service -Name 'postgresql-x64-16'")));

  const again = fakeRun(true);
  const r2 = await ra.applyRemoteAccess(request, { run: again.run, now });
  assert.deepStrictEqual([r2.ok, r2.changed], [true, []], 'a second run changes nothing');
  assert.ok(!again.calls.some((c) => c.includes('Restart-Service') || c.includes('add rule')), 'and neither restarts nor adds a rule');
});

test('an ALTER SYSTEM listen_addresses is changed too; no PostgreSQL on the port says so', async () => {
  const dir = dataDir("listen_addresses = '*'\n", HBA.replace('md5', 'scram-sha-256'));
  fs.writeFileSync(path.join(dir, 'postgresql.auto.conf'), "listen_addresses = 'localhost'\n");
  const { run } = fakeRun(true);
  const r = await ra.applyRemoteAccess({ port: 5432, ranges: ['100.64.0.0/10'], services: [{ service: 's', dataDir: dir }] }, { run });
  assert.ok(r.ok && fs.readFileSync(path.join(dir, 'postgresql.auto.conf'), 'utf8').startsWith("listen_addresses = '*'"));
  const none = await ra.applyRemoteAccess({ port: 6000, ranges: [], services: [{ service: 's', dataDir: dir }] }, { run });
  assert.match(none.error, /port 6000/);
});

test('a firewall or restart failure is reported with what was already changed', async () => {
  const dir = dataDir(CONF, HBA);
  const run = async (file, args) => ({ ok: !(file === 'powershell.exe'), stdout: '', stderr: file === 'powershell.exe' ? 'Access is denied.' : '' });
  const r = await ra.applyRemoteAccess({ port: 5433, ranges: ['100.64.0.0/10'], services: [{ service: 'pg', dataDir: dir }] }, { run });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /didn't restart: Access is denied\. Restart the "pg" service/);
  assert.strictEqual(r.changed.length, 2);
});

test("Remove everything takes out exactly the lines \"Let other PCs connect\" added", () => {
  for (const hba of [HBA, HBA.replace(/\n/g, '\r\n'), HBA.trimEnd()]) {
    const added = ra.addAccessLines(hba, ['100.64.0.0/10', '192.168.1.0/24']);
    assert.notStrictEqual(added, hba);
    // A file with no line break at the end gets one; nothing else differs.
    assert.strictEqual(ra.removeAccessLines(added).trimEnd(), hba.trimEnd());
    if (/\n$/.test(hba)) assert.strictEqual(ra.removeAccessLines(added), hba);
    assert.ok(!ra.removeAccessLines(added).includes('100.64.0.0/10'));
    assert.ok(ra.removeAccessLines(added).includes('127.0.0.1/32'), 'the lines that were there before stay');
  }
  assert.strictEqual(ra.removeAccessLines(HBA), HBA, 'nothing added, nothing changed');
});

test('undoing it removes the firewall rule and the added lines (a copy kept), then restarts; a second run changes nothing', async () => {
  const dir = dataDir(CONF, ra.addAccessLines(HBA, ['100.64.0.0/10']));
  const { run, calls } = fakeRun(true);
  const now = () => new Date('2026-10-17T12:00:00Z');
  const r = await ra.undoRemoteAccess({ port: 5433, services: [{ service: 'pg', dataDir: dir }] }, { run, now });
  assert.deepStrictEqual(r, { ok: true, changed: ['The Windows Firewall rule is removed', 'Other PCs are no longer let in'] });
  assert.strictEqual(fs.readFileSync(path.join(dir, 'pg_hba.conf'), 'utf8'), HBA);
  assert.ok(fs.existsSync(path.join(dir, 'pg_hba.conf.before-xiv-fleet-20261017-120000')));
  assert.ok(calls.some((c) => c.includes('firewall delete rule name=XIV Fleet Companion PostgreSQL')));
  assert.ok(calls.some((c) => c.includes("Restart-Service -Name 'pg'")));

  const again = fakeRun(false);
  const r2 = await ra.undoRemoteAccess({ port: 5433, services: [{ service: 'pg', dataDir: dir }] }, { run: again.run, now });
  assert.deepStrictEqual(r2, { ok: true, changed: [] });
  assert.ok(!again.calls.some((c) => c.includes('delete') || c.includes('Restart-Service')));
});

test('the new database request is checked before anything is made', () => {
  const ok = { database: 'fleet', user: 'fleet_app', password: 'long enough' };
  assert.strictEqual(checkRequest(ok), null);
  assert.match(checkRequest({ ...ok, database: 'Fleet DB' }), /database name/);
  assert.match(checkRequest({ ...ok, user: 'x;drop' }), /username/);
  assert.match(checkRequest({ ...ok, database: 'postgres' }), /PostgreSQL's own/);
  assert.match(checkRequest({ ...ok, user: 'postgres' }), /other than "postgres"/);
  assert.match(checkRequest({ ...ok, password: 'short' }), /8 characters/);
});
