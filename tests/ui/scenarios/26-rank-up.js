// Subs: Next Rank and Next Build. Bex Kitteh 1's subs are ranks 82-85 (10,000 experience per rank in the
// test data), on route O-J: 3,000 experience a voyage, about 14.9 hours at their speed.
//   Sub1 (rank 82, 1,000 in, back in about an hour): calculated, 9,000 more = 3 voyages, so about 1 hour +
//        2 x 14.9 hours = "≈ in 1d 6h"
//   Sub2 (rank 83, 2,000 in, in port): its recorded collections gave 4,500 each, 1.5 times its route's 3,000,
//        so voyage by voyage 8,000 more takes 2 voyages from now: "in 1d 5h" (no ≈, its own bonus measured)
//   Sub4 (rank 85, 4,000 in, back in 5 days): no voyages recorded, so calculated: 3,000 when it is back and
//        3,000 a voyage after, so 2 voyages: "≈ in 5d 14h", never before it is back
//   Sub3 is set back an hour ago, waiting to be collected, for sorting by Status.
// A Sub Rules rule for rank 88 (all Syldra) is added, so the next build for these subs is YYYY at 88.
// Gus Kitteh 6's Sub4 is rank 90, the highest in the test data; Fight Club's all-Whale O-J-Z build pays more
// than its own, so Next Build still says so (see 45-fight-club-next-build.js).
const BEX = '18014498578000001';
// Sub1's return time when the test data was made; it is set to an hour from now for the test (the answer
// depends on it), and put back after.
let sub1ReturnTime = null;
let otherReturnTimes = [];

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
  check(sub2 && /^in 1d [45]h$/.test(sub2[iRank].text), 'voyage by voyage with its own bonus, no ≈: ' + (sub2 && sub2[iRank].text));
  check(sub2 && /\(2 voyages\)\. Worked out voyage by voyage: 4,500 experience a voyage on its route, including its bonus \(×1\.50 from its last 4 voyages\)/.test(sub2[iRank].title),
    'its bonus from its recorded voyages on hover: ' + (sub2 && sub2[iRank].title));

  const sub4 = await subRow('Bex Kitteh 1', 'Sub4');
  check(sub4 && /^≈ in 5d 1[345]h$/.test(sub4[iRank].text), 'out at sea: its experience comes when it is back, then a voyage at a time: ' + (sub4 && sub4[iRank].text));
  check(sub4 && /\(2 voyages\)\. Calculated from its route/.test(sub4[iRank].title), 'counted in voyages on hover: ' + (sub4 && sub4[iRank].title));

  // Current Route: the map's number before the letters, its name on hover.
  const iRoute = heads.indexOf('current route');
  check(sub1 && sub1[iRoute].text === '1 · O-J' && sub1[iRoute].title === 'Deep-sea Site', 'the route has its map: ' + (sub1 && `${sub1[iRoute].text} (${sub1[iRoute].title})`));

  // Sorting by Status: by when each sub is back, across the fleet. Back and waiting first, then out at
  // sea soonest first, then in port.
  await ev(`[...document.querySelector('thead').querySelectorAll('th')].find(th => th.innerText.trim().toLowerCase().startsWith('status')).querySelector('span').click()`);
  await waitFor(`document.querySelectorAll('.account-group').length === 0`, 'one table for the fleet', 5000);
  const statuses = await ev(`(() => {
    const i = [...document.querySelector('thead').querySelectorAll('th')].findIndex(th => th.innerText.trim().toLowerCase().startsWith('status'));
    return [...document.querySelectorAll('tbody tr')].map(r => r.children[i].innerText.trim());
  })()`);
  const kind = (s) => (s.startsWith('Returned') ? 0 : /^\d+:\d\d:\d\d$/.test(s) ? 1 : 2);
  const secs = (s) => s.split(':').reduce((a, n) => a * 60 + Number(n), 0);
  const ordered = statuses.every((s, i) => i === 0 || kind(statuses[i - 1]) < kind(s)
    || (kind(statuses[i - 1]) === kind(s) && (kind(s) !== 1 || secs(statuses[i - 1]) <= secs(s))));
  check(statuses.length > 0 && kind(statuses[0]) === 0 && kind(statuses[statuses.length - 1]) === 2 && ordered,
    'Status sorts by return: waiting first, then soonest back, in port last: ' + statuses.slice(0, 4).join(', ') + ' ... ' + statuses.slice(-2).join(', '));
  await ev(`[...document.querySelectorAll('.controls button')].find(b => b.innerText.trim() === 'Reset Sorting').click()`);

  const gus = await subRow('Gus Kitteh 6', 'Sub4');
  check(gus && gus[iRank].text === 'Max rank' && gus[iBuild].text === 'WWWW at 90 · now', 'the highest rank, still told of a better-paying build from Fight Club: ' + (gus && gus.slice(iRank, iBuild + 1).map((c) => c.text).join(' | ')));
};

module.exports.before = async (db) => {
  const sub1 = (await db.query(`SELECT return_time FROM companion_submarine_snapshot WHERE cid = ${BEX} AND sub_name = 'Sub1'`)).rows[0];
  sub1ReturnTime = sub1 ? sub1.return_time : null;
  await db.query(`UPDATE companion_submarine_snapshot SET return_time = floor(extract(epoch FROM now() + interval '1 hour')) WHERE cid = ${BEX} AND sub_name = 'Sub1'`);
  otherReturnTimes = (await db.query(`SELECT sub_name, return_time FROM companion_submarine_snapshot WHERE cid = ${BEX} AND sub_name IN ('Sub3', 'Sub4')`)).rows;
  await db.query(`UPDATE companion_submarine_snapshot SET return_time = floor(extract(epoch FROM now() - interval '1 hour')) WHERE cid = ${BEX} AND sub_name = 'Sub3'`);
  await db.query(`UPDATE companion_submarine_snapshot SET return_time = floor(extract(epoch FROM now() + interval '5 days')) WHERE cid = ${BEX} AND sub_name = 'Sub4'`);
  await db.query(`DELETE FROM companion_metric_history WHERE subject_id = ${BEX} AND metric LIKE 'sub\\_%'`);
  await db.query(`INSERT INTO companion_metric_history (recorded_at, subject_type, subject_id, metric, value) VALUES
    (now() - interval '60 hours', 'character', ${BEX}, 'sub_rank:2', 81),
    (now() - interval '60 hours', 'character', ${BEX}, 'sub_exp:2', 4000),
    (now() - interval '45 hours', 'character', ${BEX}, 'sub_rank:2', 81),
    (now() - interval '45 hours', 'character', ${BEX}, 'sub_exp:2', 8500),
    (now() - interval '30 hours', 'character', ${BEX}, 'sub_rank:2', 82),
    (now() - interval '30 hours', 'character', ${BEX}, 'sub_exp:2', 3000),
    (now() - interval '15 hours', 'character', ${BEX}, 'sub_rank:2', 82),
    (now() - interval '15 hours', 'character', ${BEX}, 'sub_exp:2', 7500),
    (now(), 'character', ${BEX}, 'sub_rank:2', 83),
    (now(), 'character', ${BEX}, 'sub_exp:2', 2000),
    (now() - interval '5 days', 'character', ${BEX}, 'sub_rank:4', 84),
    (now() - interval '5 days', 'character', ${BEX}, 'sub_exp:4', 0),
    (now(), 'character', ${BEX}, 'sub_rank:4', 85),
    (now(), 'character', ${BEX}, 'sub_exp:4', 4000)`);
  await db.query(`INSERT INTO sub_build_rules (rank, sub_filter, hull, stern, bow, bridge) VALUES (88, '', 'Y', 'Y', 'Y', 'Y')`);
};

module.exports.after = async (db) => {
  if (sub1ReturnTime !== null) await db.query(`UPDATE companion_submarine_snapshot SET return_time = $1 WHERE cid = ${BEX} AND sub_name = 'Sub1'`, [sub1ReturnTime]);
  for (const r of otherReturnTimes) await db.query(`UPDATE companion_submarine_snapshot SET return_time = $1 WHERE cid = ${BEX} AND sub_name = $2`, [r.return_time, r.sub_name]);
  await db.query(`DELETE FROM companion_metric_history WHERE subject_id = ${BEX} AND metric LIKE 'sub\\_%'`);
  await db.query(`DELETE FROM sub_build_rules WHERE rank = 88`);
};
