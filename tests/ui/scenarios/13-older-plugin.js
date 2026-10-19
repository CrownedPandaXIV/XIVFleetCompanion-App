// With an older plugin there is no current-state table (or it is not kept up to date): the app reads
// the snapshot history instead, and every tab still shows its characters. (The table is renamed
// before the app starts and renamed back after.)
module.exports = async (t) => {
  const { ev, sleep, waitFor, check, nav } = t;
  await nav('Character Roster');
  await waitFor(`document.querySelectorAll('tbody tr[data-cid]').length>0`, 'roster rows');
  check(await ev(`document.querySelectorAll('tbody tr[data-cid]').length`) === 80, 'Character Roster lists all 80 characters from the snapshot history');
  await waitFor(`!!document.querySelector('.plugin-data')`, 'the plugin data note');
  check(/^Plugin data: (just now|\d+ (min|h) ago|\d+ days ago)/.test(await ev(`document.querySelector('.plugin-data').innerText`)), 'the plugin data note still shows an age');
  await nav('Free Companies');
  await waitFor(`document.querySelectorAll('tbody tr').length>0`, 'Free Company rows');
  check(await ev(`document.querySelectorAll('tbody tr').length`) === 80, 'Free Companies lists all 80 Free Companies');
  await nav('Salvage'); await sleep(1500);
  check(await ev(`document.querySelector('.main-pane').innerText.includes('Fleet Total')`), 'Salvage loads');
};

module.exports.before = async (db) => {
  await db.query('alter table companion_character_current rename to zz_hidden_current');
};
module.exports.after = async (db) => {
  await db.query(`do $$ begin
    if to_regclass('public.zz_hidden_current') is not null then
      alter table zz_hidden_current rename to companion_character_current;
    end if;
  end $$`);
};
