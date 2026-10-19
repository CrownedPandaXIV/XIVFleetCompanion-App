// Settings → General → Live Market Prices: whether to ask Universalis for prices (universalis.js), and the
// one shared connection (its answers are kept for 30 minutes).
const { ipcMain } = require('electron');
const { withClient } = require('../db');
const { SETTING_KEY, createUniversalis } = require('../characters/universalis');

const universalis = createUniversalis();

async function universalisEnabled(client) {
  const { rows } = await client.query('SELECT setting_value FROM tier3_settings WHERE setting_key = $1', [SETTING_KEY]);
  return rows.length > 0 && rows[0].setting_value === 'true';
}

// The shared connection when live prices are on, otherwise null.
async function liveUniversalis(client) {
  return (await universalisEnabled(client)) ? universalis : null;
}

ipcMain.handle('get-universalis-setting', () => withClient(async (client) => ({ success: true, enabled: await universalisEnabled(client) }),
  (err) => ({ success: false, error: err.message, enabled: false })));

ipcMain.handle('save-universalis-setting', (event, enabled) => withClient(async (client) => {
  await client.query(
    `INSERT INTO tier3_settings (setting_key, setting_value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now()`, [SETTING_KEY, enabled ? 'true' : 'false']);
  return { success: true };
}, (err) => ({ success: false, error: err.message })));

module.exports = { liveUniversalis, universalisEnabled };
