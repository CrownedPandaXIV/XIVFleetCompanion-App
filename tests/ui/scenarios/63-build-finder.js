// Sub Calculator → Build Finder: add sectors, ask for a loot tier and optimal retrieval, and the page lists the builds
// that reach it (sectors 1 and 2 have XIVStats data; tests/ui/fixtures.sql gives every rank and part made-up stats),
// with what it needs, a sort, and Open in Planner.
module.exports = async (t) => {
  const { ev, waitFor, check, nav } = t;
  const setSelect = (selector, value) => ev(`(() => { const s = ${selector};
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, ${JSON.stringify(String(value))});
    s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await nav('Build Finder');
  await waitFor(`document.body.innerText.includes('What you want')`, 'the Build Finder', 20000);

  // Add the first two sectors with data on the map.
  for (let i = 0; i < 2; i++) {
    await ev(`(() => { const s = [...document.querySelectorAll('.finder-goals select')][1];
      const o = [...s.options].find((x) => !x.text.includes('no loot data'));
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, o.value);
      s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await ev(`[...document.querySelectorAll('.finder-goals button')].find((b) => b.innerText === 'Add').click()`);
    await waitFor(`document.querySelectorAll('.finder-goal').length === ${i + 1}`, `sector ${i + 1} added`, 5000);
  }
  // T2 on the first, optimal retrieval on the second.
  await setSelect(`document.querySelector('.finder-goal select')`, 2);
  await ev(`[...document.querySelectorAll('.finder-goal')][1].querySelector('input[type=checkbox]').click()`);
  await waitFor(`document.querySelectorAll('.finder table tbody tr').length > 0 && /builds? reach it/.test(document.body.innerText)`, 'the builds', 30000);
  await t.shot('build-finder');

  const text = await ev('document.body.innerText');
  check(/Needs\s*surveillance [\d,–]+/.test(text) && /retrieval [\d,–]+/.test(text), 'it says what the goals need');
  check(/rank \d+\+ for these sectors/.test(text) && /range \d+ \(best order/.test(text), 'and the rank and range the sectors need');
  const rows = await ev(`document.querySelectorAll('.finder table tbody tr').length`);
  const total = await ev(`(() => { const m = document.body.innerText.match(/([\\d,]+) builds? reach it/); return m ? Number(m[1].replace(/,/g, '')) : 0; })()`);
  check(rows > 0 && rows <= 200 && total >= rows, `the builds are listed (${rows} shown of ${total})`);
  const ranks = await ev(`[...document.querySelectorAll('.finder table tbody tr')].map((tr) => parseInt(tr.querySelector('td').innerText, 10))`);
  check(ranks.every((r, i) => i === 0 || r >= ranks[i - 1] || document.querySelectorAll('.finder table tbody tr')[i].classList.contains('finder-out')),
    'lowest rank first');

  // Fastest voyage first.
  await setSelect(`document.querySelector('.finder-options select')`, 'speed');
  await waitFor(`!document.body.innerText.includes('Working out')`, 'the new order', 20000);
  // In range first, then out of range; each part fastest first.
  const voyages = await ev(`[...document.querySelectorAll('.finder table tbody tr')].map((tr) => {
    const td = [...tr.querySelectorAll('td')][7].innerText.match(/(\\d+)h (\\d+)m/);
    return { out: tr.classList.contains('finder-out'), minutes: td ? Number(td[1]) * 60 + Number(td[2]) : null }; })`);
  check(voyages.length > 0 && voyages.every((v, i) => v.minutes !== null && (i === 0 || (v.out === voyages[i - 1].out ? v.minutes >= voyages[i - 1].minutes : v.out))),
    `sorted by fastest voyage, in range first (${voyages[0] && voyages[0].minutes} to ${voyages.length && voyages[voyages.length - 1].minutes} minutes)`);

  // Open the first build in the Planner: its rank, parts and the two sectors.
  const firstRank = await ev(`parseInt(document.querySelector('.finder table tbody td').innerText, 10)`);
  await ev(`[...document.querySelectorAll('.finder table tbody button')].find((b) => b.innerText === 'Open in Planner').click()`);
  await waitFor(`document.querySelectorAll('.planner-chip').length === 2 && document.querySelectorAll('.planner-stat').length === 5`, 'the Planner with that build', 15000);
  const rank = await ev(`Number(document.querySelector('.planner-fields input[type=number]').value)`);
  check(rank === firstRank, `Open in Planner loads the build at its rank (${rank}) and both sectors`);
};
