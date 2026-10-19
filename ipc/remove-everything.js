// Settings → Setup Help → Remove everything from this PC: what it would remove, running it with its progress
// sent to the window as 'setup:remove-progress', and closing the app so it can remove itself and its
// settings. The working out is in setup/remove-everything.js.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { app, ipcMain } = require('electron');
const { createPgClient, loadPostgresConfig } = require('../db');
const { pcAddresses, isThisPc } = require('../setup/help');
const { tailscaleExe } = require('../setup/installers');
const { runElevated, postgresServices } = require('../setup/elevated');
const { downloadFolders } = require('../updater');
const { readInstalled, forgetInstalled, removalPlan, removeEverything, finishScript, startFinish } = require('../setup/remove-everything');
const { readMoveNote } = require('../db/database-move');
const { findMovedAwayCopy } = require('../setup/leftovers');
const { loadBackupSettings } = require('../backups/settings');
const { settingsFile } = require('../backups/app');
const { findTools } = require('../backups/tools');
const { backupNow } = require('../backups/run');
const backupSchedule = require('../backups/schedule');
const alertSchedule = require('../alerts/schedule');

const userData = () => app.getPath('userData');
const localTime = (d = new Date()) => {
  const two = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
};
const savedConfig = () => { try { return loadPostgresConfig(); } catch { return null; } };

// The other databases in the same PostgreSQL (shown before it's removed), read with the app's own login.
async function otherDatabases(config) {
  const client = createPgClient({ ...config, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    return (await client.query("SELECT datname FROM pg_database WHERE NOT datistemplate AND datname NOT IN ('postgres', $1) ORDER BY 1", [config.database])).rows.map((r) => r.datname);
  } catch {
    return [];
  } finally {
    await client.end().catch(() => {});
  }
}

async function facts() {
  const config = savedConfig();
  const connection = config && config.host ? config : null;
  const dbOnThisPc = !!connection && isThisPc(connection.host, pcAddresses(os.networkInterfaces()), os.hostname());
  const windows = process.platform === 'win32';
  const installed = readInstalled(userData());
  const postgresHere = windows && (await postgresServices()).length > 0;
  const ports = [...new Set([installed.postgres && Number(installed.postgres.port), 5432].filter(Boolean))];
  const connectHere = async (port) => {
    const client = createPgClient({ ...connection, host: 'localhost', port, connectionTimeoutMillis: 5000 });
    try { await client.connect(); } catch (err) { await client.end().catch(() => {}); throw err; }
    return client;
  };
  const movedAway = connection && !dbOnThisPc && postgresHere ? await findMovedAwayCopy(ports, connectHere) : null;
  return {
    installed,
    connection: connection && { host: connection.host, port: connection.port, database: connection.database, user: connection.user },
    dbOnThisPc,
    postgresHere,
    tailscaleHere: windows && fs.existsSync(tailscaleExe()),
    otherDatabases: dbOnThisPc ? await otherDatabases(connection) : movedAway ? await otherDatabases({ ...connection, host: 'localhost', port: movedAway.port }) : [],
    movedAway,
    packaged: app.isPackaged,
  };
}

ipcMain.handle('setup:removal-plan', async () => ({
  windows: process.platform === 'win32',
  plan: removalPlan(await facts()),
  backupFolder: path.join(app.getPath('documents'), 'XIV Fleet Companion final backup'),
}));

let running = false;
let removed = false;
ipcMain.handle('setup:remove-everything', async (event, input) => {
  if (running) return { ok: false, error: 'Already removing.' };
  running = true;
  try {
    const deps = {
      facts,
      makeBackup: async (folder) => {
        try {
          const { settings } = loadBackupSettings(settingsFile());
          const tools = await findTools(settings.pgBin);
          if (!tools.found) return { ok: false, message: tools.error };
          return await backupNow({ tools, config: loadPostgresConfig(), settings: { folder, copyFolder: null, keep: 1000 } });
        } catch (err) {
          return { ok: false, message: err.message };
        }
      },
      connectAdmin: async ({ port, password }) => {
        const client = createPgClient({ host: 'localhost', port, database: 'postgres', user: 'postgres', password, connectionTimeoutMillis: 5000 });
        try { await client.connect(); } catch (err) { await client.end().catch(() => {}); throw err; }
        return client;
      },
      isMovedAwayCopy: async ({ port, password, database }) => {
        const client = createPgClient({ host: 'localhost', port, database, user: 'postgres', password, connectionTimeoutMillis: 5000 });
        try {
          await client.connect();
          const note = await readMoveNote(client);
          return !!note && note.state === 'moved';
        } catch {
          return false;
        } finally {
          await client.end().catch(() => {});
        }
      },
      removeTasks: async () => {
        for (const name of [backupSchedule.TASK_NAME, alertSchedule.TASK_NAME]) {
          const r = await backupSchedule.removeTask(name);
          if (!r.ok) return r;
        }
        return { ok: true };
      },
      runElevated: (steps, onProgress) => runElevated(steps, { exePath: process.execPath, appDir: app.isPackaged ? null : app.getAppPath(), onProgress, keepGoing: true }),
      forgetInstalled: (what) => forgetInstalled(userData(), what),
    };
    const result = await removeEverything(input || {}, deps, (steps) => { if (!event.sender.isDestroyed()) event.sender.send('setup:remove-progress', steps); });
    removed = result.ok;
    return { ok: result.ok, error: result.error || null, steps: result.steps || [] };
  } catch (err) {
    return { ok: false, error: err.message, steps: [] };
  } finally {
    running = false;
  }
});

// The last part, once the rest is removed: a PowerShell script (setup/remove-everything.js), saved as
// %TEMP%\xiv-fleet-remove.ps1, waits for the app to close, runs its uninstaller (the installed app only) and
// deletes its settings folder. Each step goes in %TEMP%\xiv-fleet-remove.log, which is started here first.
// The script is started through Windows' process service, not as one of the app's own processes (which
// Windows may stop along with the app), and the app closes only once it says it's running. If it doesn't,
// the window says why and nothing closes.
ipcMain.handle('setup:finish-removal', async () => {
  if (!removed) return { ok: false, error: 'Remove everything first.' };
  if (process.platform === 'win32') {
    const log = path.join(os.tmpdir(), 'xiv-fleet-remove.log');
    const file = path.join(os.tmpdir(), 'xiv-fleet-remove.ps1');
    // In local time, like the script's own lines.
    const note = (m) => { try { fs.appendFileSync(log, `${localTime()}  ${m}\r\n`); } catch { /* the log is only a help */ } };
    try {
      fs.writeFileSync(log, '');
      note(`Remove everything: starting the clean-up, ${file}`);
      // With a byte order mark, so Windows PowerShell reads any non-English letters in the folder names right.
      fs.writeFileSync(file, '﻿' + finishScript({
        pid: process.pid,
        installDir: app.isPackaged ? path.dirname(process.execPath) : null,
        userData: userData(),
        folders: downloadFolders(),
        log,
      }).replace(/\n/g, '\r\n'), 'utf8');
    } catch (err) {
      return { ok: false, error: `The removal couldn't start: ${err.message}` };
    }
    const started = await startFinish({
      launch: () => new Promise((resolve) => {
        execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file, '-Launch'],
          { windowsHide: true, timeout: 60000 }, (err, stdout, stderr) => {
            resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: `${stderr || ''}`.trim() || (err && !stdout ? err.message : '') });
          });
      }),
      readLog: () => { try { return fs.readFileSync(log, 'utf8'); } catch { return ''; } },
      wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    });
    if (!started.ok) {
      note(started.error);
      return started;
    }
    note('The app is closing.');
  }
  // exit, not quit: nothing may keep the app open now.
  setTimeout(() => app.exit(0), 300);
  return { ok: true };
});
