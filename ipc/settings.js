// Settings: app version, Postgres connection (and whether it can be reached), auto-refresh, repair kit
// cost, low-level and house warnings.
const { app, ipcMain } = require('electron');
const { createPgClient, loadPostgresConfig, savePostgresConfig, withClient, connectionStatus } = require('../db');
const { DEMOLITION_DAYS, warnDaysSetting } = require('../characters/house-warning');

// The app's version (from package.json), shown in Settings.
ipcMain.handle('get-app-version', () => app.getVersion());

// Whether the database can be reached right now (see connection-status.js); changes are also sent
// to the window as 'connection-status' messages.
ipcMain.handle('get-connection-status', () => connectionStatus());

// Returns the current Postgres connection details for the Settings form -
// EXCEPT the password itself, which never gets sent back to the renderer
// even encrypted-in-transit, since decrypting it just to display it back
// would defeat part of the point of encrypting it at rest. The form
// shows "already set" instead, and only overwrites the saved password if
// the person actually types a new one.
ipcMain.handle('settings:get-postgres-config', async () => {
  try {
    const config = loadPostgresConfig();
    return {
      success: true,
      host: config.host || '',
      port: config.port || '',
      database: config.database || '',
      user: config.user || '',
      hasPassword: !!config.password
    };
  } catch (err) {
    return { success: true, host: '', port: '', database: '', user: '', hasPassword: false };
  }
});

// Saves new Postgres connection details from the Settings form. If
// newPassword is blank, the EXISTING saved password is kept rather than
// being overwritten with blank - lets the person update the host without
// being forced to retype the password every time.
ipcMain.handle('settings:save-postgres-config', async (event, { host, port, database, user, newPassword }) => {
  try {
    let password = newPassword;
    if (!password) {
      try {
        const existing = loadPostgresConfig();
        password = existing.password;
      } catch {
        password = '';
      }
    }

    savePostgresConfig({ host, port: Number(port), database, user, password });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Tests a connection WITHOUT saving first - lets the person verify new
// details work before committing them. If newPassword is blank, tests
// against the currently-saved password instead (so testing after a
// host-only edit doesn't require retyping the password).
ipcMain.handle('settings:test-postgres-connection', async (event, { host, port, database, user, newPassword }) => {
  let password = newPassword;
  if (!password) {
    try {
      const existing = loadPostgresConfig();
      password = existing.password;
    } catch {
      password = '';
    }
  }

  const testClient = createPgClient({ host, port: Number(port), database, user, password, connectionTimeoutMillis: 5000 });
  try {
    await testClient.connect();
    await testClient.query('SELECT 1');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    await testClient.end().catch(() => {});
  }
});

// Auto-refresh interval, read from tier3_settings. Defaults to 5 minutes
// if nothing's been saved yet (the table exists but starts empty).
ipcMain.handle('settings:get-auto-refresh-interval', async () => {
  return withClient(async (client) => {
    const result = await client.query(
      `SELECT setting_value FROM tier3_settings WHERE setting_key = 'auto_refresh_minutes'`
    );
    const minutes = result.rows.length > 0 ? Number(result.rows[0].setting_value) : 5;
    return { success: true, minutes };
  }, (err) => {
    return { success: false, error: err.message, minutes: 5 };
  });
});

ipcMain.handle('settings:save-auto-refresh-interval', async (event, minutes) => {
  return withClient(async (client) => {
    await client.query(
      `INSERT INTO tier3_settings (setting_key, setting_value, updated_at)
       VALUES ('auto_refresh_minutes', $1, now())
       ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now()`,
      [String(minutes)]
    );
    return { success: true };
  }, (err) => {
    return { success: false, error: err.message };
  });
});

// Repair Kit Cost - a standalone economics constant (not tied to any
// particular rank rule), read from fleet_economics_settings. Returns
// null if nothing's been saved yet, rather than a misleading default -
// unlike auto-refresh, there's no sane guess for this value.
ipcMain.handle('settings:get-repair-kit-cost', async () => {
  return withClient(async (client) => {
    const result = await client.query(
      `SELECT setting_value FROM fleet_economics_settings WHERE setting_key = 'repair_kit_cost'`
    );
    const value = result.rows.length > 0 ? Number(result.rows[0].setting_value) : null;
    return { success: true, value };
  }, (err) => {
    return { success: false, error: err.message, value: null };
  });
});

ipcMain.handle('settings:save-repair-kit-cost', async (event, value) => {
  return withClient(async (client) => {
    await client.query(
      `INSERT INTO fleet_economics_settings (setting_key, setting_value, updated_at)
       VALUES ('repair_kit_cost', $1, now())
       ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now()`,
      [value]
    );
    return { success: true };
  }, (err) => {
    return { success: false, error: err.message };
  });
});

// Low-level warning thresholds (repair kits / ceruleum), same
// key-value pattern as repair_kit_cost. Defaults to 0 (effectively
// off) until the user sets a real number - no sane guess exists for
// this, same reasoning as repair_kit_cost.
ipcMain.handle('settings:get-low-thresholds', async () => {
  return withClient(async (client) => {
    const result = await client.query(
      `SELECT setting_key, setting_value FROM fleet_economics_settings
       WHERE setting_key IN ('low_repair_kit_threshold', 'low_ceruleum_threshold', 'house_warn_days')`
    );
    const byKey = {};
    for (const row of result.rows) byKey[row.setting_key] = Number(row.setting_value);
    return {
      success: true,
      repairKitThreshold: byKey.low_repair_kit_threshold ?? 0,
      ceruleumThreshold: byKey.low_ceruleum_threshold ?? 0,
      houseWarnDays: warnDaysSetting(byKey.house_warn_days)
    };
  }, (err) => {
    return { success: false, error: err.message, repairKitThreshold: 0, ceruleumThreshold: 0, houseWarnDays: warnDaysSetting(null) };
  });
});

ipcMain.handle('settings:save-low-thresholds', async (event, { repairKitThreshold, ceruleumThreshold, houseWarnDays }) => {
  // The house warning (days since an FC house was last entered) is saved alongside, when given.
  if (houseWarnDays !== undefined && !(Number.isInteger(houseWarnDays) && houseWarnDays >= 1 && houseWarnDays < DEMOLITION_DAYS)) {
    return { success: false, error: `The house warning must be a whole number of days from 1 to ${DEMOLITION_DAYS - 1}.` };
  }
  return withClient(async (client) => {
    await client.query(
      `INSERT INTO fleet_economics_settings (setting_key, setting_value, updated_at)
       VALUES ('low_repair_kit_threshold', $1, now())
       ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now()`,
      [repairKitThreshold]
    );
    await client.query(
      `INSERT INTO fleet_economics_settings (setting_key, setting_value, updated_at)
       VALUES ('low_ceruleum_threshold', $1, now())
       ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now()`,
      [ceruleumThreshold]
    );
    if (houseWarnDays !== undefined) {
      await client.query(
        `INSERT INTO fleet_economics_settings (setting_key, setting_value, updated_at)
         VALUES ('house_warn_days', $1, now())
         ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now()`,
        [houseWarnDays]
      );
    }
    return { success: true };
  }, (err) => {
    return { success: false, error: err.message };
  });
});
