// Settings → General → "What do you run?" (play-style.js): the saved choice and what the data shows.
const { ipcMain } = require('electron');
const { withClient, snapshotFragments } = require('../db');
const { PLAY_STYLE_KEY, PLAY_STYLES, resolvePlayStyle, playStyleUses, hiddenViews } = require('../shared/play-style');

// { choice, style, counts: { subs, retainers } } for the tracked characters.
async function loadPlayStyle(client) {
  const saved = (await client.query('SELECT setting_value FROM tier3_settings WHERE setting_key = $1', [PLAY_STYLE_KEY])).rows[0];
  const { latestCharacter } = await snapshotFragments(client);
  const counts = (await client.query(`
    SELECT (SELECT count(*) FROM companion_submarine_snapshot s WHERE s.level > 0 AND s.cid IN (SELECT c.cid FROM ${latestCharacter} c))::int AS subs,
           (SELECT count(*) FROM companion_retainer_lookup r WHERE r.job > 0 AND r.owner_cid IN (SELECT c.cid FROM ${latestCharacter} c))::int AS retainers`)).rows[0];
  return { ...resolvePlayStyle(saved ? saved.setting_value : null, counts), counts };
}

ipcMain.handle('get-play-style', () => withClient(async (client) => {
  const p = await loadPlayStyle(client);
  return { success: true, ...p, uses: playStyleUses(p.style), hidden: hiddenViews(p.style) };
}, (err) => ({ success: false, error: err.message, choice: 'auto', style: 'both', uses: playStyleUses('both'), hidden: [] })));

ipcMain.handle('save-play-style', async (event, choice) => {
  if (!PLAY_STYLES.includes(choice)) return { success: false, error: 'Unknown choice.' };
  return withClient(async (client) => {
    await client.query(
      `INSERT INTO tier3_settings (setting_key, setting_value, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now()`, [PLAY_STYLE_KEY, choice]);
    return { success: true };
  }, (err) => ({ success: false, error: err.message }));
});

module.exports = { loadPlayStyle };
