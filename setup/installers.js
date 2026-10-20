// The setup screen's installs (Settings → Setup Help → Set up this PC, and on first start): what each kind of
// PC needs, downloading PostgreSQL and Tailscale from their makers with a checksum check, the quiet-install
// commands, and Tailscale's sign-in. The installs themselves run with Windows' permission (setup/elevated.js).
// No Electron here, so it can be tested on its own (tests/installers.test.js).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// The exact files, from each maker's own site, with their SHA-256 checksums (as listed in Windows' winget
// package list). A download that doesn't match is refused. Raise these with app releases.
const DOWNLOADS = {
  postgres: {
    name: 'PostgreSQL 18',
    version: '18.6',
    sizeMb: 350,
    x64: { url: 'https://get.enterprisedb.com/postgresql/postgresql-18.6-5-windows-x64.exe', sha256: '227E2BC08091B4C2B8338C7D61B11D057F895711480B006F90BFCFCD2410A58A' },
  },
  tailscale: {
    name: 'Tailscale',
    version: '1.104.1',
    sizeMb: 30,
    x64: { url: 'https://pkgs.tailscale.com/stable/tailscale-setup-1.104.1-amd64.msi', sha256: '6DA8BCDB0D45A214CAE0E8A88C2987AD48DEC134BF04DFFB9C05F1354C02B0B4' },
    arm64: { url: 'https://pkgs.tailscale.com/stable/tailscale-setup-1.104.1-arm64.msi', sha256: 'CB9688912EB48FAF2F752B084EE638D80545832634DA5F1885514041071C95D0' },
  },
  // Settings → Backups → Get the backup tools (backups/get-tools.js): the same PostgreSQL as a zip instead of an
  // installer. Only pg_dump, pg_restore and what they need are kept from it. Its checksum isn't in winget's
  // list: it was measured on GitHub's Windows test machine, which downloads and checks it on every pull request.
  pgtools: {
    name: "PostgreSQL 18's backup tools",
    version: '18.6',
    sizeMb: 367,
    x64: { url: 'https://get.enterprisedb.com/postgresql/postgresql-18.6-5-windows-x64-binaries.zip', sha256: 'E2246BA91D22345BC3D017586C09EDE52D9DF180B1EEB480F050445F1CAD84E2' },
  },
};

// The kinds of PC, as the setup screen offers them.
const ROLES = {
  onepc: { label: 'Everything on this PC', detail: 'This PC plays and keeps the database. No other PC connects.', database: true, otherPcs: false },
  dbhost: { label: 'This PC keeps the database for my other PCs', detail: 'Your other PCs (playing or just viewing) connect to this one.', database: true, otherPcs: true },
  connect: { label: 'This PC uses a database on another PC', detail: 'The database PC is already set up. This one runs the app (and maybe the game).', database: false, otherPcs: true },
  plugin: { label: 'This PC only plays the game', detail: 'Only the plugin runs here, sending to a database on another PC.', database: false, otherPcs: true },
};

// What setting up this PC involves. installed: { postgres, tailscale } already on this PC. sameNetwork: every
// PC is on one home network (or the database is hosted online), so Tailscale isn't needed.
function setupPlan(role, { sameNetwork = false, installed = {} } = {}) {
  const r = ROLES[role];
  if (!r) return null;
  const needsTailscale = r.otherPcs && !sameNetwork;
  return {
    role,
    installPostgres: r.database && !installed.postgres,
    installTailscale: needsTailscale && !installed.tailscale,
    alreadyPostgres: r.database && !!installed.postgres,
    alreadyTailscale: needsTailscale && !!installed.tailscale,
    tailscale: needsTailscale,
    createDatabase: r.database,
    openConnections: role === 'dbhost',
    askConnection: role === 'connect' || role === 'plugin',
  };
}

// The download for this PC's processor; PostgreSQL has no ARM build for Windows.
function downloadFor(what, arch) {
  const d = DOWNLOADS[what];
  const file = arch === 'arm64' ? d.arm64 : d.x64;
  return file ? { ...file, name: d.name, version: d.version } : null;
}

// PostgreSQL's installer reads its answers from a file (so the password never shows on a command line): no
// pgAdmin or Stack Builder, the usual port, the master password chosen on the setup screen.
function postgresOptions(masterPassword, port = 5432) {
  if (/[\r\n]/.test(masterPassword)) throw new Error('The master password cannot contain line breaks.');
  return [
    'mode=unattended',
    'unattendedmodeui=none',
    `superpassword=${masterPassword}`,
    `serverport=${port}`,
    'disable-components=pgAdmin,stackbuilder',
  ].join('\r\n') + '\r\n';
}

// The commands that install them quietly (run with administrator rights).
const postgresCommand = (installer, optionFile) => [installer, ['--mode', 'unattended', '--unattendedmodeui', 'none', '--optionfile', optionFile]];
const tailscaleCommand = (msi) => ['msiexec.exe', ['/i', msi, '/quiet', '/norestart']];
// Remove everything: Tailscale's MSI product code from Windows' list of installed programs, and the command
// that removes it quietly.
const TAILSCALE_PRODUCT = "Get-ChildItem 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall' -ErrorAction SilentlyContinue | Get-ItemProperty | Where-Object { $_.DisplayName -eq 'Tailscale' -and $_.WindowsInstaller -eq 1 } | ForEach-Object { $_.PSChildName }";
const productCodeFrom = (output) => {
  const m = /\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}/i.exec(String(output || ''));
  return m ? m[0] : null;
};
const tailscaleUninstallCommand = (productCode) => ['msiexec.exe', ['/x', productCode, '/quiet', '/norestart']];
// PostgreSQL's own uninstaller, in the folder it was installed to.
const postgresUninstallCommand = (installDir) => [path.join(installDir, 'uninstall-postgresql.exe'), ['--mode', 'unattended']];
// msiexec's "done, restart later" (3010) counts as done.
const installSucceeded = (code) => code === 0 || code === 3010;

async function sha256Of(file) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    fs.createReadStream(file).on('data', (d) => hash.update(d)).on('end', resolve).on('error', reject);
  });
  return hash.digest('hex').toUpperCase();
}

// Downloads `url` to `dest`, calling onProgress(fraction 0..1, or null when the size isn't known), and checks
// the checksum. Throws with a plain message when the download fails or doesn't match; nothing is left behind.
async function download({ url, sha256 }, dest, onProgress = () => {}, fetchImpl = fetch) {
  const partial = `${dest}.partial`;
  try {
    const res = await fetchImpl(url);
    if (!res.ok || !res.body) throw new Error(`the download site answered ${res.status}`);
    const total = Number(res.headers.get('content-length')) || 0;
    let got = 0;
    const out = fs.createWriteStream(partial);
    for await (const chunk of res.body) {
      got += chunk.length;
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      onProgress(total ? Math.min(1, got / total) : null);
    }
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
    const actual = await sha256Of(partial);
    if (actual !== sha256.toUpperCase()) throw new Error("the downloaded file isn't the expected one (its checksum doesn't match), so it wasn't used");
    fs.renameSync(partial, dest);
    return dest;
  } catch (err) {
    fs.rmSync(partial, { force: true });
    throw new Error(`Couldn't download ${path.basename(new URL(url).pathname)}: ${err.message}`);
  }
}

// download(), unless `dest` is already there from an earlier try and matches its checksum.
async function downloadOnce(file, dest, onProgress = () => {}, fetchImpl = fetch) {
  if (fs.existsSync(dest) && (await sha256Of(dest)) === file.sha256.toUpperCase()) {
    onProgress(1);
    return dest;
  }
  return download(file, dest, onProgress, fetchImpl);
}

// A password suggestion: 16 letters and digits (no look-alikes such as 0/O and 1/l).
function suggestPassword(randomBytes = crypto.randomBytes) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(16);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

// Where Tailscale's installer puts its command-line tool.
const tailscaleExe = () => path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Tailscale', 'tailscale.exe');

// Tailscale's sign-in address from `tailscale up` output ("To authenticate, visit: https://login.tailscale.com/a/...").
function loginUrl(output) {
  const m = /https:\/\/login\.tailscale\.com\/\S+/.exec(String(output || ''));
  return m ? m[0] : null;
}

// From `tailscale status --json`: { signedIn, address } (address: this PC's Tailscale IPv4, when signed in).
function tailscaleStatus(json) {
  try {
    const s = JSON.parse(json);
    const address = ((s.Self && s.Self.TailscaleIPs) || []).find((ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip)) || null;
    return { signedIn: s.BackendState === 'Running', address, state: s.BackendState || 'unknown' };
  } catch {
    return { signedIn: false, address: null, state: 'unknown' };
  }
}

module.exports = {
  DOWNLOADS, ROLES, setupPlan, downloadFor, postgresOptions, postgresCommand, tailscaleCommand, installSucceeded,
  TAILSCALE_PRODUCT, productCodeFrom, tailscaleUninstallCommand, postgresUninstallCommand,
  sha256Of, download, downloadOnce, suggestPassword, tailscaleExe, loginUrl, tailscaleStatus,
};
