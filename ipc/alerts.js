// Discord alerts: their settings (shared by every PC, in fleet_economics_settings), the webhook (this PC
// only), a test message, "check now", "pause" and "quiet for N hours", and the scheduled task on this PC.
const { app, ipcMain } = require('electron');
const { withClient } = require('../db');
const { ALERT_SETTING_KEYS, LAST_CHECK_KEY, readAlertSettings, validateAlertSettings, alertMode } = require('../alerts/settings');
const { loadWebhook, saveWebhook, clearWebhook } = require('../alerts/discord');
const { runAlertCheck, sendTestMessage, sendSummaryNow } = require('../alerts/run');
const schedule = require('../alerts/schedule');

const UPSERT = `INSERT INTO fleet_economics_settings (setting_key, setting_value, updated_at)
  VALUES ($1, $2, now())
  ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now()`;

async function readSettings(client) {
  const result = await client.query(
    'SELECT setting_key, setting_value FROM fleet_economics_settings WHERE setting_key = ANY($1)',
    [[...Object.values(ALERT_SETTING_KEYS), LAST_CHECK_KEY]]);
  return readAlertSettings(result.rows);
}

// The app's folder for the scheduled task when run from source; the installed app starts its own .exe.
const scheduleAppDir = () => (app.isPackaged ? null : app.getAppPath());

ipcMain.handle('alerts:get-settings', async () => {
  const thisPc = { webhookSaved: !!loadWebhook(), schedule: await schedule.scheduleStatus(schedule.taskCommand(process.execPath, scheduleAppDir())) };
  return withClient(async (client) => {
    const settings = await readSettings(client);
    return { success: true, settings, now: alertMode(settings), ...thisPc };
  }, (err) => ({ success: false, error: err.message, ...thisPc }));
});

ipcMain.handle('alerts:save-settings', async (event, input) => {
  const checked = validateAlertSettings(input);
  if (!checked.ok) return { success: false, error: checked.error };
  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      for (const [key, value] of checked.rows) await client.query(UPSERT, [key, value]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    }
    return { success: true };
  }, (err) => ({ success: false, error: err.message }));
});

// From now for `hours` (0 ends it): 'pause' posts nothing (held alerts go out when it ends), 'quiet'
// posts without the @mention.
async function setUntil(key, hours) {
  const h = Number(hours);
  if (!Number.isFinite(h) || h < 0 || h > 72) return { success: false, error: 'Choose between 1 and 72 hours.' };
  const until = h === 0 ? 0 : Math.floor(Date.now() / 1000 + h * 3600);
  return withClient(async (client) => {
    await client.query(UPSERT, [key, until]);
    return { success: true, until };
  }, (err) => ({ success: false, error: err.message }));
}
ipcMain.handle('alerts:quiet-for', (event, hours) => setUntil(ALERT_SETTING_KEYS.quietUntil, hours));
ipcMain.handle('alerts:pause-for', (event, hours) => setUntil(ALERT_SETTING_KEYS.pausedUntil, hours));

ipcMain.handle('alerts:save-webhook', async (event, url) => {
  const result = saveWebhook(url);
  return result.ok ? { success: true } : { success: false, error: result.error };
});

ipcMain.handle('alerts:clear-webhook', async () => {
  await schedule.removeSchedule();
  clearWebhook();
  return { success: true };
});

ipcMain.handle('alerts:send-test', async (event, mentionUserId) => {
  const id = String(mentionUserId || '').trim();
  const result = await sendTestMessage(/^\d{17,20}$/.test(id) ? id : null);
  return result.ok ? { success: true } : { success: false, error: result.error };
});

ipcMain.handle('alerts:send-summary', async () => {
  const result = await sendSummaryNow();
  return result.ok ? { success: true } : { success: false, error: result.error };
});

ipcMain.handle('alerts:check-now', async () => {
  const result = await runAlertCheck();
  return result.ok ? { success: true, ...result } : { success: false, error: result.note || result.error };
});

ipcMain.handle('alerts:install-schedule', async () => {
  if (!loadWebhook()) return { success: false, error: 'Save the Discord webhook on this PC first.' };
  const result = await schedule.installSchedule(process.execPath, scheduleAppDir());
  return result.ok ? { success: true } : { success: false, error: result.error };
});

ipcMain.handle('alerts:remove-schedule', async () => {
  const result = await schedule.removeSchedule();
  return result.ok ? { success: true } : { success: false, error: result.error };
});
