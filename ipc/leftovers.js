// Settings → Database → Leftovers from moving the database: finding and removing what a move left in this PC's
// PostgreSQL, and PostgreSQL itself when only leftovers are in it. PostgreSQL's master password is typed for each
// and never saved. The working out is in setup/leftovers.js.
const os = require('os');
const { app, ipcMain } = require('electron');
const { createPgClient, loadPostgresConfig } = require('../db');
const { pcAddresses, isThisPc, describeTestError } = require('../setup/help');
const { runElevated, postgresServices } = require('../setup/elevated');
const { readInstalled, forgetInstalled } = require('../setup/remove-everything');
const { findLeftovers, postgresRemovable, removeLeftover, connectProblem } = require('../setup/leftovers');

// The UI tests have no PostgreSQL Windows service; this stands in for one.
const testPostgres = () => !!process.env.XIV_FLEET_TEST_LOCAL_POSTGRES;

function savedConfig() {
  try { return loadPostgresConfig(); } catch { return null; }
}

// The database the app uses, when it's in the PostgreSQL on this port of this PC.
function currentHere(port) {
  const config = savedConfig();
  if (!config || !isThisPc(config.host, pcAddresses(os.networkInterfaces()), os.hostname())) return null;
  return Number(config.port || 5432) === port ? config.database : null;
}

// Runs work(admin, { connectTo, current, port }) logged in as PostgreSQL's administrator on this PC.
async function asAdmin(input, work) {
  const port = Number(input.port) || 5432;
  const login = { host: 'localhost', port, user: 'postgres', password: String(input.adminPassword || ''), connectionTimeoutMillis: 5000 };
  const admin = createPgClient({ ...login, database: 'postgres' });
  try {
    await admin.connect();
  } catch (err) {
    await admin.end().catch(() => {});
    return { success: false, error: connectProblem(err) || describeTestError(err, 'localhost') };
  }
  const connectTo = async (database) => {
    const c = createPgClient({ ...login, database });
    try { await c.connect(); } catch (err) { await c.end().catch(() => {}); throw err; }
    return c;
  };
  try {
    return await work(admin, { connectTo, current: currentHere(port), port });
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    await admin.end().catch(() => {});
  }
}

ipcMain.handle('leftovers:info', async () => {
  const here = testPostgres() || (process.platform === 'win32' && (await postgresServices()).length > 0);
  const installed = readInstalled(app.getPath('userData'));
  return { show: here, port: installed.postgres ? Number(installed.postgres.port) : 5432 };
});

ipcMain.handle('leftovers:find', (event, input) => asAdmin(input, async (admin, ctx) => {
  const found = await findLeftovers(admin, ctx);
  const installed = readInstalled(app.getPath('userData'));
  return {
    success: true,
    leftovers: found.leftovers,
    canRemovePostgres: process.platform === 'win32' && postgresRemovable({ found, installed, port: ctx.port, current: ctx.current }),
  };
}));

ipcMain.handle('leftovers:remove', (event, input) => asAdmin(input, async (admin, ctx) => {
  const r = await removeLeftover(admin, String(input.name || ''), ctx);
  return r.ok ? { success: true } : { success: false, error: r.error };
}));

// PostgreSQL itself, with one Windows permission prompt; only when findLeftovers still finds nothing but leftovers.
ipcMain.handle('leftovers:remove-postgres', async (event, input) => {
  const checked = await asAdmin(input, async (admin, ctx) => {
    const found = await findLeftovers(admin, ctx);
    const ok = process.platform === 'win32' && postgresRemovable({ found, installed: readInstalled(app.getPath('userData')), port: ctx.port, current: ctx.current });
    return ok ? { success: true, port: ctx.port } : { success: false, error: 'PostgreSQL on this PC has more than leftovers in it now, so it wasn\'t removed.' };
  });
  if (!checked.success) return checked;
  const r = await runElevated([{ kind: 'removePostgres', port: checked.port }], { exePath: process.execPath, appDir: app.isPackaged ? null : app.getAppPath() });
  if (!r.results) return { success: false, error: r.error };
  const step = r.results[0];
  if (!step.ok) return { success: false, error: step.message };
  forgetInstalled(app.getPath('userData'), { postgres: true });
  return { success: true, message: step.message };
});
