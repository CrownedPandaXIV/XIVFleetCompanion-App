// If the plugin's metric-history tables are not there (an older plugin), only the trend parts
// say so; the rest of the app keeps working. (Tables are renamed before the app starts and
// renamed back after.)
module.exports = async (t) => {
  const { ev, sleep, waitFor, check, nav } = t;
  await sleep(2500);
  check(await ev(`document.body.innerText.includes('Trends are unavailable right now')`), 'Summary shows a short "Trends are unavailable" note instead of tiles');
  check(await ev(`document.body.innerText.includes('Warnings: low repair kits: off') && !document.querySelector('.error')`), 'the rest of Summary still loads normally (no error page)');
  await nav('Trends'); await sleep(1500);
  check(await ev(`document.body.innerText.includes('Could not load trend data')`), 'Trends tab says the data could not be loaded');
  await nav('Character Roster'); await waitFor(`document.querySelectorAll('tbody tr[data-cid]').length>0`, 'roster');
  check(await ev(`document.querySelectorAll('tbody tr[data-cid]').length`) === 80, 'Character Roster still lists all 80 rows');
  await sleep(1200);
  check(await ev(`document.body.innerText.includes('Could not load this chart')`), 'the roster chart shows a small "could not load" note');
  check(await ev(`document.querySelectorAll('tbody tr[data-cid] .trend-link').length`) === 80, 'the rest of the roster (chart icons, drag handles) is intact');
};

const rename = (db, from, to) => db.query(`alter table ${from} rename to ${to}`);
module.exports.before = async (db) => {
  await rename(db, 'companion_metric_history', 'zz_metric_history');
  await rename(db, 'companion_metric_latest', 'zz_metric_latest');
};
module.exports.after = async (db) => {
  await db.query(`do $$ begin
    if to_regclass('public.zz_metric_history') is not null then alter table zz_metric_history rename to companion_metric_history; end if;
    if to_regclass('public.zz_metric_latest') is not null then alter table zz_metric_latest rename to companion_metric_latest; end if;
  end $$`);
};
