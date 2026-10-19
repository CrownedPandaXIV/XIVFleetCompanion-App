// Subs: how close the Next Rank dates came, at the top of the tab. Parts: Look ahead.
// Bex Kitteh 1's Sub2 went from rank 82 to 83 two hours ago; the date saved 28 hours before said 5 hours ago,
// so it came 3 hours late: "within 3 hours on average over the last 1 rank-up".
// For Look ahead, a Sub Rules rule gives Bex's Sub3 (rank 84, 3,000 into it, back in an hour) an all-Unkiu
// build at 85: 7,000 more experience is 3 voyages of 3,000 (back in an hour, then two of about 14.9 hours),
// so it is due in about 1d 6h. Now only lists its Whale parts for rank 80; 3 days also lists the Unkiu ones.
const BEX = '18014498578000001';
const BEX_NAME = 'Bex Kitteh 1';
let sub3ReturnTime = null;

module.exports = async (t) => {
  const { ev, waitFor, check, nav, clickText, shot, query } = t;
  await ev(`window.localStorage.clear()`);

  // Subs: the line, with each rank-up on hover.
  await nav('Subs');
  await waitFor(`!!document.querySelector('.forecast-accuracy')`, 'the forecast line', 20000);
  const line = await ev(`(() => { const e = document.querySelector('.forecast-accuracy'); return { text: e.innerText.trim(), title: e.title }; })()`);
  check(line.text === 'Next Rank forecasts: within 3 hours on average over the last 1 rank-up', 'the average: ' + line.text);
  check(/Sub2 \(Bex Kitteh 1\) rank 83: said .+, ranked up .+, 3 hours late; worked out 28 hours before/.test(line.title), 'each rank-up on hover: ' + line.title);
  const sameRow = await ev(`(() => { const e = document.querySelector('.forecast-accuracy'); return !!e.closest('.controls'); })()`);
  check(sameRow, 'on the line with the Columns button, not a column');
  const saved = await query(`SELECT count(*)::int AS n FROM companion_rankup_forecast WHERE made_at = date_trunc('hour', now())`);
  check(saved[0].n > 0, `this hour's dates were saved: ${saved[0].n}`);
  await shot('forecast-accuracy');

  // Parts → Detail: Now only, as before; then 3 days ahead.
  await nav('Parts');
  await waitFor(`[...document.querySelectorAll('button')].some(b => b.innerText.trim() === 'Detail')`, 'the Parts tab', 20000);
  await clickText('.controls button', 'Detail');
  const bexRows = () => ev(`(() => {
    const group = [...document.querySelectorAll('.account-group')].find(g => {
      const h = g.querySelector('h2');
      return h && new RegExp('^' + ${JSON.stringify(BEX_NAME)} + '(\\\\D|$)').test(h.innerText.trim());
    });
    if (!group) return null;
    const heads = [...group.querySelectorAll('thead th')].map(th => th.innerText.trim().replace(/[\\u25B2\\u25BC]/g, '').trim().toLowerCase());
    return [...group.querySelectorAll('tbody tr')].map(tr => Object.fromEntries([...tr.children].map((td, i) => [heads[i], td.innerText.trim()])));
  })()`);
  await waitFor(`[...document.querySelectorAll('.account-group h2')].some(h => h.innerText.startsWith(${JSON.stringify(BEX_NAME)}))`, "Bex's parts", 20000);
  const before = await bexRows();
  check(before && !before.some((r) => r.sub === 'Sub3' && /Unkiu/.test(r.needed)), 'Now only: no Unkiu parts yet');
  check(before && before.every((r) => !('due' in r)), 'Now only: no Due column');

  const choose = (value) => ev(`(() => { const s = [...document.querySelectorAll('.controls label')].find(l => l.innerText.includes('Look ahead')).querySelector('select');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, ${JSON.stringify(value)});
    s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await choose('3');
  await waitFor(`[...document.querySelectorAll('.account-group thead th')].some(th => /^due/i.test(th.innerText.trim()))`, 'the Due column', 20000);
  await waitFor(`[...document.querySelectorAll('.account-group tbody td')].some(td => td.innerText.includes('Unkiu'))`, 'the parts coming up', 20000);
  const after = await bexRows();
  const unkiu = (after || []).filter((r) => r.sub === 'Sub3' && r.needed === 'Unkiu');
  check(unkiu.length === 4, `3 days: Sub3's four Unkiu parts for rank 85: ${JSON.stringify(unkiu)}`);
  check(unkiu.every((r) => r.rank === '85' && /^in 1d [5-7]h \(/.test(r.due)), 'due in about 1d 6h: ' + unkiu.map((r) => r.due).join(', '));
  check(after.filter((r) => r.sub === 'Sub3' && r.needed === 'Whale').every((r) => r.due === 'now'), "today's parts say now");
  check(await ev(`localStorage.getItem('partsLookAhead')`) === '3', 'remembered on this PC');
  await shot('parts-look-ahead-detail');

  // Summary: Needed Now and Coming Up.
  await clickText('.controls button', 'Summary');
  await waitFor(`[...document.querySelectorAll('thead th')].some(th => /coming up/i.test(th.innerText))`, 'the Coming Up column', 20000);
  const unkiuRows = await ev(`(() => {
    const heads = [...document.querySelectorAll('thead th')].map(th => th.innerText.trim().replace(/[\\u25B2\\u25BC]/g, '').trim().toLowerCase());
    return [...document.querySelectorAll('tbody tr')].map(tr => Object.fromEntries([...tr.children].map((td, i) => [heads[i], td.innerText.trim()]))).filter(r => r['needed class'] === 'Unkiu');
  })()`);
  check(unkiuRows.length === 4 && unkiuRows.every((r) => r['needed now'] === '0' && Number(r['coming up']) >= 1), 'Unkiu parts counted as coming up: ' + JSON.stringify(unkiuRows));
  await shot('parts-look-ahead-summary');

  // Shopping List: works with it on.
  await clickText('.controls button', 'Shopping List');
  await waitFor(`!!document.querySelector('.shopping-list') || [...document.querySelectorAll('.status, .error')].some(e => !/Working out/.test(e.innerText))`, 'the shopping list', 30000);
  // The test data only has recipes for Whale parts, so the Unkiu ones are named as having none.
  const note = await ev(`(document.querySelector('.error') || {}).innerText || ''`);
  check(await ev(`!!document.querySelector('.shopping-list')`) && (!note || /^No recipe found for Item 2179[6-9]/.test(note)), 'the list shows, with the Unkiu parts on it: ' + note);
  const parts = await ev(`window.api.getShoppingList({ aheadDays: 3 })`);
  const nowOnly = await ev(`window.api.getShoppingList({ aheadDays: 0 })`);
  const count = (l) => (l.parts || []).reduce((n, p) => n + p.need, 0);
  check(parts.success && nowOnly.success && count(parts) > count(nowOnly), `more parts on the list looking ahead: ${count(nowOnly)} -> ${count(parts)}`);
};

module.exports.before = async (db) => {
  await db.query('DELETE FROM companion_rankup_forecast');
  await db.query(`DELETE FROM companion_metric_history WHERE subject_id = ${BEX} AND metric LIKE 'sub\\_%'`);
  await db.query(`INSERT INTO companion_metric_history (recorded_at, subject_type, subject_id, metric, value) VALUES
    (now() - interval '40 hours', 'character', ${BEX}, 'sub_rank:2', 82),
    (now() - interval '2 hours', 'character', ${BEX}, 'sub_rank:2', 83)`);
  await db.query(`INSERT INTO companion_rankup_forecast (cid, slot, rank, made_at, predicted_at, sub_name) VALUES
    (${BEX}, 2, 83, now() - interval '30 hours', now() - interval '5 hours', 'Sub2'),
    (${BEX}, 2, 83, now() - interval '3 hours', now() - interval '2 hours', 'Sub2')`);
  const sub3 = (await db.query(`SELECT return_time FROM companion_submarine_snapshot WHERE cid = ${BEX} AND sub_name = 'Sub3'`)).rows[0];
  sub3ReturnTime = sub3 ? sub3.return_time : null;
  await db.query(`UPDATE companion_submarine_snapshot SET return_time = floor(extract(epoch FROM now() + interval '1 hour')) WHERE cid = ${BEX} AND sub_name = 'Sub3'`);
  await db.query(`INSERT INTO sub_build_rules (rank, cid_override, sub_filter, hull, stern, bow, bridge) VALUES (85, ${BEX}, 'Sub3', 'U', 'U', 'U', 'U')`);
};

module.exports.after = async (db) => {
  await db.query('DELETE FROM companion_rankup_forecast');
  await db.query(`DELETE FROM companion_metric_history WHERE subject_id = ${BEX} AND metric LIKE 'sub\\_%'`);
  if (sub3ReturnTime !== null) await db.query(`UPDATE companion_submarine_snapshot SET return_time = $1 WHERE cid = ${BEX} AND sub_name = 'Sub3'`, [sub3ReturnTime]);
  await db.query(`DELETE FROM sub_build_rules WHERE rank = 85 AND cid_override = ${BEX}`);
};
