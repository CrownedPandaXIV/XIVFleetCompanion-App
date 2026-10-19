// An app whose database has moved to an address it can't reach: the banner says so, and the tabs keep showing
// what's in the old database. The banner keeps up as that changes, without restarting the app (it checks every
// 2 seconds here instead of every minute).
module.exports = async (t) => {
  const { ev, waitFor, check, nav } = t;
  const banner = `document.querySelector('.move-banner')`;
  await nav('Character Roster');
  await waitFor(`!!${banner}`, 'the moved banner', 30000);
  const text = await ev(`${banner}.innerText`);
  check(/The database moved to 127\.0\.0\.1:1, but this PC can't reach it yet\./.test(text), `the banner: ${text}`);
  check(/tries again every minute/.test(text), 'it says it tries again');
  await waitFor(`document.querySelectorAll('table tbody tr').length > 0`, 'the roster', 15000);
  check(true, 'the roster still loads from the old database');

  // Each tab change asks the database something, which is when the app checks for a move.
  const keepLooking = async (until, what) => {
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      await nav(i % 2 ? 'Character Roster' : 'Subs');
      if (await ev(until)) return true;
    }
    throw new Error(`timed out waiting for ${what}`);
  };
  await t.query('DELETE FROM companion_database_move');
  await keepLooking(`!${banner}`, 'the banner to go');
  check(true, 'once the note is gone, the banner goes');

  await t.query(`INSERT INTO companion_database_move (state, host, port, from_host, moved_at) VALUES ('moved', '127.0.0.1', 2, 'here', now())`);
  await keepLooking(`!!${banner} && /127\\.0\\.0\\.1:2/.test(${banner}.innerText)`, 'the banner to come back');
  check(true, 'a new move shows straight away');
};

module.exports.env = () => ({ FLEET_MOVE_CHECK_MS: '2000' });

module.exports.before = async (db) => {
  await db.query(`INSERT INTO companion_database_move (state, host, port, from_host, moved_at) VALUES ('moved', '127.0.0.1', 1, 'here', now())`);
};

module.exports.after = async (db) => {
  await db.query('DELETE FROM companion_database_move');
};
