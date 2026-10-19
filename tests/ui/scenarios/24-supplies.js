// Supplies: days until each character runs out of ceruleum and repair kits, from how fast it used them
// over the last few days. For this run Bex Kitteh 1 holds 60 ceruleum, last synced now, with this
// recorded history: 205 twenty days ago, 175 ten days ago, 135 seven days ago. Over 14 days that is
// 30 + 40 + 75 = 145 used, 10.4 a day, so 60 lasts 5.8 days; over 7 days 75 used, 10.7 a day, 5.6 days.
// Its repair kit history is removed, so there is not enough of it.
const CID = '18014498578000001';

module.exports = async (t) => {
  const { ev, sleep, waitFor, check, nav, shot } = t;
  await ev(`window.localStorage.clear()`);
  await nav('Supplies');
  await waitFor(`document.querySelectorAll('.supplies-table tbody tr').length > 0`, 'the supplies table', 20000);
  await sleep(300);
  await shot('supplies');
  const bex = () => ev(`(() => {
    const tr = [...document.querySelectorAll('.supplies-table tbody tr')].find(r => r.children[0].innerText.trim() === 'Bex Kitteh 1');
    return tr ? [...tr.children].map(td => ({ text: td.innerText.trim(), cls: td.className, title: td.title })) : null;
  })()`);
  let row = await bex();
  check(row && row[2].text === '60' && row[3].text === '10.4' && row[4].text === '5.8 days',
    'over 14 days: 60 ceruleum, 10.4 a day, 5.8 days left: ' + (row && row.slice(2, 6).map((c) => c.text).join(' | ')));
  check(row && row[4].cls.includes('supply-warn') && /^Runs out about /.test(row[4].title), 'under a week shows amber, with the date on hover');
  check(row && row[6].text === '300' && row[8].text === 'Not enough history' && row[9].text === '', 'no repair kit history: not enough to say');
  const groups = await ev(`[...document.querySelectorAll('.supplies .account-group > h1')].map(h => h.innerText.trim())`);
  check(groups.length > 1 && groups[0] === 'acct0', 'grouped by account: ' + groups.join(', '));
  const firstRows = await ev(`[...document.querySelectorAll('.supplies .account-group')].find(g => g.querySelector('h1')?.innerText.trim() === 'acct1').querySelectorAll('tbody tr')[0].children[0].innerText.trim()`);
  check(firstRows === 'Bex Kitteh 1', 'Roster order inside an account: ' + firstRows);

  // Over 7 days instead, saved for every PC.
  await ev(`(() => { const s = document.querySelector('.supplies-controls select'); s.value = '7'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await waitFor(`(() => { const s = document.querySelector('.supplies-controls select'); return s && s.value === '7'; })()`, 'the 7-day window');
  await sleep(800);
  row = await bex();
  check(row && row[3].text === '10.7' && row[4].text === '5.6 days', 'over 7 days: 10.7 a day, 5.6 days left: ' + (row && row.slice(3, 5).map((c) => c.text).join(' | ')));

  // Buy enough for 10 days: 10.7 x 10 - 60 = 47.1, so 48.
  await ev(`(() => {
    const input = document.querySelector('.supplies-controls input[type=number]');
    input.focus();
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(input, '10'); input.dispatchEvent(new Event('input', { bubbles: true }));
    input.blur();
  })()`);
  await sleep(1200);
  row = await bex();
  check(row && row[5].text === '48', 'buy enough for 10 days: 48 ceruleum: ' + (row && row[5].text));
  check(/To last 10 days, buy/.test(await ev(`document.querySelector('.supplies-summary').innerText`)), 'the fleet card follows the setting');
  const saved = await t.query(`SELECT setting_key, setting_value FROM fleet_economics_settings WHERE setting_key IN ('supply_window_days', 'restock_target_days') ORDER BY 1`);
  check(JSON.stringify(saved.map((r) => [r.setting_key, Number(r.setting_value)])) === JSON.stringify([['restock_target_days', 10], ['supply_window_days', 7]]), 'both settings are saved: ' + JSON.stringify(saved));

  await ev(`[...document.querySelectorAll('.supplies-controls label')].find(l => l.innerText.includes('Group by account')).querySelector('input').click()`);
  await sleep(300);
  check(await ev(`document.querySelectorAll('.supplies .account-group > h1').length`) === 0 && await ev(`document.querySelectorAll('.supplies > .supplies-table').length`) === 1, 'ungrouped: one table');
};

module.exports.before = async (db) => {
  await db.query('DROP TABLE IF EXISTS ui_supplies_backup');
  await db.query(`CREATE TABLE ui_supplies_backup AS SELECT * FROM companion_metric_history
                  WHERE subject_type = 'character' AND subject_id = ${CID} AND metric IN ('ceruleum', 'repair_kits')`);
  await db.query(`CREATE TABLE ui_supplies_current AS SELECT cid, ceruleum, last_synced_at FROM companion_character_current WHERE cid = ${CID}`);
  await db.query(`DELETE FROM companion_metric_history WHERE subject_type = 'character' AND subject_id = ${CID} AND metric IN ('ceruleum', 'repair_kits')`);
  await db.query(`UPDATE companion_character_current SET ceruleum = 60, last_synced_at = now() WHERE cid = ${CID}`);
  await db.query(`INSERT INTO companion_metric_history (recorded_at, subject_type, subject_id, metric, value) VALUES
    (now() - interval '20 days', 'character', ${CID}, 'ceruleum', 205),
    (now() - interval '10 days', 'character', ${CID}, 'ceruleum', 175),
    (now() - interval '7 days' - interval '1 minute', 'character', ${CID}, 'ceruleum', 135),
    (now(), 'character', ${CID}, 'ceruleum', 60)`);
};

module.exports.after = async (db) => {
  await db.query(`DELETE FROM companion_metric_history WHERE subject_type = 'character' AND subject_id = ${CID} AND metric IN ('ceruleum', 'repair_kits')`);
  await db.query('INSERT INTO companion_metric_history SELECT * FROM ui_supplies_backup');
  await db.query(`UPDATE companion_character_current c SET ceruleum = b.ceruleum, last_synced_at = b.last_synced_at
                  FROM ui_supplies_current b WHERE c.cid = b.cid`);
  await db.query('DROP TABLE ui_supplies_backup');
  await db.query('DROP TABLE ui_supplies_current');
  await db.query(`DELETE FROM fleet_economics_settings WHERE setting_key IN ('supply_window_days', 'restock_target_days')`);
};
