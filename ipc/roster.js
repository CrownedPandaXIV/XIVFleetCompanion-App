// Roster: the character list, when the plugin last wrote data, and drag-to-reorder.
const { ipcMain } = require('electron');
const { notSyncedCharacters, readBehindMinutes } = require('../characters/not-synced');
const { withClient, snapshotFragments } = require('../db');

// Handles a single request from the renderer to fetch the character roster.
// Opens a fresh connection per call - fine for a low-frequency dashboard read,
// not optimized for high-frequency polling yet.
ipcMain.handle('get-roster', async () => {
  return withClient(async (client) => {
    const { latestCharacter } = await snapshotFragments(client);

    // Same thresholds and fully-unbuilt suppression logic as get-fleet-warnings,
    // so Roster's Ceruleum/Repair Kits coloring always agrees with Summary's.
    const thresholdResult = await client.query(
      `SELECT setting_key, setting_value FROM fleet_economics_settings
       WHERE setting_key IN ('low_repair_kit_threshold', 'low_ceruleum_threshold')`
    );
    const byKey = {};
    for (const row of thresholdResult.rows) byKey[row.setting_key] = Number(row.setting_value);
    const repairKitThreshold = byKey.low_repair_kit_threshold ?? 0;
    const ceruleumThreshold = byKey.low_ceruleum_threshold ?? 0;

    // One row per character (latestCharacter, see db/index.js), joined to its Free Company and house, the
    // city names, its place in the roster order and how many of its subs are built.
    const result = await client.query(`
      SELECT
        s.cid, s.name, s.world, s.gil, s.retainer_count, s.submarine_count,
        s.account_label, s.snapshot_at, s.repair_kits, s.ceruleum,
        h.fc_name, h.fc_points, h.has_house, h.house_ward, h.house_plot,
        k.city_name AS district_name,
        so.sort_index,
        (SELECT COUNT(*) FROM companion_submarine_snapshot sub WHERE sub.cid = s.cid AND sub.level > 0) AS subs_built
      FROM ${latestCharacter} s
      LEFT JOIN companion_character_housing h ON s.cid = h.cid
      LEFT JOIN housing_key_city_lookup k ON h.house_city = k.city_id
      LEFT JOIN character_sort_order so ON s.cid = so.cid
      ORDER BY s.cid
    `);

    // Fully-unbuilt characters never get flagged low on fuel/repair kits -
    // a fresh account's default-zero values aren't a real problem, matching
    // the exact same suppression get-fleet-warnings already applies.
    // Characters the plugin no longer syncs (behind the rest of their account), marked on the Roster.
    const behind = notSyncedCharacters(result.rows.map((r) => ({ ...r, last_synced_at: r.snapshot_at })), await readBehindMinutes(client));
    const rows = result.rows.map((r) => {
      const subsBuilt = Number(r.subs_built) > 0;
      return {
        ...r,
        not_synced_ms: behind.get(String(r.cid)) ?? null,
        low_repair: subsBuilt && !behind.has(String(r.cid)) && r.repair_kits < repairKitThreshold,
        low_ceruleum: subsBuilt && !behind.has(String(r.cid)) && r.ceruleum < ceruleumThreshold
      };
    });

    return { success: true, rows };
  }, (err) => {
    return { success: false, error: err.message };
  });
});

// When the plugin last wrote data: the newest snapshot per account label, for the
// header's "Plugin data" note. The plugin only writes while the game is running, so
// old data is normal when nobody is playing; the header just says how old it is.
ipcMain.handle('get-data-freshness', async () => {
  return withClient(async (client) => {
    const { latestCharacter } = await snapshotFragments(client);
    const result = await client.query(`
      SELECT c.account_label, max(c.snapshot_at) AS newest, count(*)::int AS characters
      FROM ${latestCharacter} c
      GROUP BY c.account_label
      ORDER BY c.account_label NULLS LAST
    `);
    return {
      success: true,
      accounts: result.rows.map((r) => ({
        accountLabel: r.account_label,
        newest: r.newest ? new Date(r.newest).toISOString() : null,
        characters: r.characters
      }))
    };
  }, (err) => {
    return { success: false, error: err.message };
  });
});

// Writes a full new ordering for a set of characters — called after a drag
// reorder completes. Upserts one row per cid with its new position.
ipcMain.handle('update-sort-order', async (event, orderedCids) => {
  if (!Array.isArray(orderedCids)) {
    return { success: false, error: 'Invalid request.' };
  }
  return withClient(async (client) => {
    await client.query('BEGIN');

    for (let i = 0; i < orderedCids.length; i++) {
      await client.query(
        `INSERT INTO character_sort_order (cid, sort_index, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (cid) DO UPDATE SET sort_index = EXCLUDED.sort_index, updated_at = now()`,
        [orderedCids[i], i]
      );
    }

    await client.query('COMMIT');
    return { success: true };
  }, async (err, client) => {
    await client.query('ROLLBACK');
    return { success: false, error: err.message };
  });
});

// Removes one character and what is stored for it: its current row, subs and their Craft? settings,
// bags and retainers (and the retainers' gear targets), Free Company and house details, its place in
// the roster order, and build rules made only for it. Its Free Company's chest goes too when no other
// character is in that Free Company. Chart history is kept but left out of Trends: its rows in
// companion_metric_latest (which Trends uses to find what to chart) are removed, so they no longer
// add to fleet totals, and the plugin writes them again if it syncs the character again, bringing
// the history back. The same goes for the Free Company when its chest goes. All in one transaction:
// on any error nothing is removed. If the plugin still syncs the character, the character comes back
// at the next sync.
ipcMain.handle('remove-character', async (event, cid) => {
  if (typeof cid !== 'string' || !/^[0-9]+$/.test(cid)) {
    return { success: false, error: 'Invalid request.' };
  }
  return withClient(async (client) => {
    const { latestCharacter } = await snapshotFragments(client);
    const { rows: [tables] } = await client.query(`
      SELECT to_regclass('companion_character_current') IS NOT NULL AS has_current,
             to_regclass('companion_character_snapshot') IS NOT NULL AS has_history,
             to_regclass('companion_metric_latest') IS NOT NULL AS has_latest`);
    const fcResult = await client.query(`
      SELECT fc_id FROM ${latestCharacter} c WHERE c.cid = $1 AND c.fc_id IS NOT NULL
      UNION
      SELECT fc_id FROM companion_character_housing WHERE cid = $1 AND fc_id IS NOT NULL`, [cid]);
    const fcIds = fcResult.rows.map((r) => r.fc_id);

    await client.query('BEGIN');
    try {
      await client.query(
        `DELETE FROM retainer_gear_targets
         WHERE retainer_id IN (SELECT retainer_id FROM companion_retainer_lookup WHERE owner_cid = $1)`, [cid]);
      for (const sql of [
        'DELETE FROM companion_retainer_lookup WHERE owner_cid = $1',
        'DELETE FROM companion_inventory_snapshot WHERE owner_cid = $1',
        'DELETE FROM companion_submarine_snapshot WHERE cid = $1',
        'DELETE FROM sub_craft_toggle WHERE cid = $1',
        'DELETE FROM sub_build_rules WHERE cid_override = $1',
        'DELETE FROM companion_character_housing WHERE cid = $1',
        'DELETE FROM character_sort_order WHERE cid = $1',
      ]) {
        await client.query(sql, [cid]);
      }
      if (tables.has_current) await client.query('DELETE FROM companion_character_current WHERE cid = $1', [cid]);
      if (tables.has_history) await client.query('DELETE FROM companion_character_snapshot WHERE cid = $1', [cid]);
      if (tables.has_latest) {
        await client.query(`DELETE FROM companion_metric_latest WHERE subject_type = 'character' AND subject_id = $1`, [cid]);
      }
      if (fcIds.length) {
        // Free Companies no other character is in (the character's own rows are already gone).
        const { rows: orphans } = await client.query(`
          SELECT o.id FROM unnest($1::numeric[]) AS o(id)
          WHERE NOT EXISTS (SELECT 1 FROM ${latestCharacter} c WHERE c.fc_id = o.id)`, [fcIds]);
        const orphanIds = orphans.map((r) => r.id);
        if (orphanIds.length) {
          await client.query('DELETE FROM companion_fc_inventory_snapshot WHERE fc_id = ANY($1::numeric[])', [orphanIds]);
          if (tables.has_latest) {
            await client.query(`DELETE FROM companion_metric_latest WHERE subject_type = 'fc' AND subject_id = ANY($1::numeric[])`, [orphanIds]);
          }
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    }
    return { success: true };
  }, (err) => {
    return { success: false, error: err.message };
  });
});
