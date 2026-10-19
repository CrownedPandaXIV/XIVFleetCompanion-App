// Database updates (db/apply-updates.js, run from db/index.js on the first connection): what happened, for the
// window's banner. Changes are also sent to the window as 'database-status' messages.
const { ipcMain } = require('electron');
const { databaseStatus } = require('../db');

ipcMain.handle('get-database-status', () => databaseStatus());

// Settings → Database → Speed check (db/speed-check.js): the database side, measured here. The window then
// times each tab's loading and sends both back for the findings and a copyable report.
const fs = require('fs');
const { execFile } = require('child_process');
const { app } = require('electron');
const { createPgClient, loadPostgresConfig } = require('../db');
const { measureDatabase, tailscaleRoute, speedFindings, speedReport, traceQueries } = require('../db/speed-check');
const { tailscaleExe } = require('../setup/installers');

const isLocalHost = (host) => !host || /^(localhost|127\.0\.0\.1|::1)$/i.test(String(host).trim());

// How Tailscale reaches the database PC (directly or through a relay); null when it isn't used for it.
function pingThroughTailscale(host) {
  if (process.platform !== 'win32' || isLocalHost(host) || !fs.existsSync(tailscaleExe())) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(tailscaleExe(), ['ping', '-c', '5', String(host)], { windowsHide: true, timeout: 20000 }, (err, stdout) => resolve(tailscaleRoute(stdout)));
  });
}

ipcMain.handle('database:speed-check', async () => {
  let config;
  try {
    config = loadPostgresConfig();
  } catch (err) {
    return { success: false, error: err.message };
  }
  try {
    const [measured, tailscale] = await Promise.all([
      measureDatabase(config, { createClient: createPgClient }),
      pingThroughTailscale(config.host),
    ]);
    return { success: true, measured: { ...measured, tailscale, local: isLocalHost(config.host) } };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// The detail: the work behind the Income and Summary tabs (their sub loot and venture rewards, and Income's own
// figures), with each database question timed, so the slowest one can be named. Only reads.
ipcMain.handle('database:speed-detail', async () => {
  // Loaded here: these files need the database code above to be in place first.
  const { loadIncome } = require('./income');
  const { loadLoot } = require('./details');
  const { loadSubmarines } = require('./subs');
  const { liveUniversalis } = require('./universalis');
  const parts = [
    ['Income figures', (c) => loadIncome(c)],
    ['Loot and venture rewards (Income and Summary)', async (c) => loadLoot(c, { universalis: await liveUniversalis(c) })],
    ['Subs (also used by Income and Summary)', (c) => loadSubmarines(c)],
  ];
  let client;
  try {
    client = createPgClient(loadPostgresConfig());
    await client.connect();
  } catch (err) {
    return { success: false, error: err.message };
  }
  const details = [];
  try {
    for (const [part, work] of parts) {
      try {
        details.push({ part, ...(await traceQueries(client, work)) });
      } catch (err) {
        details.push({ part, error: err.message });
      }
    }
  } finally {
    await client.end().catch(() => {});
  }
  return { success: true, details };
});

ipcMain.handle('database:speed-findings', (event, { measured, tabs, details }) => {
  const findings = speedFindings(measured, tabs);
  return { findings, report: speedReport({ measured, tabs, findings, details, appVersion: app.getVersion() }) };
});
