// Settings → Setup Help: the details another PC needs (never the password), a connection test to any
// address using this PC's saved database name, username and password, and "Let other PCs connect" on the
// database PC. Settings → Database: making a new database on this PC. The working out is in setup/.
const os = require('os');
const { app, ipcMain } = require('electron');
const { createPgClient, loadPostgresConfig, savePostgresConfig, recheckDatabase } = require('../db');
const { PLUGIN_REPO, COMPANION_PLUGINS, pcAddresses, homeNetworkCidrs, connectionDetails, describeTestError } = require('../setup/help');
const { rangesToAllow } = require('../setup/remote-access');
const { letOtherPcsConnect } = require('../setup/elevated');
const { createDatabase } = require('../setup/create-database');

function savedConfig() {
  try { return loadPostgresConfig(); } catch { return {}; }
}

ipcMain.handle('setup:get-details', () => {
  const config = savedConfig();
  const addresses = pcAddresses(os.networkInterfaces());
  return {
    success: true,
    saved: !!config.host,
    hasPassword: !!config.password,
    tailscaleRunning: addresses.tailscale.length > 0,
    windows: process.platform === 'win32',
    pluginRepo: PLUGIN_REPO,
    companionPlugins: COMPANION_PLUGINS,
    ...connectionDetails(config, addresses, os.hostname()),
  };
});

// Connects to `host` with this PC's saved database name, username and password: { success } or
// { success: false, error } in plain words.
async function testConnection(host) {
  const config = savedConfig();
  if (!config.database) return { success: false, error: 'Save this PC\'s connection in the Database tab first.' };
  const client = createPgClient({ ...config, host, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    await client.query('SELECT 1');
    return { success: true };
  } catch (err) {
    return { success: false, error: describeTestError(err, host) };
  } finally {
    await client.end().catch(() => {});
  }
}

ipcMain.handle('setup:test-address', async (event, address) => {
  const host = String(address || '').trim();
  if (!host) return { success: false, error: 'Type the database PC\'s address first.' };
  return testConnection(host);
});

// On the database PC: whether it answers on the address other PCs use (its own Tailscale or home network
// address), which shows whether "Let other PCs connect" is still needed.
ipcMain.handle('setup:check-from-here', async (event, address) => {
  const host = String(address || '').trim();
  return host ? { address: host, ...(await testConnection(host)) } : { success: false, error: 'No address to try.' };
});

ipcMain.handle('setup:let-other-pcs-connect', async () => {
  const config = savedConfig();
  const ranges = rangesToAllow(homeNetworkCidrs(os.networkInterfaces()));
  const result = await letOtherPcsConnect({
    port: Number(config.port) || 5432,
    ranges,
    exePath: process.execPath,
    appDir: app.isPackaged ? null : app.getAppPath(),
  });
  return result.ok ? { success: true, changed: result.changed, ranges } : { success: false, error: result.error, changed: result.changed || [] };
});

// Makes the database and the app's login with PostgreSQL's administrator login, then switches this app to
// it. The administrator password is used only here and never saved.
ipcMain.handle('setup:create-database', async (event, input) => {
  const port = Number(input.port) || 5432;
  const admin = createPgClient({ host: 'localhost', port, database: 'postgres', user: input.adminUser || 'postgres', password: input.adminPassword || '', connectionTimeoutMillis: 5000 });
  try {
    await admin.connect();
  } catch (err) {
    return { success: false, error: describeTestError(err, 'localhost') };
  }
  try {
    const made = await createDatabase(admin, { database: input.database, user: input.user, password: input.password });
    if (!made.ok) return { success: false, error: made.error };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    await admin.end().catch(() => {});
  }
  savePostgresConfig({ host: 'localhost', port, database: input.database, user: input.user, password: input.password });
  recheckDatabase();
  return { success: true };
});
