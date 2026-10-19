// "Let other PCs connect" (Settings → Setup Help, on the database PC): sets PostgreSQL to listen for other
// PCs, lets in your Tailscale PCs and this PC's home network (with the password), opens Windows Firewall
// for PostgreSQL's port (for those addresses only) and restarts PostgreSQL. Run by a copy of the app that
// Windows has given administrator rights (setup/elevated.js), since PostgreSQL's files and the firewall
// need them. Copies of both files are kept next to them before anything changes.
const fs = require('fs');
const path = require('path');

const TAILSCALE_RANGE = '100.64.0.0/10';
const FIREWALL_RULE = 'XIV Fleet Companion PostgreSQL';
const MARKER = '# Added by XIV Fleet Companion (Let other PCs connect):';

// postgresql.conf with listen_addresses = '*' (all of this PC's addresses; pg_hba.conf decides who gets in).
// Changes the active line, or the commented-out default, or adds one. Unchanged when it is already '*'.
function setListenAddresses(text) {
  const lines = String(text).split(/\r?\n/);
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  const active = lines.findIndex((l) => /^\s*listen_addresses\s*=/.test(l));
  const wanted = "listen_addresses = '*'";
  if (active >= 0) {
    if (/^\s*listen_addresses\s*=\s*'\*'/.test(lines[active])) return text;
    lines[active] = `${wanted}\t\t# was: ${lines[active].trim()}`;
    return lines.join(eol);
  }
  const commented = lines.findIndex((l) => /^\s*#\s*listen_addresses\s*=/.test(l));
  if (commented >= 0) {
    lines.splice(commented + 1, 0, wanted);
    return lines.join(eol);
  }
  return `${text}${/\n$/.test(text) ? '' : eol}${wanted}${eol}`;
}

// The password check pg_hba.conf already uses for this PC's own connections (127.0.0.1), so the new lines
// work with however the passwords were saved; scram-sha-256 when there is none.
function passwordMethod(hbaText) {
  for (const line of String(hbaText).split(/\r?\n/)) {
    const f = line.trim().split(/\s+/);
    if (f[0] === 'host' && f[3] === '127.0.0.1/32' && f[1] !== 'replication' && f[2] !== 'replication') {
      if (f[4] === 'md5' || f[4] === 'scram-sha-256') return f[4];
    }
  }
  return 'scram-sha-256';
}

// pg_hba.conf with a line letting each address range in (all databases and users, with the password).
// Ranges already let in by a line of their own are left alone.
function addAccessLines(hbaText, ranges) {
  const text = String(hbaText);
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  const present = new Set(text.split(/\r?\n/).map((l) => l.trim().split(/\s+/))
    .filter((f) => f[0] === 'host' && f[1] === 'all' && f[2] === 'all').map((f) => f[3]));
  const missing = ranges.filter((r) => !present.has(r));
  if (!missing.length) return text;
  const method = passwordMethod(text);
  const added = missing.map((r) => `host    all             all             ${r.padEnd(24)}${method}`);
  return `${text}${/\n$/.test(text) ? '' : eol}${eol}${MARKER}${eol}${added.join(eol)}${eol}`;
}

// 192.168.1.20/24 -> 192.168.1.0/24.
function networkOf(cidr) {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)\/(\d+)$/.exec(cidr || '');
  if (!m) return null;
  const bits = Number(m[5]);
  const ip = m.slice(1, 5).reduce((n, o) => n * 256 + Number(o), 0);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  const net = (ip & mask) >>> 0;
  return `${[24, 16, 8, 0].map((s) => (net >>> s) & 255).join('.')}/${bits}`;
}

// The address ranges to let in: Tailscale, plus each home network this PC is on (from its addresses'
// cidr, e.g. 192.168.1.0/24). homeCidrs: the cidr of each home network address (setup/help.js).
function rangesToAllow(homeCidrs) {
  return [TAILSCALE_RANGE, ...new Set(homeCidrs.map(networkOf).filter(Boolean))];
}

// PostgreSQL's Windows services, from `Get-CimInstance Win32_Service` lines "Name|PathName":
// [{ service, dataDir, installDir }]. PathName: "C:\...\16\bin\pg_ctl.exe" runservice -N "postgresql-x64-16"
// -D "C:\...\data" -w. installDir is the folder above bin (C:\...\16), where its uninstaller is.
function parseServices(output) {
  const found = [];
  for (const line of String(output || '').split(/\r?\n/)) {
    const [name, pathName] = line.split('|');
    if (!name || !pathName) continue;
    const d = /\s-D\s+(?:"([^"]+)"|(\S+))/.exec(pathName);
    const exe = /^\s*(?:"([^"]+)"|(\S+))/.exec(pathName);
    const exePath = exe ? (exe[1] || exe[2]) : '';
    const installDir = /\\bin\\pg_ctl\.exe$/i.test(exePath) ? path.win32.dirname(path.win32.dirname(exePath)) : null;
    if (d) found.push({ service: name.trim(), dataDir: (d[1] || d[2]).trim(), installDir });
  }
  return found;
}

// The PostgreSQL (of `services`) whose postgresql.conf uses `port`, or undefined.
function instanceForPort(services, port, fsys = fs) {
  return (services || []).find((s) => {
    try { return confPort(fsys.readFileSync(path.join(s.dataDir, 'postgresql.conf'), 'utf8')) === port; } catch { return false; }
  });
}

// The port a postgresql.conf sets (5432 when it doesn't).
function confPort(text) {
  const m = /^\s*port\s*=\s*(\d+)/m.exec(String(text || ''));
  return m ? Number(m[1]) : 5432;
}

// netsh's arguments for the firewall rule: PostgreSQL's port, only from Tailscale and this PC's own network.
function firewallArgs(port) {
  return ['advfirewall', 'firewall', 'add', 'rule', `name=${FIREWALL_RULE}`, 'dir=in', 'action=allow',
    'protocol=TCP', `localport=${port}`, `remoteip=${TAILSCALE_RANGE},LocalSubnet`];
}

// netsh's arguments that remove the firewall rule.
const firewallDeleteArgs = () => ['advfirewall', 'firewall', 'delete', 'rule', `name=${FIREWALL_RULE}`];

// pg_hba.conf without the lines "Let other PCs connect" added (the marker comment and the lines under it).
function removeAccessLines(hbaText) {
  const text = String(hbaText);
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== MARKER) { out.push(lines[i]); continue; }
    // The blank line added above the marker goes too.
    if (out.length && out[out.length - 1].trim() === '') out.pop();
    while (i + 1 < lines.length && /^host\s/.test(lines[i + 1].trim())) i++;
  }
  return out.join(eol);
}

const stamp = (d) => d.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');

// Does it all. request: { port, ranges, services: [{ service, dataDir }] }. deps (for the tests): fs, run
// (a command: (file, args) -> { ok, stdout, stderr }) and now. Returns { ok, service, dataDir, changed: [...] }
// or { ok: false, error }.
async function applyRemoteAccess(request, deps = {}) {
  const fsys = deps.fs || fs;
  const run = deps.run;
  const now = deps.now || (() => new Date());
  const port = Number(request.port) || 5432;
  const instance = instanceForPort(request.services, port, fsys);
  if (!instance) {
    return { ok: false, error: `Couldn't find the PostgreSQL on this PC that uses port ${port}. Is PostgreSQL installed here as a Windows service?` };
  }
  const changed = [];
  const edit = (file, change, label) => {
    const full = path.join(instance.dataDir, file);
    if (!fsys.existsSync(full)) return;
    const before = fsys.readFileSync(full, 'utf8');
    const after = change(before);
    if (after === before) return;
    fsys.copyFileSync(full, `${full}.before-xiv-fleet-${stamp(now())}`);
    fsys.writeFileSync(full, after);
    changed.push(label);
  };
  edit('postgresql.conf', setListenAddresses, 'PostgreSQL now listens for other PCs');
  // A setting made with ALTER SYSTEM overrides postgresql.conf.
  edit('postgresql.auto.conf', (t) => (/^\s*listen_addresses\s*=/m.test(t) ? setListenAddresses(t) : t), 'PostgreSQL now listens for other PCs (ALTER SYSTEM setting)');
  edit('pg_hba.conf', (t) => addAccessLines(t, request.ranges), `Let in: ${request.ranges.join(', ')}`);

  const rule = await run('netsh.exe', ['advfirewall', 'firewall', 'show', 'rule', `name=${FIREWALL_RULE}`]);
  if (!rule.ok) {
    const added = await run('netsh.exe', firewallArgs(port));
    if (!added.ok) return { ok: false, error: `Windows Firewall wasn't changed: ${(added.stdout || added.stderr).trim()}`, changed };
    changed.push(`Windows Firewall allows port ${port} from Tailscale and this PC's network`);
  }

  if (changed.some((c) => c.startsWith('PostgreSQL') || c.startsWith('Let in'))) {
    const restart = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Restart-Service -Name '${instance.service.replace(/'/g, "''")}' -Force`]);
    if (!restart.ok) {
      return { ok: false, error: `The settings were changed, but PostgreSQL didn't restart: ${(restart.stderr || restart.stdout).trim()} Restart the "${instance.service}" service in Services.`, changed };
    }
  }
  return { ok: true, service: instance.service, dataDir: instance.dataDir, changed };
}

// Undoes "Let other PCs connect" for a PostgreSQL the app didn't install (Remove everything): takes out the
// firewall rule and the lines it added to pg_hba.conf (a copy is kept), and restarts PostgreSQL if they were
// there. listen_addresses is left as it is: with those lines gone, other PCs aren't let in anyway.
// request: { port, services }. Returns { ok, changed } or { ok: false, error, changed }.
async function undoRemoteAccess(request, deps = {}) {
  const fsys = deps.fs || fs;
  const run = deps.run;
  const now = deps.now || (() => new Date());
  const changed = [];
  const rule = await run('netsh.exe', ['advfirewall', 'firewall', 'show', 'rule', `name=${FIREWALL_RULE}`]);
  if (rule.ok) {
    const removed = await run('netsh.exe', firewallDeleteArgs());
    if (!removed.ok) return { ok: false, error: `Windows Firewall wasn't changed: ${(removed.stdout || removed.stderr).trim()}`, changed };
    changed.push('The Windows Firewall rule is removed');
  }
  const instance = instanceForPort(request.services, Number(request.port) || 5432, fsys);
  if (!instance) return { ok: true, changed };
  const hba = path.join(instance.dataDir, 'pg_hba.conf');
  if (fsys.existsSync(hba)) {
    const before = fsys.readFileSync(hba, 'utf8');
    const after = removeAccessLines(before);
    if (after !== before) {
      fsys.copyFileSync(hba, `${hba}.before-xiv-fleet-${stamp(now())}`);
      fsys.writeFileSync(hba, after);
      changed.push('Other PCs are no longer let in');
      const restart = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Restart-Service -Name '${instance.service.replace(/'/g, "''")}' -Force`]);
      if (!restart.ok) return { ok: false, error: `pg_hba.conf was changed, but PostgreSQL didn't restart: ${(restart.stderr || restart.stdout).trim()}`, changed };
    }
  }
  return { ok: true, changed };
}

module.exports = {
  TAILSCALE_RANGE, FIREWALL_RULE, setListenAddresses, passwordMethod, addAccessLines, networkOf, rangesToAllow,
  parseServices, instanceForPort, confPort, firewallArgs, firewallDeleteArgs, removeAccessLines, applyRemoteAccess, undoRemoteAccess,
};
