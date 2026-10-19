// Settings → Setup Help: what to type on another PC, and a connection test that says in plain words what's
// wrong. No Electron or pg here, so it can be tested on its own (tests/setup-help.test.js).

// The address players paste into Dalamud to install the plugin.
const PLUGIN_REPO = 'https://raw.githubusercontent.com/CrownedPandaXIV/XIVFleetCompanion-Releases/main/repo.json';
// Where problems with the app or the plugin are reported (Setup Help → Found a problem?).
const REPORT_PROBLEM_URL = 'https://github.com/CrownedPandaXIV/XIVFleetCompanion-App/issues/new/choose';

// The plugins XIV Fleet Companion reads from, made by others. repo: the address to paste into Dalamud's
// Experimental tab, or null when it's in Dalamud's own plugin list.
const PUNISH_REPO = 'https://love.puni.sh/ment.json';
const COMPANION_PLUGINS = [
  { name: 'AutoRetainer', by: 'kawaii, NightmareXIV and the Puni.sh team', need: 'required', repo: PUNISH_REPO,
    what: 'Your characters, retainers, subs, gil, ceruleum and repair kits. Nothing syncs without it.' },
  { name: 'Allagan Tools', by: 'Critical_Impact', need: 'recommended', repo: null,
    what: "Everything in your bags, your retainers' and the FC chest." },
  { name: 'FC Tracker', by: 'erdelf', need: 'optional', repo: 'https://puni.sh/api/repository/erdelf',
    what: 'Free Company houses, and when each was last entered (for the house warnings).' },
  { name: 'Submarine Tracker', by: 'Infi', need: 'optional', repo: null,
    what: "What every voyage brought back, for the Income tab's loot per voyage." },
];

// Tailscale gives every PC an address from 100.64.0.0 to 100.127.255.255.
function isTailscaleAddress(ip) {
  const m = /^100\.(\d+)\.\d+\.\d+$/.exec(ip || '');
  return !!m && Number(m[1]) >= 64 && Number(m[1]) <= 127;
}

// Addresses on a home network (192.168.x.x, 10.x.x.x, 172.16-31.x.x).
function isHomeNetworkAddress(ip) {
  return /^(192\.168|10)\.\d+\.\d+(\.\d+)?$/.test(ip || '') || /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(ip || '');
}

// Adapters made by virtual machines and WSL, whose addresses other PCs can't reach.
const VIRTUAL_ADAPTER = /vEthernet|WSL|Hyper-V|VirtualBox|VMware|Docker/i;

// This PC's addresses, from os.networkInterfaces(): { tailscale: [...], home: [...] }, IPv4 only.
function pcAddresses(interfaces) {
  const tailscale = [];
  const home = [];
  for (const [name, list] of Object.entries(interfaces || {})) {
    for (const a of list || []) {
      if (a.internal || (a.family !== 'IPv4' && a.family !== 4)) continue;
      if (isTailscaleAddress(a.address) || /tailscale/i.test(name)) tailscale.push(a.address);
      else if (isHomeNetworkAddress(a.address) && !VIRTUAL_ADAPTER.test(name)) home.push(a.address);
    }
  }
  return { tailscale: [...new Set(tailscale)], home: [...new Set(home)] };
}

// The home networks this PC is on, as cidr (192.168.1.20/24), from os.networkInterfaces().
function homeNetworkCidrs(interfaces) {
  const cidrs = [];
  for (const [name, list] of Object.entries(interfaces || {})) {
    for (const a of list || []) {
      if (a.internal || (a.family !== 'IPv4' && a.family !== 4) || !a.cidr) continue;
      if (isHomeNetworkAddress(a.address) && !isTailscaleAddress(a.address) && !/tailscale/i.test(name) && !VIRTUAL_ADAPTER.test(name)) cidrs.push(a.cidr);
    }
  }
  return [...new Set(cidrs)];
}

// Whether the saved host is this PC itself, which means the database is on this PC.
function isThisPc(host, addresses, hostname) {
  const h = String(host || '').trim().toLowerCase();
  // A folder is PostgreSQL's local socket (Linux and macOS).
  if (!h || h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.startsWith('/')) return true;
  if (hostname && h === String(hostname).toLowerCase()) return true;
  return [...addresses.tailscale, ...addresses.home].includes(h);
}

// What another PC should type to reach the same database. config: the saved connection (no password).
function connectionDetails(config, addresses, hostname) {
  const local = isThisPc(config.host, addresses, hostname);
  const choices = local
    ? [
      ...addresses.tailscale.map((ip) => ({ address: ip, via: 'Tailscale' })),
      ...addresses.home.map((ip) => ({ address: ip, via: 'home network' })),
    ]
    : [{ address: config.host, via: 'same as this PC' }];
  return {
    databaseHere: local,
    choices,
    port: String(config.port || 5432),
    database: config.database || '',
    user: config.user || '',
  };
}

const NO_ANSWER = new Set(['ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'EHOSTDOWN', 'ENETDOWN']);

// A failed connection test, in plain words with what to check. host: the address that was tried.
function describeTestError(err, host) {
  const code = err && err.code;
  const codes = [code, ...((err && err.errors) || []).map((e) => e.code)];
  const message = (err && err.message) || '';
  if (codes.includes('ENOTFOUND') || codes.includes('EAI_AGAIN')) {
    return `Can't find a PC called "${host}". Check the address: a Tailscale address looks like 100.x.x.x.`;
  }
  if (codes.includes('ECONNREFUSED')) {
    return `${host} answered, but PostgreSQL isn't letting other PCs connect. On the database PC, PostgreSQL has to listen for other PCs (see "If other PCs can't connect" below).`;
  }
  if (codes.some((c) => NO_ANSWER.has(c)) || /timeout/i.test(message)) {
    return `No answer from ${host}. Check the database PC is on, Tailscale is running and signed in to the same account on both PCs, and the database PC's firewall lets PostgreSQL through (see below).`;
  }
  if (code === '28000' && /pg_hba/i.test(message)) {
    return `${host} answered, but PostgreSQL doesn't let this PC in yet. On the database PC, add the access line (see "If other PCs can't connect" below).`;
  }
  if (code === '28P01' || code === '28000') {
    return 'The database answered but refused the username or password. Check them in the Database tab.';
  }
  if (code === '3D000') {
    return 'PostgreSQL answered, but there is no database with that name. Check the name in the Database tab.';
  }
  return message || String(err);
}

module.exports = { PLUGIN_REPO, REPORT_PROBLEM_URL, COMPANION_PLUGINS, isTailscaleAddress, pcAddresses, homeNetworkCidrs, isThisPc, connectionDetails, describeTestError };
