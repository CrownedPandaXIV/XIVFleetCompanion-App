// One-time clean-up for characters removed before app 0.17.2: removing a character now also takes its
// rows out of companion_metric_latest (what Trends charts), but characters removed earlier still count
// in Trends totals. This takes out the rows of every character no longer in the Roster, and of every
// Free Company none of the Roster's characters is in. Their history is kept, and a character the plugin
// syncs again comes back (it writes those rows again). Runs once per database (remembered in
// fleet_economics_settings), when the app starts.

const DONE_KEY = 'trends_removed_cleanup_done';

async function leaveRemovedOutOfTrends(client) {
  const { rows: [t] } = await client.query(`
    SELECT to_regclass('companion_metric_latest') IS NOT NULL AS latest,
           to_regclass('companion_character_current') IS NOT NULL AS current,
           to_regclass('companion_character_housing') IS NOT NULL AS housing,
           to_regclass('fleet_economics_settings') IS NOT NULL AS settings`);
  // The Roster comes from companion_character_current (plugin 0.4.0 and later); without it, nothing.
  if (!t.latest || !t.current || !t.housing || !t.settings) return null;
  const done = await client.query('SELECT 1 FROM fleet_economics_settings WHERE setting_key = $1', [DONE_KEY]);
  if (done.rowCount) return null;

  await client.query('BEGIN');
  try {
    const characters = await client.query(`
      DELETE FROM companion_metric_latest l
      WHERE l.subject_type = 'character'
        AND NOT EXISTS (SELECT 1 FROM companion_character_current c WHERE c.cid = l.subject_id)`);
    const fcs = await client.query(`
      DELETE FROM companion_metric_latest l
      WHERE l.subject_type = 'fc'
        AND NOT EXISTS (SELECT 1 FROM companion_character_current c WHERE c.fc_id = l.subject_id)
        AND NOT EXISTS (SELECT 1 FROM companion_character_housing h WHERE h.fc_id = l.subject_id)`);
    await client.query(
      `INSERT INTO fleet_economics_settings (setting_key, setting_value, updated_at) VALUES ($1, 1, now())
       ON CONFLICT (setting_key) DO NOTHING`, [DONE_KEY]);
    await client.query('COMMIT');
    return { characterRows: characters.rowCount, fcRows: fcs.rowCount };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  }
}

module.exports = { leaveRemovedOutOfTrends, DONE_KEY };
