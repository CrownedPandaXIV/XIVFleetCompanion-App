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

  // Find an item: the name of one the first sector drops, every sector dropping it, and Add puts it on that sector.
  const itemName = await ev(`[...document.querySelector('.finder-goal').querySelectorAll('select')][1].options[1].text.replace(/ \\(T\\d\\)$/, '')`);
  await ev(`(() => { const i = document.querySelector('.finder-search input'); i.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(itemName)});
    i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await waitFor(`document.querySelectorAll('.finder-search-row').length > 0`, 'the item search', 5000);
  await t.shot('build-finder-search');
  const hit = await ev(`(() => { const item = [...document.querySelectorAll('.finder-search-item')].find((x) => x.querySelector('.finder-search-name').innerText.startsWith(${JSON.stringify(itemName)}));
    const rows = item ? [...item.querySelectorAll('.finder-search-row')] : [];
    return { rows: rows.length, text: rows.map((r) => r.innerText.replace(/\\s+/g, ' ')).join(' | ') }; })()`);
  check(hit.rows > 0 && /rank \d+/.test(hit.text) && /T[123]/.test(hit.text) && /\d+(–\d+)? · \d+(–\d+)? · \d+(–\d+)? each/.test(hit.text), `searching "${itemName}" lists the sectors dropping it (${hit.text.slice(0, 120)})`);
  await ev(`[...[...document.querySelectorAll('.finder-search-item')].find((x) => x.querySelector('.finder-search-name').innerText.startsWith(${JSON.stringify(itemName)})).querySelectorAll('.finder-search-row button')][0].click()`);
  await waitFor(`[...document.querySelectorAll('.finder-goal .planner-chip')].some((c) => c.innerText.includes(${JSON.stringify(itemName)}))`, 'the item added', 5000);
  check(true, 'Add puts the item on its sector as a goal');
  await waitFor(`document.querySelectorAll('.finder-table tbody tr:not(.finder-group)').length > 0 && !document.querySelector('.working')`, 'the builds again', 30000);

  // Only these parts: Hull Standard only.
  await ev(`document.querySelector('.finder-slot-button').click()`);
  await ev(`document.querySelector('.finder-filter').scrollIntoView()`);
  await t.shot('build-finder-slot');
  await ev(`[...document.querySelectorAll('.finder-slot-panel button')].find((b) => b.innerText === 'Standard only').click()`);
  await waitFor(`/with these parts/.test(document.querySelector('.finder-tally').innerText) && !document.querySelector('.working')`, 'the part filter', 30000);
  const hulls = await ev(`[...document.querySelectorAll('.finder-table tbody tr:not(.finder-group)')].map((tr) => tr.querySelector('.finder-part').innerText)`);
  const slotText = await ev(`document.querySelector('.finder-slot-button').innerText`);
  check(hulls.length > 0 && hulls.every((h) => !h.endsWith('+')) && /Standard only/.test(slotText), `Hull: Standard only leaves Standard hulls (${[...new Set(hulls)].join(', ')})`);
  // With a filter on, the slot's Any is lit (the way to clear it); with none, it's a plain link.
  if (!(await ev(`!!document.querySelector('.finder-slot-panel')`))) await ev(`document.querySelector('.finder-slot-button').click()`);
  const anyLit = await ev(`(() => { const b = [...document.querySelectorAll('.finder-slot-panel button')].find((x) => x.innerText === 'Any'); return b ? b.className + '|' + b.title : ''; })()`);
  check(/finder-any on/.test(anyLit) && /Clear this slot's filter/.test(anyLit), `Any is highlighted while the slot has a filter (${anyLit})`);
  const tallyFiltered = await ev(`document.querySelector('.finder-tally').innerText.replace(/\\s+/g, ' ')`);
  check(/[\d,]+ builds · [\d,]+ with these parts/.test(tallyFiltered), `the counts say how many have these parts (${tallyFiltered})`);
  await ev(`[...document.querySelectorAll('.finder-filter button')].find((b) => b.innerText === 'Clear filters').click()`);
  await waitFor(`!/with these parts/.test(document.querySelector('.finder-tally').innerText)`, 'the filter cleared', 30000);

  // With enough range (the made-up ranks' range raised for a moment, in this scratch database), the builds are in
  // range and grouped under "Rank N · how many builds".
  const was = await t.query('SELECT id, range_bonus FROM ffxiv_submarinerank ORDER BY id');
  await t.query(`UPDATE ffxiv_submarinerank SET range_bonus = '1000'`);
  await ev(`[...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Refresh').click()`);
  await waitFor(`[...document.querySelectorAll('.finder-group')].some((tr) => /^Rank \\d+/.test(tr.innerText))`, 'the rank groups', 30000);
  const inRange = await ev(`[...document.querySelectorAll('.finder-group')].map((tr) => tr.innerText.replace(/\\s+/g, ' '))`);
  const spare = await ev(`[...document.querySelectorAll('.finder-table tbody tr:not(.finder-group)')].every((tr) => /\\+\\d/.test(tr.innerText) && !tr.classList.contains('finder-out'))`);
  check(inRange.length > 0 && inRange.every((g) => /^Rank \d+ [\d,]+ builds?$/.test(g)) && spare, `in range: grouped under Rank N with how many builds, each with its range to spare (${inRange.slice(0, 2).join(' | ')})`);
  const tips = await ev(`[...document.querySelector('.finder-table tbody tr:not(.finder-group)').querySelectorAll('td[title]')].map((td) => td.title)`);
  check(tips.some((x) => /^\d[\d,]* more range than the route uses \(\d+\)$/.test(x))
    && tips.some((x) => /^(Exactly|[\d,]+ more surveillance than) what T2 on \w.* needs \([\d,]+\)$/.test(x)), `the range's + says what it is on hover (${tips.join(' | ')})`);
  const legend = await ev(`document.querySelector('.finder-legend').innerText`);
  check(/beyond what's needed/.test(legend), 'the legend says what the + numbers are');
  await ev(`document.querySelector('.finder-legend').scrollIntoView()`);
  await t.shot('build-finder-in-range');
  for (const r of was) await t.query(`UPDATE ffxiv_submarinerank SET range_bonus = ${r.range_bonus === null ? 'NULL' : `'${String(r.range_bonus).replace(/'/g, "''")}'`} WHERE id = '${String(r.id).replace(/'/g, "''")}'`);
  await ev(`[...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Refresh').click()`);
  await waitFor(`/[1-9][\\d,]* out of range/.test(document.querySelector('.finder-tally').innerText) && !document.querySelector('.working')`, 'the range put back', 30000);

  // Fastest voyage first.
  await setSelect(`document.querySelector('.finder-options select')`, 'speed');
  await waitFor(`!document.querySelector('.working') && document.querySelectorAll('.finder-group').length === 0`, 'the new order', 20000);
  check(await ev(`[...document.querySelectorAll('.finder-table thead th')][0].innerText.trim().toLowerCase() === 'rank'`), 'sorted another way: one list, with the Rank column in front');
  // In range first, then out of range; each part fastest first.
  const voyages = await ev(`[...document.querySelectorAll('.finder-table tbody tr:not(.finder-group)')].map((tr) => {
    const td = [...tr.querySelectorAll('td')][7].innerText.match(/(\\d+)h (\\d+)m/);
    return { out: tr.classList.contains('finder-out'), minutes: td ? Number(td[1]) * 60 + Number(td[2]) : null }; })`);
  check(voyages.length > 0 && voyages.every((v, i) => v.minutes !== null && (i === 0 || (v.out === voyages[i - 1].out ? v.minutes >= voyages[i - 1].minutes : v.out))),
    `sorted by fastest voyage, in range first (${voyages[0] && voyages[0].minutes} to ${voyages.length && voyages[voyages.length - 1].minutes} minutes)`);

  // Open the first build in the Planner: its rank, parts and the two sectors.
  const firstRank = await ev(`parseInt(document.querySelector('.finder-table tbody tr:not(.finder-group) td').innerText, 10)`);
  await ev(`[...document.querySelectorAll('.finder-table tbody button')].find((b) => b.innerText === 'Open in Voyage Planner').click()`);
  await waitFor(`document.querySelectorAll('.planner-chip').length === 2 && document.querySelectorAll('.planner-stat').length === 5`, 'the Planner with that build', 15000);
  const rank = await ev(`Number(document.querySelector('.planner-fields input[type=number]').value)`);
  check(rank === firstRank, `Open in Planner loads the build at its rank (${rank}) and both sectors`);

  // Back on the Build Finder: the item search's Clear, then Clear goals.
  await nav('Build Finder');
  await waitFor(`!!document.querySelector('.finder-search input')`, 'the Build Finder again', 15000);
  await ev(`(() => { const i = document.querySelector('.finder-search input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'zz');
    i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await waitFor(`[...document.querySelectorAll('.finder-search button')].some((b) => b.innerText.trim() === 'Clear')`, 'the search Clear', 5000);
  await ev(`[...document.querySelectorAll('.finder-search button')].find((b) => b.innerText.trim() === 'Clear').click()`);
  check(await ev(`document.querySelector('.finder-search input').value === ''`), 'Clear empties the item search');
  await ev(`[...document.querySelectorAll('.finder-row button')].find((b) => b.innerText.trim() === 'Add').click()`);
  await waitFor(`/1 of 5 sectors/.test(document.querySelector('.finder').innerText)`, 'a sector added', 10000);
  await ev(`[...document.querySelectorAll('.finder button')].find((b) => b.innerText.trim() === 'Clear goals').click()`);
  await waitFor(`/0 of 5 sectors/.test(document.querySelector('.finder').innerText)`, 'the goals cleared', 10000);
  check(true, 'Clear goals empties what you want');
};
