// Income: real net income from subs (salvage that came in, less repair kits used) against Fight Club's
// expected. For this run Bex Kitteh 1 (one of 4 subs on a Fight Club route, 250,000 gil a day) has this
// recorded history, with repair kits at 1,500 gil:
//   salvage 22500 (8,000 gil): 0 ten days ago, 10 five days ago, 2 three days ago (sold), 7 now
//   salvage 22504 (27,000 gil): 0 eight days ago, 4 two days ago
//   repair kits: 100 ten days ago, 94 four days ago
// Over 7 days: 15 x 8,000 + 4 x 27,000 = 228,000 salvage, 6 kits = 9,000, so 219,000 net, 31,286 a day,
// 13% of expected (red). The history ends when this run starts, a few seconds before the window is
// worked out, so the figures are checked to within 0.1%. Over 3 days: 5 x 8,000 + 4 x 27,000 = 148,000, no kits, 49,333 a day.
// Cal Kitteh 2's salvage history is removed, so there is not enough of it.
const BEX = '18014498578000001';
const CAL = '18014498578000002';
const METRICS = `metric LIKE 'item_qty:%' OR metric = 'repair_kits'`;

module.exports = async (t) => {
  const { ev, sleep, waitFor, check, nav, shot } = t;
  await ev(`window.localStorage.clear()`);
  await nav('Income');
  await waitFor(`document.querySelectorAll('.income-table tbody tr').length > 0`, 'the income table', 20000);
  await sleep(300);
  await shot('income');
  const rowOf = (name) => ev(`(() => {
    const tr = [...document.querySelectorAll('.income-table tbody tr')].find(r => r.children[0].innerText.trim() === ${JSON.stringify(name)});
    return tr ? [...tr.children].map(td => ({ text: td.innerText.trim(), cls: td.className, title: td.title })) : null;
  })()`);
  let row = await rowOf('Bex Kitteh 1');
  // "−1,286" -> -1286; true when within 0.1% of what is expected.
  const near = (text, expected) => {
    const n = Number(String(text).replace(/[,\s*%]/g, '').replace('−', '-'));
    return Number.isFinite(n) && Math.abs(n - expected) <= Math.abs(expected) * 0.001 + 1;
  };
  const texts = (r) => (r ? r.map((c) => c.text).join(' | ') : 'missing');
  check(row && row[2].text === '4' && near(row[3].text, 32571) && near(row[4].text, -1286) && near(row[5].text, 31286),
    'over 7 days: 32,571 salvage less 1,286 repairs = 31,286 a day: ' + texts(row));
  check(row && row[3].title.startsWith('19 salvage pieces came in'),
    'salvage pieces on hover: ' + (row && row[3].title));
  check(row && row[6].text === '246,100 *' && /3 of 4 subs are on a route Fight Club does not list/.test(row[6].title),
    'expected from the one matched sub, the others explained on hover: ' + (row && row[6].text + ' / ' + row[6].title));
  check(row && near(row[7].text, 31286 - 246100) && row[8].text === '13%' && row[8].cls.includes('income-danger'),
    'far below expected shows red: ' + texts(row));

  const cal = await rowOf('Cal Kitteh 2');
  check(cal && cal[3].text === 'Not enough history', 'no salvage history: not enough to say: ' + texts(cal));
  const groups = await ev(`[...document.querySelectorAll('.income .account-group > h1')].map(h => h.innerText.trim())`);
  check(groups.length > 1 && groups[0] === 'acct0', 'grouped by account: ' + groups.join(', '));
  check(/1,500 gil each/.test(await ev(`document.querySelector('.supplies-note').innerText`)), 'the note names the repair kit cost');

  // Over 3 days instead, saved for every PC.
  await ev(`(() => { const s = document.querySelector('.income-controls select'); s.value = '3'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await waitFor(`(() => { const s = document.querySelector('.income-controls select'); return s && s.value === '3'; })()`, 'the 3-day window');
  await sleep(800);
  row = await rowOf('Bex Kitteh 1');
  check(row && row[4].text === '0' && near(row[5].text, 49333), 'over 3 days: no kits used, 49,333 a day: ' + texts(row));
  const saved = await t.query(`SELECT setting_value FROM fleet_economics_settings WHERE setting_key = 'income_window_days'`);
  check(saved.length === 1 && Number(saved[0].setting_value) === 3, 'the window is saved: ' + JSON.stringify(saved));

  await ev(`[...document.querySelectorAll('.income-controls label')].find(l => l.innerText.includes('Group by account')).querySelector('input').click()`);
  await sleep(300);
  check(await ev(`document.querySelectorAll('.income .account-group > h1').length`) === 0 && await ev(`document.querySelectorAll('.income-table').length`) === 1, 'ungrouped: one table');
};

module.exports.before = async (db) => {
  await db.query('DROP TABLE IF EXISTS ui_income_backup');
  await db.query(`CREATE TABLE ui_income_backup AS SELECT * FROM companion_metric_history
                  WHERE subject_type = 'character' AND subject_id IN (${BEX}, ${CAL}) AND (${METRICS})`);
  await db.query(`DELETE FROM companion_metric_history WHERE subject_type = 'character' AND subject_id IN (${BEX}, ${CAL}) AND (${METRICS})`);
  await db.query(`INSERT INTO companion_metric_history (recorded_at, subject_type, subject_id, metric, value) VALUES
    (now() - interval '10 days', 'character', ${BEX}, 'item_qty:22500', 0),
    (now() - interval '5 days', 'character', ${BEX}, 'item_qty:22500', 10),
    (now() - interval '3 days 1 hour', 'character', ${BEX}, 'item_qty:22500', 2),
    (now(), 'character', ${BEX}, 'item_qty:22500', 7),
    (now() - interval '8 days', 'character', ${BEX}, 'item_qty:22504', 0),
    (now() - interval '2 days', 'character', ${BEX}, 'item_qty:22504', 4),
    (now() - interval '10 days', 'character', ${BEX}, 'repair_kits', 100),
    (now() - interval '4 days', 'character', ${BEX}, 'repair_kits', 94)`);
  await db.query(`INSERT INTO fleet_economics_settings (setting_key, setting_value, updated_at) VALUES ('repair_kit_cost', 1500, now())
                  ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value`);
};

module.exports.after = async (db) => {
  await db.query(`DELETE FROM companion_metric_history WHERE subject_type = 'character' AND subject_id IN (${BEX}, ${CAL}) AND (${METRICS})`);
  await db.query('INSERT INTO companion_metric_history SELECT * FROM ui_income_backup');
  await db.query('DROP TABLE ui_income_backup');
  await db.query(`DELETE FROM fleet_economics_settings WHERE setting_key IN ('income_window_days', 'repair_kit_cost')`);
};
