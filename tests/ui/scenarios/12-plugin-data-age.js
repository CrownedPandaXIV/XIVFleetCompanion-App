// The header says how old the newest plugin data is, and turns amber when an account has sent
// nothing for 30 minutes or more, naming that account. (Snapshot times are changed before the app
// starts and put back after.)
module.exports = async (t) => {
  const { ev, sleep, waitFor, check, clickText } = t;
  const note = () => ev(`(document.querySelector('.plugin-data')||{}).innerText||''`);
  await waitFor(`!!document.querySelector('.plugin-data')`, 'the plugin data note');
  const text = await note();
  check(/^Plugin data: (just now|\d+ min ago) · acct2: 5 h ago$/.test(text), 'the note gives the newest data age and the account that is behind: ' + text);
  check(await ev(`document.querySelector('.plugin-data').classList.contains('stale')`), 'the note is amber while an account is behind');
  const title = await ev(`document.querySelector('.plugin-data').title`);
  check(/acct0: .*\(26 characters\)/.test(title) && /acct2: 5 h ago \(27 characters\)/.test(title), 'hovering lists every account with its data age: ' + title.split('\n').slice(1, 4).join(' | '));
  check(await ev(`![...document.querySelectorAll('button')].some(b=>b.innerText.trim()==='Sync Now')`), 'the button is called Refresh, not Sync Now');
  await clickText('button', 'Refresh');
  await sleep(800);
  check((await note()) === text, 'Refresh keeps the note (the plugin data did not change)');
};

// Both the snapshot history and the current-state table get the same times, so the note is the same
// whichever the app reads.
module.exports.before = async (db) => {
  await db.query('drop table if exists zz_saved_snapshot, zz_saved_current');
  await db.query('create table zz_saved_snapshot as table companion_character_snapshot');
  await db.query('create table zz_saved_current as table companion_character_current');
  await db.query(`update companion_character_snapshot set snapshot_at = now() - interval '2 minutes' where account_label <> 'acct2'`);
  await db.query(`update companion_character_snapshot set snapshot_at = now() - interval '5 hours 10 minutes' where account_label = 'acct2'`);
  await db.query(`update companion_character_current set last_synced_at = now() - interval '2 minutes' where account_label <> 'acct2'`);
  await db.query(`update companion_character_current set last_synced_at = now() - interval '5 hours 10 minutes' where account_label = 'acct2'`);
};
module.exports.after = async (db) => {
  await db.query(`do $$ begin
    if to_regclass('public.zz_saved_snapshot') is not null then
      delete from companion_character_snapshot;
      insert into companion_character_snapshot select * from zz_saved_snapshot;
      drop table zz_saved_snapshot;
    end if;
    if to_regclass('public.zz_saved_current') is not null then
      delete from companion_character_current;
      insert into companion_character_current select * from zz_saved_current;
      drop table zz_saved_current;
    end if;
  end $$`);
};
