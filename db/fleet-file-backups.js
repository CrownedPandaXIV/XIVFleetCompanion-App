// The fleet file's backups, as the plugin keeps them (FileDatabase.cs): Backups\fleet-2026-11-07.db beside the file
// (a second one the same day gets the time too), the newest 7 kept. The app can list them and make one; putting one
// back is done in the game (the plugin checks it and stops its own writing while it does).
const fs = require('fs');
const path = require('path');

process.removeAllListeners('warning'); // node:sqlite's "experimental" notice
const { DatabaseSync } = require('node:sqlite');

const KEPT = 7;
const folderOf = (fleetFile) => path.join(path.dirname(path.resolve(fleetFile)), 'Backups');
const pad = (n) => String(n).padStart(2, '0');
const day = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const time = (d) => `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

// Newest first: [{ name, file, bytes, at (Date) }].
function listBackups(fleetFile) {
  const folder = folderOf(fleetFile);
  let names;
  try { names = fs.readdirSync(folder); } catch { return []; }
  return names.filter((n) => /^fleet-.*\.db$/i.test(n)).map((name) => {
    const file = path.join(folder, name);
    const stat = fs.statSync(file);
    return { name, file, bytes: stat.size, at: stat.mtime };
  }).sort((a, b) => b.at - a.at || (a.name < b.name ? 1 : -1));
}

// A copy of the file as it is now (one moment of it, even while a game writes), then only the newest 7 kept.
function backUpNow(fleetFile, now = new Date()) {
  const folder = folderOf(fleetFile);
  fs.mkdirSync(folder, { recursive: true });
  let name = path.join(folder, `fleet-${day(now)}.db`);
  if (fs.existsSync(name)) name = path.join(folder, `fleet-${day(now)}-${time(now)}.db`);
  const temp = path.join(folder, `making-${process.pid}-${Date.now()}.tmp`);
  const db = new DatabaseSync(fleetFile, { timeout: 15000 });
  try {
    db.prepare('VACUUM INTO ?').run(temp);
  } finally {
    db.close();
  }
  try {
    fs.renameSync(temp, name);
  } finally {
    if (fs.existsSync(temp)) fs.rmSync(temp, { force: true });
  }
  for (const old of listBackups(fleetFile).slice(KEPT)) {
    try { fs.rmSync(old.file); } catch { /* in use: next time */ }
  }
  return name;
}

module.exports = { KEPT, listBackups, backUpNow, folderOf };
