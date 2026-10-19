// Settings → Setup Help: this PC's addresses, the details for another PC and the connection test's messages.
const test = require('node:test');
const assert = require('node:assert');
const { isTailscaleAddress, pcAddresses, isThisPc, connectionDetails, describeTestError } = require('../setup/help');

const interfaces = {
  Ethernet: [{ address: '192.168.1.20', family: 'IPv4', internal: false }, { address: 'fe80::1', family: 'IPv6', internal: false }],
  Tailscale: [{ address: '100.101.102.103', family: 'IPv4', internal: false }],
  'Loopback Pseudo-Interface 1': [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
  'vEthernet (WSL)': [{ address: '172.20.0.1', family: 'IPv4', internal: false }],
};

test('Tailscale addresses are 100.64.0.0 to 100.127.255.255', () => {
  assert.ok(isTailscaleAddress('100.64.0.1'));
  assert.ok(isTailscaleAddress('100.127.255.255'));
  assert.ok(!isTailscaleAddress('100.128.0.1'));
  assert.ok(!isTailscaleAddress('10.0.0.1'));
});

test("this PC's Tailscale and home network addresses, IPv4 only, leaving out WSL's", () => {
  assert.deepStrictEqual(pcAddresses(interfaces), { tailscale: ['100.101.102.103'], home: ['192.168.1.20'] });
  assert.deepStrictEqual(pcAddresses({}), { tailscale: [], home: [] });
});

test('the database is on this PC when the saved host is this PC', () => {
  const a = pcAddresses(interfaces);
  for (const host of ['localhost', '127.0.0.1', '::1', '', '192.168.1.20', '100.101.102.103', 'DESKTOP-2']) {
    assert.ok(isThisPc(host, a, 'desktop-2'), host);
  }
  assert.ok(!isThisPc('100.90.1.2', a, 'laptop'));
});

test('the database PC offers its Tailscale address first, then its home network ones', () => {
  const d = connectionDetails({ host: 'localhost', port: 5432, database: 'fleet', user: 'fleet_app' }, pcAddresses(interfaces), 'pc');
  assert.strictEqual(d.databaseHere, true);
  assert.deepStrictEqual(d.choices.map((c) => `${c.address} ${c.via}`), ['100.101.102.103 Tailscale', '192.168.1.20 home network']);
  assert.deepStrictEqual([d.port, d.database, d.user], ['5432', 'fleet', 'fleet_app']);
  assert.ok(!('password' in d));
});

test('another PC passes on the address it uses itself', () => {
  const d = connectionDetails({ host: '100.90.1.2', database: 'fleet', user: 'u', password: 'secret' }, pcAddresses(interfaces), 'laptop');
  assert.strictEqual(d.databaseHere, false);
  assert.deepStrictEqual(d.choices, [{ address: '100.90.1.2', via: 'same as this PC' }]);
  assert.strictEqual(d.port, '5432');
  assert.ok(!JSON.stringify(d).includes('secret'));
});

test('failed tests say what to check', () => {
  const says = (err, re) => assert.match(describeTestError(err, '100.90.1.2'), re);
  says({ code: 'ENOTFOUND' }, /Can't find a PC called "100\.90\.1\.2"/);
  says({ code: 'ECONNREFUSED' }, /isn't letting other PCs connect/);
  says({ errors: [{ code: 'ECONNREFUSED' }] }, /isn't letting other PCs connect/);
  says({ code: 'ETIMEDOUT' }, /No answer from 100\.90\.1\.2.*Tailscale/);
  says({ message: 'timeout expired' }, /No answer/);
  says({ code: '28000', message: 'no pg_hba.conf entry for host "100.1.2.3"' }, /doesn't let this PC in yet/);
  says({ code: '28P01', message: 'password authentication failed' }, /refused the username or password/);
  says({ code: '3D000', message: 'database "x" does not exist' }, /no database with that name/);
  says({ message: 'something else' }, /^something else$/);
});

test('the plugins it works with: AutoRetainer required, each with its maker, and a repository where Dalamud lacks it', () => {
  const { COMPANION_PLUGINS } = require('../setup/help');
  assert.deepStrictEqual(COMPANION_PLUGINS.map((p) => `${p.name} ${p.need} ${p.repo || 'dalamud'}`), [
    'AutoRetainer required https://love.puni.sh/ment.json',
    'Allagan Tools recommended dalamud',
    'FC Tracker optional https://puni.sh/api/repository/erdelf',
    'Submarine Tracker optional dalamud',
  ]);
  assert.ok(COMPANION_PLUGINS.every((p) => p.by && p.what));
});
