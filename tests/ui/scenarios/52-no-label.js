// Characters and setups of the plugin with no account label: the Roster and the PCs tab say so and where to fill
// it in (each setup's plugin settings, Account Label). Two of the test characters and one PC have none.
const BEX = '18014498578000001';
const CAL = '18014498578000002';
let labels = [];

module.exports = async (t) => {
  const { ev, waitFor, check, nav, shot } = t;
  const note = () => ev(`(document.querySelector('.no-label-note') || {}).innerText || ''`);

  await nav('Character Roster');
  await waitFor(`!!document.querySelector('.no-label-note')`, 'the note on the Roster', 20000);
  const roster = await note();
  check(/^2 characters have no account label,/.test(roster), 'counts the characters: ' + roster);
  check(/Fleet Companion plugin settings, fill in Account Label/.test(roster), 'says where to fill it in');
  await shot('no-label-roster');

  await nav('PCs');
  await waitFor(`!!document.querySelector('.pcs .no-label-note')`, 'the note on the PCs tab', 20000);
  check(/^1 setup of the plugin has no account label,/.test(await note()), 'counts the setups: ' + await note());
};

module.exports.before = async (db) => {
  labels = (await db.query(`SELECT cid::text, account_label FROM companion_character_current WHERE cid IN (${BEX}, ${CAL})`)).rows;
  await db.query(`UPDATE companion_character_current SET account_label = '' WHERE cid IN (${BEX}, ${CAL})`);
  await db.query(`DELETE FROM companion_pc_status`);
  await db.query(`INSERT INTO companion_pc_status (pc_name, account_label, plugin_version, last_sync_at) VALUES
    ('DESKTOP-1', 'acct1', '1.0.1', now()), ('DESKTOP-1', '', '1.0.1', now())`);
};

module.exports.after = async (db) => {
  for (const l of labels) await db.query('UPDATE companion_character_current SET account_label = $1 WHERE cid = $2', [l.account_label, l.cid]);
  await db.query(`DELETE FROM companion_pc_status`);
};
