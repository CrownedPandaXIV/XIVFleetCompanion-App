// Settings → Database → Move the database to this PC: what the window shows before starting (where the database
// is now, this PC's addresses, whether PostgreSQL is here, and the checks), and the move itself, with its
// progress sent to the window as 'move:progress'. The working out is in setup/move-database.js.
const os = require('os');
const path = require('path');
const fs = require('fs');
const { app, ipcMain } = require('electron');
const { createPgClient, loadPostgresConfig, savePostgresConfig } = require('../db');
const { pcAddresses, homeNetworkCidrs, isThisPc } = require('../setup/help');
const { rangesToAllow } = require('../setup/remote-access');
const { runElevated, postgresServices } = require('../setup/elevated');
const { DOWNLOADS, downloadFor, downloadOnce, postgresOptions } = require('../setup/installers');
const { downloadDir } = require('../setup/run-setup');
const { recordInstalled } = require('../setup/remove-everything');
const { findTools, run } = require('../backups/tools');
const { addressChoices, checkOld, stepsFor, moveDatabase } = require('../setup/move-database');
const { stepsText } = require('../app-log');

function savedConfig() {
  try { return loadPostgresConfig(); } catch { return null; }
}

const postgresHere = async () => process.platform === 'win32' && (await postgresServices()).length > 0;

function deps() {
  return {
    createClient: (config) => createPgClient({ connectionTimeoutMillis: 8000, ...config }),
    isThisPc: (host) => isThisPc(host, pcAddresses(os.networkInterfaces()), os.hostname()),
  };
}

ipcMain.handle('move:info', async () => {
  const config = savedConfig();
  const installed = await postgresHere();
  const addresses = pcAddresses(os.networkInterfaces());
  const info = {
    windows: process.platform === 'win32',
    postgresInstalled: installed,
    postgresName: DOWNLOADS.postgres.name,
    from: config ? { host: config.host, port: Number(config.port) || 5432, database: config.database, user: config.user } : null,
    choices: addressChoices(config ? config.host : '', addresses),
  };
  if (!config) return { ...info, check: { ok: false, error: 'This app isn\'t connected to a database yet.', blocking: [], notes: [] } };
  const check = await checkOld({ config }, deps()).catch((err) => ({ ok: false, error: err.message, blocking: [], notes: [] }));
  return { ...info, check: { ok: check.ok, error: check.error, blocking: check.blocking, notes: check.notes } };
});

ipcMain.handle('move:steps', async () => stepsFor({ installPostgres: !(await postgresHere()) }));

let running = false;
ipcMain.handle('move:run', async (event, input) => {
  if (running) return { ok: false, error: 'A move is already running.' };
  const config = savedConfig();
  if (!config) return { ok: false, error: 'This app isn\'t connected to a database yet.' };
  if (process.platform !== 'win32') return { ok: false, error: 'Moving the database can only be done on Windows.' };
  const address = String(input.address || '').trim();
  const addresses = pcAddresses(os.networkInterfaces());
  if (![...addresses.tailscale, ...addresses.home].includes(address)) return { ok: false, error: 'Choose one of this PC\'s own addresses.' };
  running = true;
  try {
    const installPostgres = !(await postgresHere());
    const result = await moveDatabase({
      config,
      address,
      port: Number(input.port) || 5432,
      adminPassword: String(input.adminPassword || ''),
      installPostgres,
    }, {
      ...deps(),
      findTools: () => findTools(),
      runTool: run,
      download: async (onProgress) => {
        const file = downloadFor('postgres', process.arch);
        if (!file) throw new Error(`${DOWNLOADS.postgres.name} has no Windows version for this PC's processor.`);
        fs.mkdirSync(downloadDir(), { recursive: true });
        return downloadOnce(file, path.join(downloadDir(), path.basename(new URL(file.url).pathname)), onProgress);
      },
      postgresOptionsFile: (password, port) => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiv-fleet-pg-'));
        const file = path.join(dir, 'options.txt');
        fs.writeFileSync(file, postgresOptions(password, port));
        return { file, remove: () => fs.rmSync(dir, { recursive: true, force: true }) };
      },
      removeFile: (file) => fs.rmSync(file, { force: true }),
      runElevated: (steps, onProgress) => runElevated(steps, { exePath: process.execPath, appDir: app.isPackaged ? null : app.getAppPath(), onProgress }),
      recordInstalled: (what) => recordInstalled(app.getPath('userData'), what),
      ranges: () => rangesToAllow(homeNetworkCidrs(os.networkInterfaces())),
      saveConfig: savePostgresConfig,
      tmpDir: path.join(os.tmpdir(), 'xiv-fleet-move'),
    }, (steps) => { if (!event.sender.isDestroyed()) event.sender.send('move:progress', steps); });
    (result.ok ? console.log : console.error)(stepsText('Moving the database here', result));
    return { ok: result.ok, error: result.error || null, steps: result.steps, to: result.to || null };
  } catch (err) {
    return { ok: false, error: err.message, steps: [] };
  } finally {
    running = false;
  }
});
