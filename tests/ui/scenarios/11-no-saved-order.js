// A fresh install: no character has a saved position yet (nobody has dragged the roster). Every tab
// must still load, with characters in name order. (The saved order is moved aside before the app
// starts and put back after.)
module.exports = async (t) => {
  const { ev, sleep, waitFor, check, nav, clickText } = t;
  const loaded = async (label) => {
    await nav(label);
    let done = false;
    for (let i = 0; i < 40 && !done; i++) {
      await sleep(250);
      done = await ev(`!!document.querySelector('.main-pane') && !document.querySelector('.main-pane > .status, .main-pane > div > .status')?.innerText.startsWith('Loading')`);
    }
    return done;
  };

  await nav('Character Roster');
  await waitFor(`document.querySelectorAll('tbody tr[data-cid]').length>0`, 'roster rows');
  check(await ev(`document.querySelectorAll('tbody tr[data-cid]').length`) === 80, 'Character Roster lists all 80 characters');
  await clickText('label', 'Group by account');
  await sleep(300);
  const names = await ev(`[...document.querySelectorAll('tbody tr[data-cid]')].map(tr=>tr.children[1].innerText.trim())`);
  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  check(JSON.stringify(names) === JSON.stringify(sorted), 'with no saved order, the roster is in name order: ' + names.slice(0, 3).join(', '));

  for (const [label, sign] of [
    ['Parts', 'Hide Rules'],
    ['Salvage', 'Fleet Total'],
    ['Route Optimization', 'Group by account'],
    ['Subs', 'Group by account'],
    ['Retainers', 'Group by account'],
  ]) {
    const done = await loaded(label);
    const shows = await ev(`document.querySelector('.main-pane').innerText.includes(${JSON.stringify(sign)})`);
    check(done && shows, `${label} finishes loading (shows "${sign}")`);
  }
};

module.exports.before = async (db) => {
  await db.query('drop table if exists zz_saved_sort_order');
  await db.query('create table zz_saved_sort_order as table character_sort_order');
  await db.query('delete from character_sort_order');
};
module.exports.after = async (db) => {
  await db.query(`do $$ begin
    if to_regclass('public.zz_saved_sort_order') is not null then
      delete from character_sort_order;
      insert into character_sort_order select * from zz_saved_sort_order;
      drop table zz_saved_sort_order;
    end if;
  end $$`);
};
