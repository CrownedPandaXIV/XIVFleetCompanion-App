// Finds PostgreSQL's own backup tools (pg_dump, pg_restore) on this PC: the folder chosen in Settings,
// else the PostgreSQL Windows service's folder, else C:\Program Files\PostgreSQL\<newest>\bin, else the
// PATH. They come with every PostgreSQL install, so the database PC always has them; other PCs usually
// do not, and back up nothing (the database PC does it).
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const exe = (name, platform = process.platform) => (platform === 'win32' ? `${name}.exe` : name);

function run(file, args, options = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024, ...options }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
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

// The first folder (in order) holding pg_dump and pg_restore, or '' to use the PATH.
function firstWithTools(folders, exists = fs.existsSync, platform = process.platform) {
  return folders.find((f) => f && exists(path.join(f, exe('pg_dump', platform))) && exists(path.join(f, exe('pg_restore', platform)))) || null;
}

// { found: true, bin, dump, restore, version } or { found: false, error }.
async function findTools(chosen) {
  const candidates = chosen ? [chosen] : [...(await serviceFolders()), ...programFilesFolders()];
  const bin = firstWithTools(candidates);
  if (chosen && !bin) return { found: false, error: `pg_dump was not found in ${chosen}. Choose PostgreSQL's "bin" folder.` };
  const dump = bin ? path.join(bin, exe('pg_dump')) : exe('pg_dump');
  const restore = bin ? path.join(bin, exe('pg_restore')) : exe('pg_restore');
  const v = await run(dump, ['--version']);
  if (!v.ok) {
    return { found: false, error: "PostgreSQL's backup tools (pg_dump) are not on this PC. Turn backups on in the app on the PC that has the database, or choose PostgreSQL's \"bin\" folder." };
  }
  return { found: true, bin: bin || '', dump, restore, version: v.stdout.trim() };
}

module.exports = { exe, run, findTools, servicePathsToFolders, programFilesFolders, firstWithTools };
