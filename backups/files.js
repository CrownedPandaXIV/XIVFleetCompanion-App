// Backup file names and which old ones to remove. Named as the earlier backup scripts named them
// (fleet-YYYYMMDD-HHMMSS.dump, this PC's time), so their backups are listed and kept in the same count.
const fs = require('fs');
const path = require('path');

const BACKUP_FILE = /^fleet-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.dump$/;

function backupName(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `fleet-${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}.dump`;
}

// When a backup was taken, from its name (milliseconds), or null for any other file.
function backupTime(name) {
  const m = BACKUP_FILE.exec(name);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  return new Date(y, mo - 1, d, h, mi, s).getTime();
}

// The backups in a folder, newest first: [{ name, file, takenAt, size }]. Empty when there is no folder.
function listBackups(folder) {
  let names = [];
  try {
    names = fs.readdirSync(folder);
  } catch {
    return [];
  }
  const list = [];
  for (const name of names) {
    const takenAt = backupTime(name);
    if (takenAt === null) continue;
    let size = null;
    try { size = fs.statSync(path.join(folder, name)).size; } catch { /* listed without a size */ }
    list.push({ name, file: path.join(folder, name), takenAt, size });
  }
  return list.sort((a, b) => b.name.localeCompare(a.name));
}

// listBackups without holding up the app: a folder on another PC that is off or asleep can keep Windows waiting
// for tens of seconds. Gives up after timeoutMs: { list, unreachable } (unreachable: the folder didn't answer in time).
async function listBackupsSoon(folder, timeoutMs = 3000) {
  const read = (async () => {
    let names;
    try {
      names = await fs.promises.readdir(folder);
    } catch {
      return [];
    }
    const list = [];
    for (const name of names) {
      const takenAt = backupTime(name);
      if (takenAt === null) continue;
      let size = null;
      try { size = (await fs.promises.stat(path.join(folder, name))).size; } catch { /* listed without a size */ }
      list.push({ name, file: path.join(folder, name), takenAt, size });
    }
    return list.sort((a, b) => b.name.localeCompare(a.name));
  })();
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
  const list = await Promise.race([read, late]);
  clearTimeout(timer);
  return list === null ? { list: [], unreachable: true } : { list, unreachable: false };
}

// The backups beyond the newest `keep`, oldest last (the ones to remove).
function backupsToRemove(list, keep) {
  return list.slice().sort((a, b) => b.name.localeCompare(a.name)).slice(keep);
}

module.exports = { BACKUP_FILE, backupName, backupTime, listBackups, listBackupsSoon, backupsToRemove };
