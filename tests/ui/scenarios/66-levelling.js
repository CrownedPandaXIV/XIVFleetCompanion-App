// Sub Calculator → Levelling Plan (tests/ui/fixtures.sql: Deep-sea Site's O, J and Z, rank 1 each; 10,000 experience a
// rank up to 90). A sub's stages to a target rank, a closer target, the FC's sectors limiting the routes (and saying
// what a sector not discovered yet would add), part suggestions, every sub in a Free Company, and Open in Planner.
module.exports = async (t) => {
  const { ev, waitFor, check, nav } = t;
  const setSelect = (selector, value) => ev(`(() => { const s = ${selector};
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, ${JSON.stringify(String(value))});
    s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  const button = (text) => ev(`[...document.querySelectorAll('.lv button')].find((b) => b.innerText.trim() === ${JSON.stringify(text)}).click()`);
  const settled = `!/working out/.test(document.querySelector('.lv').innerText)`;
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
  const fc = await ev(`document.querySelector('.lv span.finder-field select').value`);
  await t.query(`DELETE FROM companion_fc_sub_sector`);
  await t.query(`INSERT INTO companion_fc_sub_sector (fc_id, sector_id, unlocked, explored, read_at, cid) VALUES
    (${fc}, 1, true, true, now(), 1), (${fc}, 2, false, false, now(), 1), (${fc}, 3, false, false, now(), 1)`);
  await ev(`[...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Refresh').click()`);
  await waitFor(`/read at the workshop/.test(document.querySelector('.lv').innerText) && document.querySelectorAll('.lv-stage').length > 0 && ${settled}`, 'the read sectors', 30000);
  await t.shot('levelling');

  const ranks = await ev(`document.querySelectorAll('.lv-sum .v')[0].innerText`);
  check(new RegExp(`^${level} → \\d+$`).test(ranks), `the plan runs from the sub's rank (${ranks})`);
  const strip = await ev(`[document.querySelectorAll('.lv-strip span').length, document.querySelectorAll('.lv-stage').length]`);
  check(strip[0] === strip[1] && strip[0] > 0, `a strip piece per stage (${strip.join(' / ')})`);
  const routes = await ev(`[...document.querySelectorAll('.lv-stage')].map((s) => [...s.querySelectorAll('.rf-route .rf-letter')].map((l) => l.innerText).join(''))`);
  check(routes.every((r) => r === 'O'), `only through sectors the FC has discovered (${routes.join(', ')})`);
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

  // Suggest part changes: a Standard parts only box, and either swaps or a line saying there are none.
  await button('Suggest changes on the way');
  await waitFor(`!!document.querySelector('.lv .finder-check input') && ${settled}`, 'suggestions', 30000);
  await ev(`document.querySelector('.lv .finder-check input').click()`);
  await waitFor(`(document.querySelectorAll('.lv-swap').length > 0 || /No part swap to a Standard part makes this plan shorter/.test(document.querySelector('.lv').innerText)) && ${settled}`, 'Standard parts only', 30000);
  const swaps = await ev(`[...document.querySelectorAll('.lv-swap b')].map((b) => b.innerText)`);
  check(swaps.every((s) => !/Modified/.test(s)), `Standard parts only suggests no Modified part (${swaps.join('; ') || 'none'})`);
  await button('Keep this build');

  // Every sub in its Free Company.
  await button('Every sub in a Free Company');
  await waitFor(`document.querySelectorAll('.lv-fleet tbody tr').length > 0 && ${settled}`, 'the FC table', 30000);
  await t.shot('levelling-fc');
  const rows = await ev(`[...document.querySelectorAll('.lv-fleet tbody tr')].map((tr) => tr.innerText.replace(/\\s+/g, ' '))`);
  check(rows.every((r) => /about [\d.,]+ (days|h) · (\d+ \w+|\w+ \d+)|top rank|stops at rank/.test(r)), `a line per sub, with when it gets there (${rows[0]})`);
  await ev(`[...document.querySelectorAll('.lv-fleet button')].find((b) => b.innerText === 'Stages').click()`);
  await waitFor(`document.querySelectorAll('.lv-stage').length > 0 && ${settled}`, 'one sub again', 30000);
  check(true, 'Stages opens that sub on its own');

  // Open in Planner.
  const stops = await ev(`document.querySelector('.lv-stage').querySelectorAll('.rf-route .rf-letter').length`);
  await ev(`document.querySelector('.lv-stage .finder-open').click()`);
  await waitFor(`document.querySelectorAll('.planner-chip').length === ${stops} && document.querySelectorAll('.planner-stat').length === 5`, 'the Planner', 15000);
  check(true, 'Open in Planner loads the stage');
  await t.query(`DELETE FROM companion_fc_sub_sector`);
};
