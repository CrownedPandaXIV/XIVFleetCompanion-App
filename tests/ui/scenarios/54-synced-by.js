// Who syncs each character (plugin 1.0.2: only the setup a character last logged in on syncs it): the Roster's
// Synced By column, the PCs tab's count of characters a setup left to another one, and the note when a character's
// setup is syncing without it (unticked there), so no setup sends it. The setup's last sync is put two hours ahead
// so the fixture characters count as left behind by it.
const BEX = '18014498578000001';
const CAL = '18014498578000002';

module.exports = async (t) => {
  const { ev, waitFor, check, nav, shot } = t;

  await nav('Character Roster');
  await waitFor(`!!document.querySelector('tr[data-cid="${BEX}"] td.synced-by')`, 'the Synced By column', 20000);
  check(await ev(`[...document.querySelectorAll('th')].some((th) => /^synced by/i.test(th.innerText.trim()))`), 'the Roster has a Synced By column');
  check(await ev(`document.querySelector('tr[data-cid="${BEX}"] td.synced-by').innerText`) === 'Account 2 on UITEST-PC', 'names the setup a character last logged in on');
  check(await ev(`document.querySelector('tr[data-cid="${BEX}"] td.synced-by').title.startsWith('Last logged in on this setup')`), 'with when, on hover');
  check(await ev(`document.querySelector('tr[data-cid="${CAL}"] td.synced-by').innerText`) === '—', 'a dash for a character with no login recorded');
  await waitFor(`!!document.querySelector('.not-synced-anywhere')`, 'the not synced note', 10000);
  const note = await ev(`document.querySelector('.not-synced-anywhere').innerText.replace(/\\s+/g, ' ')`);
  check(note.startsWith("1 character isn't synced by any setup of the plugin: Bex Kitteh 1 (Cuchulainn, last logged in on Account 2 on UITEST-PC).")
    && note.includes('under Characters, tick it'), 'the Roster says which character no setup syncs, and how to fix it: ' + note);
  await shot('synced-by-roster');

  await nav('PCs');
  await waitFor(`!!document.querySelector('.pcs .not-synced-anywhere')`, 'the note on the PCs tab', 20000);
  check(await ev(`document.querySelector('.pcs').innerText.includes('5 (2 left to another setup)')`), 'the PCs tab says how many characters a setup left to another one');
  await shot('synced-by-pcs');
};

module.exports.before = async (db) => {
  await db.query(`INSERT INTO companion_pc_status (pc_name, account_label, plugin_version, last_sync_at, autoretainer_ready, characters_synced, characters_left_out, characters_elsewhere, problems)
                  VALUES ('UITEST-PC', 'Account 2', '1.0.2', now() + interval '2 hours', true, 5, 0, 2, '{}')`);
  await db.query(`INSERT INTO companion_character_login (cid, pc_name, account_label, logged_in_at) VALUES (${BEX}, 'UITEST-PC', 'Account 2', now() - interval '1 day')`);
};
module.exports.after = async (db) => {
  await db.query(`DELETE FROM companion_pc_status WHERE pc_name = 'UITEST-PC'`);
  await db.query(`DELETE FROM companion_character_login WHERE cid = ${BEX}`);
};
