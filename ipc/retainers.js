// Retainers: gear status against each retainer's target, gear suggestions, saving targets.
const { ipcMain } = require('electron');
const { createPgClient, loadPostgresConfig, withClient, snapshotFragments } = require('../db');
const { notSyncedCharacters, readBehindMinutes } = require('../characters/not-synced');
const { retainerSummary } = require('../characters/retainer-summary');

// Equipped-gear slot display order for the Retainers view's ilvl hover
// breakdown, and the equip_slot_category -> slot label mapping. Real codes
// confirmed against xivapi/ffxiv-datamining EquipSlotCategory.csv and a
// live query of a fully-geared retainer (retainer_id 337770972436603xx,
// Diadochos healer set) - all 11 rows matched expected codes, no Soul
// Crystal (17) present, confirming retainers have no dedicated crystal
// slot. Ring1/Ring2 share the same real game code (12) - the game itself
// doesn't distinguish them, so the two occurrences are labeled by the
// order they're returned in, not by any real per-ring identity.
const EQUIP_SLOT_DISPLAY_ORDER = [
  'Weapon', 'Off-hand', 'Head', 'Chest', 'Gloves', 'Legs', 'Feet',
  'Earrings', 'Necklace', 'Bracelet', 'Ring 1', 'Ring 2',
];
const EQUIP_SLOT_CATEGORY_TO_LABEL = {
  1: 'Weapon', 13: 'Weapon', 14: 'Weapon',
  2: 'Off-hand',
  3: 'Head',
  4: 'Chest', 15: 'Chest', 19: 'Chest', 20: 'Chest', 21: 'Chest', 22: 'Chest', 23: 'Chest',
  5: 'Gloves',
  7: 'Legs', 18: 'Legs',
  8: 'Feet',
  9: 'Earrings',
  10: 'Necklace',
  11: 'Bracelet',
  12: 'Ring',
};

// Gear status vs. a retainer's saved target. Job eligibility is checked
// directly against ffxiv_classjobcategory's real per-job boolean columns
// (e.g. gearRow.cnj === 'True') - NOT by parsing the category's free-text
// Name field, which is inconsistent (e.g. category 1 is literally "All
// Classes", not a space-separated job list, so substring matching would
// silently fail for universally-equippable items). Confirmed via real
// \d ffxiv_classjobcategory output and real ClassJobCategory.csv data.
// Level mode compares against level_equip (character level requirement);
// ilvl mode compares against level_item. No target set -> no status.
function computeGearStatus(jobAbbreviation, targetMode, targetValue, gearRow) {
  if (!targetMode || targetValue == null) return null;
  const jobCol = jobAbbreviation ? jobAbbreviation.toLowerCase() : null;
  if (!jobCol || gearRow[jobCol] === undefined) return null;
  if (gearRow[jobCol] !== 'True') return 'Wrong Job';
  const value = targetMode === 'level'
    ? (gearRow.level_equip != null ? parseInt(gearRow.level_equip, 10) : null)
    : (gearRow.level_item != null ? parseInt(gearRow.level_item, 10) : null);
  if (value == null || !Number.isFinite(value)) return null;
  return value === targetValue ? 'OK' : 'Mismatch';
}

// Retainer gear targets - lists every retainer (from companion_retainer_lookup,
// left joined against each owner's current character row for name/world), with
// any existing target row from retainer_gear_targets attached, plus average
// current-gear ilvl and a per-slot breakdown for the hover tooltip. No row in
// retainer_gear_targets means "no target set yet" - the UI just shows blank
// fields, not an error. Only Crafted? is display/suggestion-only, doesn't
// affect pass/fail (per Panda: it filters suggested alternatives to crafted-only,
// gear can still be bought/crafted/traded and pass regardless). Average ilvl
// includes every non-empty equipped slot as-is - job-agnostic by design (a
// Paladin's off-hand and a White Mage's lack of one both just naturally fall
// out of "whatever's actually equipped"), and Soul Crystal never appears in
// this container for retainers (confirmed against real data), so no filtering
// needed there either. items_seen says whether AllaganTools has seen the retainer's items (they are
// stored, or plugin 0.9.1 recorded it seen with nothing in it): it only knows them once the retainer
// has been opened at a summoning bell on a PC running the plugin.
// The Summary's Retainers section (retainer-summary.js): retainers with a class of the tracked
// characters, leaving out characters the plugin no longer syncs.
ipcMain.handle('get-retainer-summary', () => withClient(async (client) => {
  const { latestCharacter } = await snapshotFragments(client);
  const { rows } = await client.query(`
    SELECT rl.owner_cid::text AS owner_cid, c.name AS owner_name, c.world, c.account_label, c.snapshot_at AS last_synced_at, so.sort_index,
           rl.name AS retainer_name, rl.job, cj.abbreviation AS job_abbreviation, rl.has_venture, rl.venture_ends_at
    FROM companion_retainer_lookup rl
    JOIN ${latestCharacter} c ON c.cid = rl.owner_cid
    LEFT JOIN character_sort_order so ON so.cid = rl.owner_cid
    LEFT JOIN ffxiv_classjob cj ON cj.id = rl.job::text
    WHERE rl.job > 0`);
  const behind = notSyncedCharacters(rows.map((r) => ({ cid: r.owner_cid, account_label: r.account_label, last_synced_at: r.last_synced_at })),
    await readBehindMinutes(client));
  return { success: true, ...retainerSummary(rows.filter((r) => !behind.has(String(r.owner_cid)))) };
}, (err) => ({ success: false, error: err.message })));

ipcMain.handle('get-retainer-targets', async () => {
  return withClient(async (client) => {
    const { latestCharacter } = await snapshotFragments(client);
    // items_seen_at (database version 7): when AllaganTools last saw the retainer's items, even when it
    // holds nothing. Without the column, a retainer counts as seen when it has items stored.
    const { rows: [seenColumn] } = await client.query(`
      SELECT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = current_schema() AND table_name = 'companion_retainer_lookup'
                       AND column_name = 'items_seen_at') AS present`);
    const seenAt = seenColumn.present ? 'rl.items_seen_at IS NOT NULL OR ' : '';
    const rosterResult = await client.query(`
      SELECT rl.retainer_id, rl.owner_cid, rl.name AS retainer_name,
             c.name AS owner_name, c.world, c.account_label, so.sort_index,
             t.target_mode, t.target_value, t.only_crafted, t.updated_at,
             rl.job, cj.abbreviation AS job_abbreviation, rl.gil, rl.level,
             rl.has_venture, rl.venture_id, rl.venture_ends_at, rl.hire_order_index,
             COALESCE(vr.name, vi.name) AS venture_type,
             (${seenAt}EXISTS (SELECT 1 FROM companion_inventory_snapshot inv
                     WHERE inv.owner_cid = rl.owner_cid AND inv.retainer_id = rl.retainer_id)) AS items_seen
      FROM companion_retainer_lookup rl
      LEFT JOIN ${latestCharacter} c ON c.cid = rl.owner_cid
      LEFT JOIN retainer_gear_targets t ON t.retainer_id = rl.retainer_id
      LEFT JOIN character_sort_order so ON so.cid = rl.owner_cid
      LEFT JOIN ffxiv_classjob cj ON cj.id = rl.job::text
      LEFT JOIN ffxiv_retainertask vt ON vt.id = rl.venture_id::text
      LEFT JOIN ffxiv_retainertaskrandom vr ON vt.is_random = 'True' AND vr.id = vt.task
      LEFT JOIN ffxiv_retainertasknormal vn ON vt.is_random = 'False' AND vn.id = vt.task
      LEFT JOIN ffxiv_item vi ON vi.id = vn.item
      ORDER BY so.sort_index NULLS LAST, c.name, rl.hire_order_index NULLS LAST
    `);

    const gearResult = await client.query(`
      SELECT inv.retainer_id, inv.item_id, i.name AS item_name,
             i.level_item, i.level_equip, i.equip_slot_category, cjc.*
      FROM companion_inventory_snapshot inv
      LEFT JOIN ffxiv_item i ON i.id::text = inv.item_id::text
      LEFT JOIN ffxiv_classjobcategory cjc ON cjc.id = i.class_job_category
      WHERE inv.sorted_container = 11000
    `);

    const gearByRetainer = new Map();
    for (const row of gearResult.rows) {
      const rid = row.retainer_id;
      if (!gearByRetainer.has(rid)) gearByRetainer.set(rid, []);
      gearByRetainer.get(rid).push(row);
    }

    const rows = rosterResult.rows.map((retainer) => {
      const gear = gearByRetainer.get(retainer.retainer_id) || [];
      let ilvlSum = 0;
      let ilvlCount = 0;
      let ringSeen = 0;

      const slots = gear.map((g) => {
        const levelItem = g.level_item != null ? parseInt(g.level_item, 10) : null;
        if (Number.isFinite(levelItem)) {
          ilvlSum += levelItem;
          ilvlCount += 1;
        }

        const category = g.equip_slot_category != null ? parseInt(g.equip_slot_category, 10) : null;
        let label = EQUIP_SLOT_CATEGORY_TO_LABEL[category] || 'Other';
        if (label === 'Ring') {
          ringSeen += 1;
          label = ringSeen === 1 ? 'Ring 1' : 'Ring 2';
        }

        const status = computeGearStatus(retainer.job_abbreviation, retainer.target_mode, retainer.target_value, g);
        return { label, itemName: g.item_name || `Item ${g.item_id}`, levelItem, status };
      });

      // If a target is set, show every canonical slot even if nothing's
      // equipped there - an empty slot can't be hitting the target, so
      // it needs to be visible as a real gap, not silently absent.
      if (retainer.target_mode) {
        const present = new Set(slots.map((s) => s.label));
        for (const label of EQUIP_SLOT_DISPLAY_ORDER) {
          if (!present.has(label)) {
            slots.push({ label, itemName: null, levelItem: null, status: 'Empty' });
          }
        }
      }

      slots.sort((a, b) => {
        const rank = (l) => {
          const idx = EQUIP_SLOT_DISPLAY_ORDER.indexOf(l);
          return idx === -1 ? EQUIP_SLOT_DISPLAY_ORDER.length : idx;
        };
        return rank(a.label) - rank(b.label);
      });

      return {
        ...retainer,
        avg_ilvl: ilvlCount > 0 ? ilvlSum / ilvlCount : null,
        gear_slots: slots,
      };
    });

    return { success: true, rows };
  }, (err) => {
    return { success: false, error: err.message };
  });
});

// Reverse of EQUIP_SLOT_CATEGORY_TO_LABEL - which real equip_slot_category
// codes belong to a given display slot. Ring 1 and Ring 2 both map to the
// same real code (12) since the game itself has no separate "left ring"
// vs "right ring" item category - any real ring fits either display slot.
const SLOT_LABEL_TO_EQUIP_SLOT_CATEGORIES = {
  Weapon: [1, 13, 14],
  'Off-hand': [2],
  Head: [3],
  Chest: [4, 15, 19, 20, 21, 22, 23],
  Gloves: [5],
  Legs: [7, 18],
  Feet: [8],
  Earrings: [9],
  Necklace: [10],
  Bracelet: [11],
  'Ring 1': [12],
  'Ring 2': [12],
};

// Ranked gear suggestions for one slot: job-eligible (via
// ffxiv_classjobcategory's real per-job column, same check as
// computeGearStatus), at or below the target value, descending, capped at
// 10. Only Crafted? filters to items that appear as some recipe's real
// output (ffxiv_recipe.item_result) - confirmed against real data
// (Bronze Hatchet positive test, Diadochos positive test - both are
// genuinely craftable, contrary to an earlier wrong assumption that raid
// gear couldn't be). This is the suggestion list ONLY - status itself
// (OK/Mismatch/Wrong Job/Empty) stays an exact match, computed separately.
ipcMain.handle('get-gear-suggestions', async (event, { jobAbbreviation, targetMode, targetValue, onlyCrafted, slotLabel }) => {
  const config = loadPostgresConfig();
  const client = createPgClient(config);
  try {
    const categories = SLOT_LABEL_TO_EQUIP_SLOT_CATEGORIES[slotLabel];
    const jobCol = jobAbbreviation ? jobAbbreviation.toLowerCase() : null;

    // Column names can't be parameterized - jobCol/valueColumn are never
    // taken from arbitrary user input, but validate defensively anyway
    // before interpolating into SQL.
    if (!categories || !jobCol || !/^[a-z]{3}$/.test(jobCol) || !targetMode || targetValue == null) {
      return { success: true, rows: [] };
    }
    const valueColumn = targetMode === 'level' ? 'level_equip' : 'level_item';
    const secondaryColumn = targetMode === 'level' ? 'level_item' : 'level_equip';

    await client.connect();

    const craftedClause = onlyCrafted
      ? 'AND EXISTS (SELECT 1 FROM ffxiv_recipe r WHERE r.item_result = i.id)'
      : '';

    // Ties on the primary target column (e.g. multiple items all at
    // character level 90) have no guaranteed order from Postgres unless a
    // secondary sort is given - real finding from live testing (an ilvl
    // 560 item was landing above an ilvl 645 item, both level_equip=90,
    // purely due to unordered ties). Secondary sort by the OTHER value,
    // descending, so ties resolve to "best gear at that level" first.
    // Defaults to 0 (sorts last) if the secondary column isn't numeric,
    // same defensive pattern as the primary filter.
    const result = await client.query(
      `SELECT i.id, i.name,
              CASE WHEN i.level_equip ~ '^[0-9]+$' THEN i.level_equip::int ELSE NULL END AS level_equip,
              CASE WHEN i.level_item ~ '^[0-9]+$' THEN i.level_item::int ELSE NULL END AS level_item
       FROM ffxiv_item i
       LEFT JOIN ffxiv_classjobcategory cjc ON cjc.id = i.class_job_category
       WHERE i.equip_slot_category::int = ANY($1::int[])
         AND cjc.${jobCol} = 'True'
         AND i.${valueColumn} ~ '^[0-9]+$'
         AND i.${valueColumn}::int <= $2
         ${craftedClause}
       ORDER BY i.${valueColumn}::int DESC,
                CASE WHEN i.${secondaryColumn} ~ '^[0-9]+$' THEN i.${secondaryColumn}::int ELSE 0 END DESC
       LIMIT 10`,
      [categories, targetValue]
    );

    return { success: true, rows: result.rows };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    await client.end();
  }
});

// What a retainer gear target may be: a level or ilvl target with a whole number from 1 to 999, or no
// target at all. Returns a plain message when it is not.
function checkRetainerTarget({ retainerId, targetMode, targetValue }) {
  if (!/^[0-9]{1,25}$/.test(String(retainerId))) return 'Invalid retainer.';
  if (targetMode !== null && targetMode !== 'level' && targetMode !== 'ilvl') return 'The target mode must be Level or ilvl.';
  if (targetValue !== null && !(Number.isInteger(targetValue) && targetValue >= 1 && targetValue <= 999)) {
    return 'The target value must be a whole number from 1 to 999.';
  }
  if (targetMode && targetValue === null) return 'Enter a target value.';
  return null;
}

ipcMain.handle('save-retainer-target', async (event, { retainerId, targetMode, targetValue, onlyCrafted }) => {
  const problem = checkRetainerTarget({ retainerId, targetMode, targetValue });
  if (problem) return { success: false, error: problem };
  return withClient(async (client) => {
    await client.query(
      `INSERT INTO retainer_gear_targets (retainer_id, target_mode, target_value, only_crafted, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (retainer_id) DO UPDATE
         SET target_mode = $2, target_value = $3, only_crafted = $4, updated_at = now()`,
      [retainerId, targetMode, targetValue, !!onlyCrafted]
    );
    return { success: true };
  }, (err) => {
    return { success: false, error: err.message };
  });
});

ipcMain.handle('delete-retainer-target', async (event, retainerId) => {
  if (!/^[0-9]{1,25}$/.test(String(retainerId))) return { success: false, error: 'Invalid retainer.' };
  return withClient(async (client) => {
    await client.query(`DELETE FROM retainer_gear_targets WHERE retainer_id = $1`, [retainerId]);
    return { success: true };
  }, (err) => {
    return { success: false, error: err.message };
  });
});
