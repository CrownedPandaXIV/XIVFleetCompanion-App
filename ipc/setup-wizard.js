// The setup screen ("Set up this PC", also shown on first start): what this PC already has, the plan for each
// kind of PC, running the setup with its progress sent to the window as 'setup:progress', and Tailscale's
// sign-in. The working out is in setup/installers.js and setup/run-setup.js.
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { app, ipcMain, shell } = require('electron');
const { run } = require('../backups/tools');
const { createPgClient, savePostgresConfig, recheckDatabase } = require('../db');
const { ROLES, DOWNLOADS, setupPlan, downloadOnce, suggestPassword, tailscaleExe, loginUrl, tailscaleStatus } = require('../setup/installers');
const { stepsFor, runSetup } = require('../setup/run-setup');
const { runElevated, postgresServices } = require('../setup/elevated');
const { rangesToAllow } = require('../setup/remote-access');
const { homeNetworkCidrs } = require('../setup/help');
const { createDatabase } = require('../setup/create-database');
const { recordInstalled } = require('../setup/remove-everything');

// What this PC already has: { postgres, tailscale }.
async function detect() {
  if (process.platform !== 'win32') return { postgres: false, tailscale: false };
  return { postgres: (await postgresServices()).length > 0, tailscale: fs.existsSync(tailscaleExe()) };
}

ipcMain.handle('setup:wizard-info', async () => ({
  windows: process.platform === 'win32',
  installed: await detect(),
  roles: Object.entries(ROLES).map(([key, r]) => ({ key, ...r })),
  downloads: { postgres: DOWNLOADS.postgres.name, tailscale: DOWNLOADS.tailscale.name },
}));

ipcMain.handle('setup:plan', async (event, { role, sameNetwork }) => {
  const plan = setupPlan(role, { sameNetwork, installed: await detect() });
  return plan ? { plan, steps: stepsFor(plan) } : null;
});

ipcMain.handle('setup:suggest-password', () => suggestPassword());

let running = false;
ipcMain.handle('setup:run', async (event, input) => {
  if (running) return { ok: false, error: 'Setup is already running.' };
  running = true;
  try {
    const deps = {
      detect,
      download: downloadOnce,
      ranges: () => rangesToAllow(homeNetworkCidrs(os.networkInterfaces())),
      runElevated: (steps, onProgress) => runElevated(steps, { exePath: process.execPath, appDir: app.isPackaged ? null : app.getAppPath(), onProgress }),
      recordInstalled: (what) => recordInstalled(app.getPath('userData'), what),
      connectAdmin: async ({ port, password }) => {
        const client = createPgClient({ host: 'localhost', port, database: 'postgres', user: 'postgres', password, connectionTimeoutMillis: 5000 });
        try { await client.connect(); } catch (err) { await client.end().catch(() => {}); throw err; }
        return client;
      },
      createDatabase,
      saveConfig: (config) => { savePostgresConfig(config); recheckDatabase(); },
      wait: (ms) => new Promise((r) => setTimeout(r, ms)),
    };
    const result = await runSetup(input, deps, (steps) => { if (!event.sender.isDestroyed()) event.sender.send('setup:progress', steps); });
    return { ok: result.ok, error: result.error || null, steps: result.steps || [], plan: result.plan || null };
  } catch (err) {
    return { ok: false, error: err.message, steps: [] };
  } finally {
    running = false;
  }
});

ipcMain.handle('setup:tailscale-status', async () => {
  if (process.platform !== 'win32' || !fs.existsSync(tailscaleExe())) return { installed: false, signedIn: false, address: null };
  const r = await run(tailscaleExe(), ['status', '--json']);
  return { installed: true, ...tailscaleStatus(r.stdout) };
});

// Starts Tailscale's sign-in and opens its page in the browser. unattended: keep Tailscale connected while no
// one is signed in to Windows (for the database PC). Resolves once the page is opened, or Tailscale says it's
// already signed in.
ipcMain.handle('setup:tailscale-sign-in', async (event, { unattended } = {}) => {
  if (process.platform !== 'win32' || !fs.existsSync(tailscaleExe())) return { ok: false, error: "Tailscale isn't installed on this PC yet." };
  return new Promise((resolve) => {
    const args = ['up', ...(unattended ? ['--unattended'] : [])];
    const child = spawn(tailscaleExe(), args, { windowsHide: true });
    let output = '';
    let done = false;
    const finish = (result) => { if (!done) { done = true; resolve(result); } };
    const look = (chunk) => {
      output += chunk;
      const url = loginUrl(output);
      if (url) { shell.openExternal(url); finish({ ok: true, opened: true }); }
    };
    child.stdout.on('data', look);
    child.stderr.on('data', look);
    child.on('error', (err) => finish({ ok: false, error: err.message }));
    child.on('exit', (code) => finish(code === 0 ? { ok: true, opened: false } : { ok: false, error: output.trim() || `Tailscale stopped with code ${code}.` }));
    setTimeout(() => finish({ ok: true, opened: false, waiting: true }), 20000);
  });
});
