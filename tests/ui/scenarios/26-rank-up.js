// Subs: Next Rank and Next Build. Bex Kitteh 1's subs are ranks 82-85 (10,000 experience per rank in the
// test data), on route O-J: 3,000 experience a voyage, about 14.9 hours at their speed.
//   Sub1 (rank 82, 1,000 in, back in about an hour): calculated, 9,000 more = 3 voyages, so about 1 hour +
//        2 x 14.9 hours = "≈ in 1d 6h"
//   Sub2 (rank 83, 2,000 in): measured from its recorded history, rank 82 with 0 five days ago, so 12,000
//        in 5 days = 2,400 a day, and 8,000 more takes 3.3 days = "in 3d 8h" (no ≈)
// A Sub Rules rule for rank 88 (all Syldra) is added, so the next build for these subs is YYYY at 88.
// Gus Kitteh 6's Sub4 is rank 90, the highest in the test data.
const BEX = '18014498578000001';
// Sub1's return time when the test data was made; it is set to an hour from now for the test (the answer
// depends on it), and put back after.
let sub1ReturnTime = null;

module.exports = async (t) => {
  const { ev, sleep, waitFor, check, nav, shot } = t;
  await ev(`window.localStorage.clear()`);
  await nav('Subs');
  await waitFor(`document.querySelectorAll('tbody tr').length > 0`, 'the subs table', 20000);
  await sleep(400);
  await shot('subs-rank-up');

  const heads = await ev(`[...document.querySelector('thead').querySelectorAll('th')].map(th => th.innerText.trim().toLowerCase().replace(/[\\u25B2\\u25BC]/g, '').trim())`);
  const iRank = heads.indexOf('next rank');
  const iBuild = heads.indexOf('next build');
  check(iRank > 0 && iBuild === iRank + 1 && heads[iRank - 1] === 'rank', 'Next Rank and Next Build follow Rank: ' + heads.join(', '));

  const subRow = (character, sub) => ev(`(() => {
    const group = [...document.querySelectorAll('.account-group')].find(g => {
      const h = g.querySelector('h2');
      return h && new RegExp('^' + ${JSON.stringify(character)} + '(\\\\D|$)').test(h.innerText.trim());
    });
    const tr = group && [...group.querySelectorAll('tbody tr')].find(r => r.children[0].innerText.trim() === ${JSON.stringify(sub)});
    return tr ? [...tr.children].map(td => ({ text: td.innerText.trim(), title: (td.querySelector('[title]') || td).title })) : null;
  })()`);

  const sub1 = await subRow('Bex Kitteh 1', 'Sub1');
  check(sub1 && sub1[iRank].text === '≈ in 1d 6h', 'calculated from the route, marked ≈: ' + (sub1 && sub1[iRank].text));
  check(sub1 && /^Rank 83 about .*\(3 voyages\)\. Calculated from its route: 3,000 experience per 14\.\dh voyage/.test(sub1[iRank].title),
    'the date, voyages and how it was worked out on hover: ' + (sub1 && sub1[iRank].title));
  check(sub1 && /^YYYY at 88 · ≈ in \d+d/.test(sub1[iBuild].text), 'next build from Sub Rules, with when: ' + (sub1 && sub1[iBuild].text));

  const sub2 = await subRow('Bex Kitteh 1', 'Sub2');
  check(sub2 && /^in 3d [78]h$/.test(sub2[iRank].text), 'measured from recorded history, no ≈: ' + (sub2 && sub2[iRank].text));
  check(sub2 && /From its experience over the last week: 2,4\d\d a day\. Assumes it carries on as now/.test(sub2[iRank].title), 'measured rate on hover, with what it assumes: ' + (sub2 && sub2[iRank].title));

  const gus = await subRow('Gus Kitteh 6', 'Sub4');
  check(gus && gus[iRank].text === 'Max rank' && gus[iBuild].text === '—', 'the highest rank: ' + (gus && gus.slice(iRank, iBuild + 1).map((c) => c.text).join(' | ')));
};

module.exports.before = async (db) => {
  const sub1 = (await db.query(`SELECT return_time FROM companion_submarine_snapshot WHERE cid = ${BEX} AND sub_name = 'Sub1'`)).rows[0];
  sub1ReturnTime = sub1 ? sub1.return_time : null;
  await db.query(`UPDATE companion_submarine_snapshot SET return_time = floor(extract(epoch FROM now() + interval '1 hour')) WHERE cid = ${BEX} AND sub_name = 'Sub1'`);
  await db.query(`DELETE FROM companion_metric_history WHERE subject_id = ${BEX} AND metric LIKE 'sub\\_%'`);
  await db.query(`INSERT INTO companion_metric_history (recorded_at, subject_type, subject_id, metric, value) VALUES
    (now() - interval '5 days', 'character', ${BEX}, 'sub_rank:2', 82),
    (now() - interval '5 days', 'character', ${BEX}, 'sub_exp:2', 0),
    (now(), 'character', ${BEX}, 'sub_rank:2', 83),
    (now(), 'character', ${BEX}, 'sub_exp:2', 2000)`);
  await db.query(`INSERT INTO sub_build_rules (rank, sub_filter, hull, stern, bow, bridge) VALUES (88, '', 'Y', 'Y', 'Y', 'Y')`);
};

module.exports.after = async (db) => {
  if (sub1ReturnTime !== null) await db.query(`UPDATE companion_submarine_snapshot SET return_time = $1 WHERE cid = ${BEX} AND sub_name = 'Sub1'`, [sub1ReturnTime]);
  await db.query(`DELETE FROM companion_metric_history WHERE subject_id = ${BEX} AND metric LIKE 'sub\\_%'`);
  await db.query(`DELETE FROM sub_build_rules WHERE rank = 88`);
};
