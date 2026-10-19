// Moving the database to another PC: on the PC it moved to, the PCs tab says which PCs haven't switched over yet;
// Settings → Database → Move the database to this PC checks first, and refuses when the database is already here.
const MOVED_FROM = '100.64.7.7';

module.exports = async (t) => {
  const { ev, waitFor, check, nav } = t;
  await nav('PCs');
  await waitFor(`!!document.querySelector('.pcs-moved')`, 'the moved note on the PCs tab', 15000);
  const note = await ev(`document.querySelector('.pcs-moved').innerText`);
  check(note.includes(`The database moved here from ${MOVED_FROM}`), `where it moved from: ${note}`);
  check(note.includes('UI-LAPTOP (Account 2)') && !note.includes('UI-DESKTOP'), `only the PC that hasn't synced since is listed: ${note}`);

  await ev(`document.querySelector('.gear-button').click()`);
  await waitFor(`!!document.querySelector('.settings-tab')`, 'Settings');
  await ev(`[...document.querySelectorAll('.settings-tab')].find((b) => b.innerText === 'Database').click()`);
  const box = `document.querySelector('.move-database')`;
  await waitFor(`!!${box}`, 'the Move section', 15000);
  check(await ev(`!!${box}.querySelector('.move-open')`), 'folded away until asked for');
  await ev(`${box}.querySelector('.move-open').click()`);
  await waitFor(`!!${box}.querySelector('.move-problem, .move-ready')`, 'the checks', 30000);
  const problem = await ev(`${box}.querySelector('.move-problem') ? ${box}.querySelector('.move-problem').innerText : ''`);
  check(/already on this PC/.test(problem), `the database this app uses is already here, so it can't move here: ${problem}`);
  check(await ev(`${box}.querySelector('.move-start').disabled`), 'the move button stays off');
  check(await ev(`!!${box}.querySelector('.move-address')`), 'this PC\'s addresses are offered');
};

module.exports.before = async (db) => {
  await db.query(`INSERT INTO companion_database_move (state, host, port, from_host, moved_at)
                  VALUES ('arrived', '100.64.0.2', 5432, '${MOVED_FROM}', now() - interval '2 hours')`);
  await db.query(`INSERT INTO companion_pc_status (pc_name, account_label, plugin_version, last_sync_at, db_user)
                  VALUES ('UI-DESKTOP', 'Account 1', '0.14.0', now(), current_user),
                         ('UI-LAPTOP', 'Account 2', '0.14.0', now() - interval '3 hours', current_user)`);
};

module.exports.after = async (db) => {
  await db.query('DELETE FROM companion_database_move');
  await db.query(`DELETE FROM companion_pc_status WHERE pc_name IN ('UI-DESKTOP', 'UI-LAPTOP')`);
};
