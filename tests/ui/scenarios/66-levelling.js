// Sub Calculator → Levelling Plan (tests/ui/fixtures.sql: Deep-sea Site's O, J and Z, rank 1 each; 10,000 experience a
// rank up to 90). A sub's stages to a target rank, a closer target, the FC's sectors limiting the routes (and saying
// what a sector not discovered yet would add), part suggestions, every sub in a Free Company, and Open in Planner.
module.exports = async (t) => {
  const { ev, waitFor, check, nav } = t;
  const setSelect = (selector, value) => ev(`(() => { const s = ${selector};
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, ${JSON.stringify(String(value))});
    s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  const button = (text) => ev(`[...document.querySelectorAll('.lv button')].find((b) => b.innerText.trim() === ${JSON.stringify(text)}).click()`);
  const settled = `!document.querySelector('.lv .working')`;
  const voyages = () => ev(`Number(document.querySelectorAll('.lv-sum .v')[1].innerText.replace(/,/g, ''))`);

  await nav('Levelling Plan');
  await waitFor(`!!document.querySelector('.lv .planner-picker-button')`, 'the Levelling Plan', 20000);
  // A sub below the top rank (90).
  await ev(`document.querySelector('.lv .planner-picker-button').click()`);
  await waitFor(`document.querySelectorAll('.planner-picker-sub').length > 0`, 'the sub picker', 5000);
  const level = await ev(`(() => { const b = [...document.querySelectorAll('.planner-picker-sub')].find((x) => Number(x.children[1].innerText.replace(/\\D/g, '')) < 90);
    const r = Number(b.children[1].innerText.replace(/\\D/g, '')); b.click(); return r; })()`);
  await waitFor(`document.querySelectorAll('.lv-stage').length > 0 && ${settled}`, 'the stages', 30000);
  // Its Free Company's sectors as the plugin read them: O explored, J and Z not discovered.
  const fc = await ev(`document.querySelector('.lv .fc-picker').dataset.fc`);
  await t.query(`DELETE FROM companion_fc_sub_sector`);
  await t.query(`INSERT INTO companion_fc_sub_sector (fc_id, sector_id, unlocked, explored, read_at, cid) VALUES
    (${fc}, 1, true, true, now(), 1), (${fc}, 2, false, false, now(), 1), (${fc}, 3, false, false, now(), 1)`);
  await ev(`[...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Refresh').click()`);
  await waitFor(`/read at the workshop/.test(document.querySelector('.lv').innerText) && document.querySelectorAll('.lv-stage').length > 0 && ${settled}`, 'the read sectors', 30000);
  await t.shot('levelling');
  // A refresh that changes nothing the plan uses keeps the plan (no working again); one that changes the chosen sub's
  // experience plans again from its new experience.
  await ev(`(() => { window.__lvWorked = false; window.__lvObs = new MutationObserver(() => { if (document.querySelector('.lv .working')) window.__lvWorked = true; });
    window.__lvObs.observe(document.querySelector('.lv'), { subtree: true, childList: true, attributes: true }); return true; })()`);
  const expText = () => ev(`document.querySelectorAll('.lv-sum .n')[0].innerText`);
  const expBefore = await expText();
  await ev(`[...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Refresh').click()`);
  await new Promise((r) => setTimeout(r, 4000));
  check(!(await ev(`window.__lvWorked`)), 'a refresh that changes nothing keeps the plan');
  await t.query(`UPDATE companion_submarine_snapshot SET current_exp = current_exp + 500 WHERE level = ${level}`);
  await ev(`[...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Refresh').click()`);
  await waitFor(`document.querySelectorAll('.lv-sum .n')[0].innerText !== ${JSON.stringify(expBefore)} && ${settled}`, 'the plan from the new experience', 30000);
  check(await ev(`window.__lvWorked`), `a refresh with new experience plans again (${await expText()} instead of ${expBefore})`);
  await ev(`window.__lvObs.disconnect()`);
  await t.query(`UPDATE companion_submarine_snapshot SET current_exp = current_exp - 500 WHERE level = ${level}`);
  await ev(`[...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Refresh').click()`);
  await waitFor(`document.querySelectorAll('.lv-sum .n')[0].innerText === ${JSON.stringify(expBefore)} && ${settled}`, 'the plan back as it was', 30000);
  // The chance a voyage opens a sector, shown with the FC's own sectors; a sector's hover names its map and rank.
  t.check(await ev(`document.querySelector('.lv .lv-chance input') && document.querySelector('.lv .lv-chance input').value === '25'`), 'the chance to open a sector shows, 25% to start with');
  const hover = await ev(`document.querySelector('.lv .lv-table .rf-letter').title`);
  t.check(/ · Deep-sea Site · rank \d+$/.test(hover), `a sector's hover names its map and rank (${hover})`);

  const ranks = await ev(`document.querySelectorAll('.lv-sum .v')[0].innerText`);
  check(new RegExp(`^${level} → \\d+$`).test(ranks), `the plan runs from the sub's rank (${ranks})`);
  const strip = await ev(`[document.querySelectorAll('.lv-strip span').length, document.querySelectorAll('.lv-stage').length]`);
  check(strip[0] === strip[1] && strip[0] > 0, `a strip piece per stage (${strip.join(' / ')})`);
  const routes = await ev(`[...document.querySelectorAll('.lv-stage')].map((s) => [...s.querySelectorAll('.rf-route .rf-letter')].map((l) => l.innerText).join(''))`);
  check(routes.every((r) => r === 'O'), `only through sectors the FC has discovered (${routes.join(', ')})`);
  // The stages are the shared table: a Columns menu, and headers that sort; the swap rows only in plan order.
  const heads = await ev(`[...document.querySelectorAll('.lv-table thead th')].map((th) => th.innerText.trim().toLowerCase())`);
  const picker = await ev(`!!document.querySelector('.lv .finder-columns button')`);
  check(heads.join('|').startsWith('ranks|time|voyages|route|parts') && heads.includes('exp an hour') && picker,
    `the stages are a table with the usual columns (${heads.join(', ')})`);
  const better = await ev(`document.querySelector('.lv-better') ? document.querySelector('.lv-better').innerText : ''`);
  check(/^J isn't discovered yet: with it, (O-J|J-O)\S* gives [\d,.]+% more an hour\.$/.test(better), `a stage says what an undiscovered sector would add (${better})`);
  const time = await ev(`document.querySelectorAll('.lv-sum .n')[2].innerText`);
  check(/^rank \d+ around (\d+ \w+|\w+ \d+)/.test(time), `and when it gets there (${time})`);

  // The target starts at the sub's next build (else the top rank); a further one takes more voyages.
  const before = await voyages();
  const last = await ev(`(() => { const o = document.querySelector('.lv select').options; return o[o.length - 1].value; })()`);
  await setSelect(`document.querySelector('.lv select')`, last);
  await waitFor(`document.querySelectorAll('.lv-sum .v')[0].innerText.endsWith('→ ${last}') && ${settled}`, 'the further target', 20000);
  check((await voyages()) > before, `a further target takes more voyages (${await voyages()} instead of ${before})`);
  // Reset target: back to the sub's next build.
  await button('Reset target');
  await waitFor(`!/→ ${last}$/.test(document.querySelectorAll('.lv-sum .v')[0].innerText) && ${settled}`, 'the target reset', 20000);
  check((await voyages()) === before && !(await ev(`[...document.querySelectorAll('.lv button')].some((b) => b.innerText.trim() === 'Reset target')`)),
    `Reset target goes back to the next build (${await voyages()} voyages)`);

  // Suggest part changes: a Standard parts only box, and either swaps or a line saying there are none.
  await button('Suggest changes on the way');
  const standardBox = `[...document.querySelectorAll('.lv label.finder-check')].find((l) => /Standard parts only/.test(l.innerText))`;
  await waitFor(`!!${standardBox} && ${settled}`, 'suggestions', 30000);
  await ev(`${standardBox}.querySelector('input').click()`);
  await waitFor(`(document.querySelectorAll('.lv-swap').length > 0 || /No part swap to a Standard part makes this plan shorter/.test(document.querySelector('.lv').innerText)) && ${settled}`, 'Standard parts only', 30000);
  const swaps = await ev(`[...document.querySelectorAll('.lv-swap b')].map((b) => b.innerText)`);
  check(swaps.every((s) => !/Modified/.test(s)), `Standard parts only suggests no Modified part (${swaps.join('; ') || 'none'})`);
  const partsShown = await ev(`[...document.querySelectorAll('.lv-stage')].map((s) => [...s.querySelectorAll('.lv-part')].map((p) => p.textContent).join(' '))`);
  check(partsShown.every((p) => /^([A-Z]\+? ){3}[A-Z]\+?$/.test(p)), `each stage's parts in their own column (${partsShown[0]})`);
  await button('Keep this build');

  // Use every sector: the full-map plan, as if every sector were discovered, takes no longer and has nothing left to discover.
  const readHours = await ev(`document.querySelectorAll('.lv-sum .v')[2].innerText`);
  const readVoyages = await voyages();
  await ev(`[...document.querySelectorAll('.lv label.finder-check')].find((l) => /Use every sector/.test(l.innerText)).querySelector('input').click()`);
  await waitFor(`/Every sector, as if all were discovered/.test(document.querySelector('.lv').innerText) && ${settled}`, 'every sector', 30000);
  await waitFor(`!document.querySelector('.lv-better') && ${settled}`, 'the full-map plan', 30000);
  check((await voyages()) <= readVoyages, `every sector takes no more voyages (${await voyages()} instead of ${readVoyages}; ${readHours} before)`);
  const everyRoutes = await ev(`[...document.querySelectorAll('.lv-stage')].map((s) => [...s.querySelectorAll('.rf-route .rf-letter')].map((l) => l.innerText).join(''))`);
  check(everyRoutes.some((r) => r !== 'O'), `and goes through the sectors not discovered yet (${everyRoutes.join(', ')})`);
  await ev(`[...document.querySelectorAll('.lv label.finder-check')].find((l) => /Use every sector/.test(l.innerText)).querySelector('input').click()`);
  await waitFor(`!!document.querySelector('.lv-better') && ${settled}`, 'back to the FC\'s sectors', 30000);

  // Every sub in its Free Company.
  await button('Every sub in a Free Company');
  await waitFor(`document.querySelectorAll('.lv-fleet tbody tr').length > 0 && ${settled}`, 'the FC table', 30000);
  await t.shot('levelling-fc');
  const rows = await ev(`[...document.querySelectorAll('.lv-fleet tbody tr')].map((tr) => tr.innerText.replace(/\\s+/g, ' '))`);
  check(rows.every((r) => /about [\d.,]+ (days|h) · (\d+ \w+|\w+ \d+)|top rank|stops at rank/.test(r)), `a line per sub, with when it gets there (${rows[0]})`);
  await ev(`[...document.querySelectorAll('.lv-fleet button')].find((b) => b.innerText === 'Stages').click()`);
  await waitFor(`document.querySelectorAll('.lv-stage').length > 0 && ${settled}`, 'one sub again', 30000);
  check(true, 'Stages opens that sub on its own');

  // Clear sub: no sub chosen, the build and its plan kept.
  await button('Clear sub');
  await waitFor(`/Choose one of your subs/.test(document.querySelector('.lv .planner-picker-button').innerText) && document.querySelectorAll('.lv-stage').length > 0 && ${settled}`, 'no sub chosen', 20000);
  check(true, 'Clear sub goes back to no sub, the plan kept');

  // Open in Planner.
  const stops = await ev(`document.querySelector('.lv-stage').querySelectorAll('.rf-route .rf-letter').length`);
  await ev(`document.querySelector('.lv-stage .finder-open').click()`);
  await waitFor(`document.querySelectorAll('.planner-chip').length === ${stops} && document.querySelectorAll('.planner-stat').length === 5`, 'the Planner', 15000);
  check(true, 'Open in Planner loads the stage');
  await t.query(`DELETE FROM companion_fc_sub_sector`);
};
