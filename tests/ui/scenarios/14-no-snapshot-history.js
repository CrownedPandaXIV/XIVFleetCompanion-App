// After Phase B (plugin 0.4.0 and database version 5) the old snapshot history table is gone: the app reads
// only the current-state table, and every tab still shows its characters. (The table is renamed
// before the app starts and renamed back after.)
module.exports = async (t) => {
  const { ev, sleep, waitFor, check, nav } = t;
  await nav('Character Roster');
  await waitFor(`document.querySelectorAll('tbody tr[data-cid]').length>0`, 'roster rows');
  check(await ev(`document.querySelectorAll('tbody tr[data-cid]').length`) === 80, 'Character Roster lists all 80 characters from the current-state table');
  await waitFor(`!!document.querySelector('.plugin-data')`, 'the plugin data note');
  check(/^Plugin data: (just now|\d+ (min|h) ago|\d+ days ago)/.test(await ev(`document.querySelector('.plugin-data').innerText`)), 'the plugin data note still shows an age');
  await nav('Free Companies');
  await waitFor(`document.querySelectorAll('tbody tr').length>0`, 'Free Company rows');
  check(await ev(`document.querySelectorAll('tbody tr').length`) === 80, 'Free Companies lists all 80 Free Companies');
  await nav('Retainers'); await sleep(1500);
  check(await ev(`document.querySelectorAll('tbody tr').length`) > 0, 'Retainers lists retainers with their owners');
  await nav('Salvage'); await sleep(1500);
  check(await ev(`document.querySelector('.main-pane').innerText.includes('Fleet Total')`), 'Salvage loads');
  await nav('Trends'); await sleep(1500);
  check(await ev(`!!document.querySelector('.main-pane canvas, .main-pane table')`), 'Trends shows a chart');
};

module.exports.before = async (db) => {
  await db.query('alter table companion_character_snapshot rename to zz_hidden_snapshot');
};
module.exports.after = async (db) => {
  await db.query(`do $$ begin
    if to_regclass('public.zz_hidden_snapshot') is not null then
      alter table zz_hidden_snapshot rename to companion_character_snapshot;
    end if;
  end $$`);
};
