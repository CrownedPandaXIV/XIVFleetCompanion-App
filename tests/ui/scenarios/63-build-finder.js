// Sub Calculator → Build Finder: add sectors, ask for a loot tier and optimal retrieval, and the page lists the builds
// that reach it (sectors 1 and 2 have XIVStats data; tests/ui/fixtures.sql gives every rank and part made-up stats),
// with what it needs, a sort, and Open in Planner.
module.exports = async (t) => {
  const { ev, waitFor, check, nav } = t;
  const setSelect = (selector, value) => ev(`(() => { const s = ${selector};
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, ${JSON.stringify(String(value))});
    s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await nav('Build Finder');
  await waitFor(`document.querySelectorAll('.finder-band').length > 0`, 'the Build Finder', 20000);

  // Add the first two sectors with data on the map.
  for (let i = 0; i < 2; i++) {
    await ev(`(() => { const s = document.querySelectorAll('.finder-band')[0].querySelectorAll('select')[1];
      const o = [...s.options].find((x) => !x.text.includes('no loot data'));
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, o.value);
      s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await ev(`[...document.querySelectorAll('.finder-band')[0].querySelectorAll('button')].find((b) => b.innerText === 'Add').click()`);
    await waitFor(`document.querySelectorAll('.finder-goal').length === ${i + 1}`, `sector ${i + 1} added`, 5000);
  }
  // T2 on the first, optimal retrieval on the second.
  await setSelect(`document.querySelector('.finder-goal select')`, 2);
  await ev(`[...document.querySelectorAll('.finder-goal')][1].querySelector('input[type=checkbox]').click()`);
  await waitFor(`document.querySelectorAll('.finder-table tbody tr:not(.finder-group)').length > 0`, 'the builds', 30000);
  await t.shot('build-finder');

  const text = await ev('document.body.innerText');
  check(/SURVEILLANCE\s*[\d,–]+/i.test(text) && /RETRIEVAL\s*[\d,–]+/i.test(text), 'it says what the goals need, as chips');
  check(/RANK\s*\d+\+/i.test(text) && /RANGE\s*\d+\s*route/i.test(text), 'and the rank and range the sectors need');
  const tally = await ev(`document.querySelector('.finder-tally').innerText`);
  check(/[\d,]+ builds?/.test(tally) && /[\d,]+ sure/.test(tally) && /[\d,]+ out of range/.test(tally), `the counts are on one line (${tally.replace(/\s+/g, ' ')})`);
  const rows = await ev(`document.querySelectorAll('.finder-table tbody tr:not(.finder-group)').length`);
  check(rows > 0 && rows <= 200, `the builds are listed (${rows} shown)`);
  const tags = await ev(`[...document.querySelectorAll('.finder-table tbody tr:not(.finder-group)')].every((tr) => tr.querySelectorAll('.finder-part').length === 4)`);
  check(tags, 'each build shows its four parts as tags');
  // Grouped by rank (lowest first), the Rank column only while not grouped.
  const groups = await ev(`[...document.querySelectorAll('.finder-group')].map((tr) => tr.innerText)`);
  const groupRanks = groups.filter((g) => /^Rank \d+/.test(g)).map((g) => Number(g.match(/^Rank (\d+)/)[1]));
  check(groups.length > 0 && groupRanks.every((r, i) => i === 0 || r > groupRanks[i - 1]) && /builds?/.test(groups[0]), `rows are grouped by rank, lowest first (${groups.slice(0, 3).join(' | ')})`);
  check(!(await ev(`[...document.querySelectorAll('.finder-table thead th')].some((th) => th.innerText.trim().toLowerCase() === 'rank')`)), 'no Rank column while grouped');

  // With enough range (the made-up ranks' range raised for a moment, in this scratch database), the builds are in
  // range and grouped under "Rank N · how many builds".
  const was = await t.query('SELECT id, range_bonus FROM ffxiv_submarinerank ORDER BY id');
  await t.query(`UPDATE ffxiv_submarinerank SET range_bonus = '1000'`);
  await ev(`[...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Refresh').click()`);
  await waitFor(`[...document.querySelectorAll('.finder-group')].some((tr) => /^Rank \\d+/.test(tr.innerText))`, 'the rank groups', 30000);
  const inRange = await ev(`[...document.querySelectorAll('.finder-group')].map((tr) => tr.innerText.replace(/\\s+/g, ' '))`);
  const spare = await ev(`[...document.querySelectorAll('.finder-table tbody tr:not(.finder-group)')].every((tr) => /\\+\\d/.test(tr.innerText) && !tr.classList.contains('finder-out'))`);
  check(inRange.length > 0 && inRange.every((g) => /^Rank \d+ [\d,]+ builds?$/.test(g)) && spare, `in range: grouped under Rank N with how many builds, each with its range to spare (${inRange.slice(0, 2).join(' | ')})`);
  await ev(`document.querySelector('.finder-legend').scrollIntoView()`);
  await t.shot('build-finder-in-range');
  for (const r of was) await t.query(`UPDATE ffxiv_submarinerank SET range_bonus = ${r.range_bonus === null ? 'NULL' : `'${String(r.range_bonus).replace(/'/g, "''")}'`} WHERE id = '${String(r.id).replace(/'/g, "''")}'`);
  await ev(`[...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Refresh').click()`);
  await waitFor(`[...document.querySelectorAll('.finder-group')].some((tr) => /^Out of range/.test(tr.innerText))`, 'the range put back', 30000);

  // Fastest voyage first.
  await setSelect(`document.querySelector('.finder-options select')`, 'speed');
  await waitFor(`!document.body.innerText.includes('working out') && document.querySelectorAll('.finder-group').length === 0`, 'the new order', 20000);
  check(await ev(`[...document.querySelectorAll('.finder-table thead th')][0].innerText.trim().toLowerCase() === 'rank'`), 'sorted another way: one list, with the Rank column in front');
  // In range first, then out of range; each part fastest first.
  const voyages = await ev(`[...document.querySelectorAll('.finder-table tbody tr:not(.finder-group)')].map((tr) => {
    const td = [...tr.querySelectorAll('td')][7].innerText.match(/(\\d+)h (\\d+)m/);
    return { out: tr.classList.contains('finder-out'), minutes: td ? Number(td[1]) * 60 + Number(td[2]) : null }; })`);
  check(voyages.length > 0 && voyages.every((v, i) => v.minutes !== null && (i === 0 || (v.out === voyages[i - 1].out ? v.minutes >= voyages[i - 1].minutes : v.out))),
    `sorted by fastest voyage, in range first (${voyages[0] && voyages[0].minutes} to ${voyages.length && voyages[voyages.length - 1].minutes} minutes)`);

  // Open the first build in the Planner: its rank, parts and the two sectors.
  const firstRank = await ev(`parseInt(document.querySelector('.finder-table tbody tr:not(.finder-group) td').innerText, 10)`);
  await ev(`[...document.querySelectorAll('.finder-table tbody button')].find((b) => b.innerText === 'Open in Planner').click()`);
  await waitFor(`document.querySelectorAll('.planner-chip').length === 2 && document.querySelectorAll('.planner-stat').length === 5`, 'the Planner with that build', 15000);
  const rank = await ev(`Number(document.querySelector('.planner-fields input[type=number]').value)`);
  check(rank === firstRank, `Open in Planner loads the build at its rank (${rank}) and both sectors`);
};
