// Removing a character from the Roster (the × beside the drag handle): nothing happens until "Yes, remove" is clicked; then the
// character and what is stored for it are gone, its Free Company's chest goes (no one else is in that
// Free Company), and everything else stays: other characters, other chests, and its chart history.
// The history is left out of Trends: its rows (and its Free Company's) leave companion_metric_latest,
// so the Trends catalog no longer counts them.
const { Client } = require('pg');

const CID = '18014498578000999';
const FC = '9000999';
const RETAINER = '18014498578999001';

// Rows stored for the test character, per table (chart history is counted separately: it is kept).
const COUNTS = `
  SELECT (SELECT count(*) FROM companion_character_current WHERE cid = ${CID})
       + (SELECT count(*) FROM companion_character_snapshot WHERE cid = ${CID}) AS character_rows,
         (SELECT count(*) FROM companion_submarine_snapshot WHERE cid = ${CID}) AS subs,
         (SELECT count(*) FROM sub_craft_toggle WHERE cid = ${CID}) AS craft,
         (SELECT count(*) FROM sub_build_rules WHERE cid_override = ${CID}) AS rules,
         (SELECT count(*) FROM companion_retainer_lookup WHERE owner_cid = ${CID}) AS retainers,
         (SELECT count(*) FROM retainer_gear_targets WHERE retainer_id = ${RETAINER}) AS gear_targets,
         (SELECT count(*) FROM companion_inventory_snapshot WHERE owner_cid = ${CID}) AS inventory,
         (SELECT count(*) FROM companion_character_housing WHERE cid = ${CID}) AS housing,
         (SELECT count(*) FROM character_sort_order WHERE cid = ${CID}) AS sort_order,
         (SELECT count(*) FROM companion_rankup_forecast WHERE cid = ${CID}) AS forecasts,
         (SELECT count(*) FROM companion_fc_inventory_snapshot WHERE fc_id = ${FC}) AS own_chest,
         (SELECT count(*) FROM companion_fc_inventory_snapshot WHERE fc_id <> ${FC}) AS other_chests,
         (SELECT count(*) FROM companion_character_current WHERE cid <> ${CID}) AS other_characters,
         (SELECT count(*) FROM companion_metric_history WHERE subject_type = 'character' AND subject_id = ${CID}) AS history,
         (SELECT count(*) FROM companion_metric_history WHERE subject_type = 'fc' AND subject_id = ${FC}) AS fc_history,
         (SELECT count(*) FROM companion_metric_latest WHERE subject_type = 'character' AND subject_id = ${CID}) AS latest,
         (SELECT count(*) FROM companion_metric_latest WHERE subject_type = 'fc' AND subject_id = ${FC}) AS fc_latest,
         (SELECT count(*) FROM companion_metric_latest WHERE NOT (subject_type = 'character' AND subject_id = ${CID})
                                                         AND NOT (subject_type = 'fc' AND subject_id = ${FC})) AS other_latest`;

async function query(sql) {
  const db = new Client();
  await db.connect();
  try { return (await db.query(sql)).rows; } finally { await db.end(); }
}

async function clear(db) {
  await db.query(`DELETE FROM retainer_gear_targets WHERE retainer_id = ${RETAINER}`);
  for (const [table, column] of [
    ['companion_character_current', 'cid'], ['companion_character_snapshot', 'cid'], ['companion_submarine_snapshot', 'cid'],
    ['sub_craft_toggle', 'cid'], ['sub_build_rules', 'cid_override'], ['companion_retainer_lookup', 'owner_cid'],
    ['companion_inventory_snapshot', 'owner_cid'], ['companion_character_housing', 'cid'], ['character_sort_order', 'cid'],
    ['companion_rankup_forecast', 'cid'],
  ]) {
    await db.query(`DELETE FROM ${table} WHERE ${column} = ${CID}`);
  }
  await db.query(`DELETE FROM companion_fc_inventory_snapshot WHERE fc_id = ${FC}`);
  await db.query(`DELETE FROM companion_metric_history WHERE (subject_type = 'character' AND subject_id = ${CID}) OR (subject_type = 'fc' AND subject_id = ${FC})`);
  await db.query(`DELETE FROM companion_metric_latest WHERE (subject_type = 'character' AND subject_id = ${CID}) OR (subject_type = 'fc' AND subject_id = ${FC})`);
}

module.exports = async (t) => {
  const { ev, waitFor, check, nav, sleep } = t;
  const row = `document.querySelector('tr[data-cid="${CID}"]')`;
  const dialog = `document.querySelector('.modal.remove-confirm')`;
  const clickInDialog = (text) => ev(`(() => { const b = [...${dialog}.querySelectorAll('button')].find(x => x.innerText.trim() === ${JSON.stringify(text)}); if (!b) throw new Error('no ' + ${JSON.stringify(text)}); b.click(); return true; })()`);
  const openConfirm = () => ev(`${row}.querySelector('td.row-tools button.remove-character').click()`);

  const gilSubjects = async () => {
    const r = await ev(`window.api.getMetricCatalog()`);
    return r.rows.find((x) => x.metric === 'gil' && x.subjectType === 'character').subjects;
  };
  const before = (await query(COUNTS))[0];
  const gilBefore = await gilSubjects();
  check(Object.entries(before).every(([, n]) => Number(n) > 0), 'the test character has data in every table: ' + JSON.stringify(before));

  await nav('Character Roster');
  await waitFor(`!!${row}`, 'the test character in the Roster', 20000);
  check(await ev(`${row}.innerText.includes('Remy Removeme')`), 'the Roster lists the test character');

  // The × sits at the start of the row, beside the drag handle, so it stays on screen however wide the table is.
  check(await ev(`${row}.children[0].classList.contains('row-tools') && !!${row}.children[0].querySelector('.drag-handle') && !!${row}.children[0].querySelector('button.remove-character')`),
    'the Remove × is in the first cell, beside the drag handle');
  check(await ev(`(() => { const r = ${row}.querySelector('button.remove-character').getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth; })()`),
    'the Remove × is inside the window');

  await ev(`${row}.scrollIntoView({ block: 'center' })`);
  await t.shot('remove-button');
  await openConfirm();
  await waitFor(`!!${dialog}`, 'the confirmation');
  await t.shot('remove-confirm');
  check(await ev(`${dialog}.innerText.includes('Remy Removeme') && ${dialog}.innerText.includes('chart history is kept but left out of Trends') && ${dialog}.innerText.includes("plugin's Characters list")`), 'the confirmation names the character and says what is removed and what is kept');
  await clickInDialog('No');
  await sleep(300);
  check(await ev(`!!${row} && !${dialog}`), '"No" closes it and leaves the character as it was');
  await openConfirm();
  await waitFor(`!!${dialog}`, 'the confirmation');
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  await sleep(300);
  check(await ev(`!${dialog}`), 'Escape closes it too');
  check(Number((await query(COUNTS))[0].character_rows) > 0, 'nothing was removed before "Yes, remove"');

  await openConfirm();
  await waitFor(`!!${dialog}`, 'the confirmation');
  await clickInDialog('Yes, remove');
  await waitFor(`!${row}`, 'the character to leave the Roster', 20000);
  check(await ev(`document.body.innerText.includes('Removed Remy Removeme.') && !${dialog}`), 'the Roster says the character was removed');

  const after = (await query(COUNTS))[0];
  const gone = ['character_rows', 'subs', 'craft', 'rules', 'retainers', 'gear_targets', 'inventory', 'housing', 'sort_order', 'forecasts', 'own_chest'];
  check(gone.every((k) => Number(after[k]) === 0), 'its rows are removed everywhere, its Free Company chest too: ' + JSON.stringify(after));
  check(after.other_chests === before.other_chests && after.other_characters === before.other_characters,
    'other characters and other Free Company chests are untouched');
  check(Number(after.history) === Number(before.history) && Number(after.fc_history) === Number(before.fc_history),
    'its chart history is kept, and its Free Company\'s');
  check(Number(after.latest) === 0 && Number(after.fc_latest) === 0 && after.other_latest === before.other_latest,
    'it and its Free Company leave Trends; nothing else does: ' + JSON.stringify(after));
  check(await gilSubjects() === gilBefore - 1, 'the Trends gil chart counts one character fewer');
};

// A character with something in every table the removal covers, in its own Free Company.
module.exports.before = async (db) => {
  await clear(db);
  await db.query(`INSERT INTO companion_character_current (cid, name, world, account_label, gil, ceruleum, repair_kits, retainer_count, submarine_count, num_sub_slots, fc_id, last_synced_at)
                  VALUES (${CID}, 'Remy Removeme', 'Maduin', 'acct1', 5, 5, 5, 1, 1, 4, ${FC}, now())`);
  await db.query(`INSERT INTO companion_character_snapshot (cid, name, world, account_label, retainer_count, submarine_count, gil, ceruleum, repair_kits, fc_id, num_sub_slots, snapshot_at)
                  VALUES (${CID}, 'Remy Removeme', 'Maduin', 'acct1', 1, 1, 5, 5, 5, ${FC}, 4, now())`);
  await db.query(`INSERT INTO companion_submarine_snapshot (cid, sub_name, level, part1, part2, part3, part4, slot) VALUES (${CID}, 'Remy Sub', 10, 21794, 21795, 21796, 21797, 1)`);
  await db.query(`INSERT INTO sub_craft_toggle (cid, sub_name, craft_enabled) VALUES (${CID}, 'Remy Sub', true)`);
  await db.query(`INSERT INTO sub_build_rules (rank, cid_override, hull, stern, bow, bridge) VALUES (20, ${CID}, 'S', 'S', 'S', 'S')`);
  await db.query(`INSERT INTO companion_retainer_lookup (retainer_id, owner_cid, name, job, gil, has_venture, level, hire_order_index) VALUES (${RETAINER}, ${CID}, 'Remyret', 1, 0, false, 1, 0)`);
  await db.query(`INSERT INTO retainer_gear_targets (retainer_id, target_mode, target_value) VALUES (${RETAINER}, 'level', 10)`);
  await db.query(`INSERT INTO companion_inventory_snapshot (owner_cid, retainer_id, sorted_container, sorted_slot_index, item_id, quantity) VALUES (${CID}, ${CID}, 0, 0, 22500, 3), (${CID}, ${RETAINER}, 10000, 0, 22501, 2)`);
  await db.query(`INSERT INTO companion_character_housing (cid, fc_id, fc_name, fc_master, fc_points, fc_rank, total_members, has_house) VALUES (${CID}, ${FC}, 'Remy FC', 'Remy Removeme', 10, '1', 1, false)`);
  await db.query(`INSERT INTO character_sort_order (cid, sort_index) VALUES (${CID}, 999)`);
  await db.query(`INSERT INTO companion_rankup_forecast (cid, slot, rank, made_at, predicted_at, sub_name) VALUES (${CID}, 1, 11, now() - interval '1 day', now(), 'Remy Sub')`);
  await db.query(`INSERT INTO companion_fc_inventory_snapshot (fc_id, sorted_container, sorted_slot_index, item_id, quantity) VALUES (${FC}, 20000, 0, 22502, 4)`);
  await db.query(`INSERT INTO companion_metric_history (recorded_at, subject_type, subject_id, metric, value) VALUES
                  (now() - interval '1 day', 'character', ${CID}, 'gil', 5), (now() - interval '1 day', 'fc', ${FC}, 'fc_points', 10)`);
  await db.query(`INSERT INTO companion_metric_latest (subject_type, subject_id, metric, value, recorded_at) VALUES
                  ('character', ${CID}, 'gil', 5, now() - interval '1 day'), ('fc', ${FC}, 'fc_points', 10, now() - interval '1 day')`);
};

// Whatever the outcome, the test character is not left behind for later scenarios.
module.exports.after = clear;
