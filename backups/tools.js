// Finds PostgreSQL's own backup tools (pg_dump, pg_restore) on this PC: the folder chosen in Settings,
// else the PostgreSQL Windows service's folder, else C:\Program Files\PostgreSQL\<newest>\bin, else the
// PATH, else the copy Get the backup tools downloaded (get-tools.js). They come with every PostgreSQL install,
// so the database PC always has them; other PCs need that download to back up or restore.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const exe = (name, platform = process.platform) => (platform === 'win32' ? `${name}.exe` : name);

const ascii = (text) => /^[\x00-\x7f]*$/.test(String(text || ''));

// PostgreSQL's tools take the password (PGPASSWORD) and paths through Windows' older text encoding, which has no room
// for many letters outside English: a refused password that has such letters is said so.
const PASSWORD_HINT = " PostgreSQL's backup tools can't send a password with letters outside English on this PC: change the database's password to one with only English letters, numbers and symbols.";

function run(file, args, options = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024, ...options }, (err, stdout, stderr) => {
      let text = String(stderr || '');
      const password = options.env && options.env.PGPASSWORD;
      if (err && password && !ascii(password) && /password authentication failed|authentication/i.test(text + stdout)) text += PASSWORD_HINT;
      resolve({ ok: !err, code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout || ''), stderr: text });
    });
  });
}

// A temporary folder whose path PostgreSQL's tools can open: the user's own, unless its path has letters outside
// English (a user name such as José), then one under ProgramData.
function toolTempDir(tmp = require('os').tmpdir(), programData = process.env.ProgramData || 'C:\\ProgramData') {
  return ascii(tmp) ? tmp : path.join(programData, 'XIV Fleet Companion', 'temp');
}

// The folders of PostgreSQL Windows services, from PowerShell (no administrator rights needed).
async function serviceFolders() {
  if (process.platform !== 'win32') return [];
  const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "Get-CimInstance Win32_Service -Filter \"Name LIKE 'postgresql%'\" | ForEach-Object { $_.PathName }"]);
  return servicePathsToFolders(r.stdout);
}

// "C:\Program Files\PostgreSQL\16\bin\pg_ctl.exe" runservice -N ... -> C:\Program Files\PostgreSQL\16\bin
function servicePathsToFolders(output) {
  const folders = [];
  for (const line of String(output || '').split(/\r?\n/)) {
    const m = /^\s*"?([^"]+?\.exe)"?/i.exec(line);
    if (m) folders.push(path.win32.dirname(m[1]));
  }
  return folders;
}

// C:\Program Files\PostgreSQL\<version>\bin, newest version first.
function programFilesFolders(root = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PostgreSQL')) {
  let versions = [];
  try {
    versions = fs.readdirSync(root).filter((v) => /^\d+(\.\d+)?$/.test(v));
  } catch {
    return [];
  }
  return versions.sort((a, b) => Number(b) - Number(a)).map((v) => path.join(root, v, 'bin'));
}

// Where Settings → Backups → Get the backup tools puts them (backups/get-tools.js), set by main.js; looked in
// after PostgreSQL's own folders.
let appTools = null;
function useAppTools(dir) {
  appTools = dir;
}

// The first folder (in order) holding pg_dump and pg_restore, or '' to use the PATH.
function firstWithTools(folders, exists = fs.existsSync, platform = process.platform) {
  return folders.find((f) => f && exists(path.join(f, exe('pg_dump', platform))) && exists(path.join(f, exe('pg_restore', platform)))) || null;
}

// The major version in pg_dump --version's answer ("pg_dump (PostgreSQL) 16.4" -> 16), or null.
function toolsMajor(text) {
  const m = /\(PostgreSQL\)\s+(\d+)/.exec(String(text || '')) || /(\d+)(\.\d+)+/.exec(String(text || ''));
  return m ? Number(m[1]) : null;
}

// The database's PostgreSQL major version (16 for 16.4), or null when it can't be asked.
async function serverMajor(config) {
  if (!config || !config.host) return null;
  const { Client } = require('pg');
  const c = new Client({ connectionTimeoutMillis: 8000, ...config, port: Number(config.port || 5432) });
  c.on('error', () => {});
  try {
    await c.connect();
    const { rows: [r] } = await c.query('SHOW server_version_num');
    return Math.floor(Number(r.server_version_num) / 10000);
  } catch {
    return null;
  } finally {
    await c.end().catch(() => {});
  }
}

// { found: true, bin, dump, restore, version, fromApp } or { found: false, error }. fromApp: the ones Get the
// backup tools downloaded. serverMajor (the database's version, when known): pg_dump refuses a newer server, so the
// first tools at least that version are taken (an older PostgreSQL installed here for something else is passed over
// for the downloaded ones), and when none are, it says so.
async function findTools(chosen, { serverMajor: wanted = null } = {}) {
  const candidates = chosen ? [chosen] : [...(await serviceFolders()), ...programFilesFolders(), appTools];
  const folders = candidates.filter((f) => f && firstWithTools([f]));
  if (chosen && !folders.length) return { found: false, error: `pg_dump was not found in ${chosen}. Choose PostgreSQL's "bin" folder.` };
  const tried = [];
  // The folders in order, then the PATH ('').
  for (const bin of [...folders, '']) {
    const dump = bin ? path.join(bin, exe('pg_dump')) : exe('pg_dump');
    const restore = bin ? path.join(bin, exe('pg_restore')) : exe('pg_restore');
    if (!bin && chosen) break;
    const v = await run(dump, ['--version']);
    if (!v.ok) continue;
    const major = toolsMajor(v.stdout);
    const tools = { found: true, bin, dump, restore, version: v.stdout.trim(), fromApp: !!bin && bin === appTools };
    if (!wanted || !major || major >= wanted) return tools;
    tried.push(major);
  }
  if (tried.length) {
    return { found: false, error: `The backup tools on this PC are PostgreSQL ${Math.max(...tried)}, older than the database's PostgreSQL ${wanted}, which they can't back up. Get the right ones in Settings → Backups (Get the backup tools)${chosen ? ', or choose a newer PostgreSQL\'s "bin" folder' : ''}.` };
  }
  return { found: false, error: "PostgreSQL's backup tools (pg_dump) are not on this PC. Get them in Settings → Backups (Get the backup tools), or make the backups in the app on the PC that has the database." };
}

module.exports = { exe, run, findTools, serverMajor, toolsMajor, toolTempDir, PASSWORD_HINT, useAppTools, servicePathsToFolders, programFilesFolders, firstWithTools };
