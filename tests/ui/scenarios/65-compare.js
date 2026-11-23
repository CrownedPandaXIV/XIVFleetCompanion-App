// Sub Calculator → Compare: builds side by side (tests/ui/fixtures.sql: Deep-sea Site's O and J with XIVStats data, Z
// without). One of your subs and one typed in; the same route for both, then each its own best route; the best figure
// in each row marked; Add to compare on the Planner; Open in Planner.
module.exports = async (t) => {
  const { ev, waitFor, check, nav } = t;
  const setSelect = (selector, value) => ev(`(() => { const s = ${selector};
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, ${JSON.stringify(String(value))});
    s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  const setInput = (selector, value) => ev(`(() => { const i = ${selector};
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(String(value))});
    i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  const button = (text, within = 'document') => ev(`[...${within}.querySelectorAll('button')].find((b) => b.innerText.trim() === ${JSON.stringify(text)}).click()`);
  // A row's cells by its label: [text of each build's cell], and which are marked best.
  const row = (label) => ev(`(() => { const tr = [...document.querySelectorAll('.cmp-table tbody tr')].find((r) => r.querySelector('th') && r.querySelector('th').innerText.trim() === ${JSON.stringify(label)});
    return tr ? [...tr.querySelectorAll('td')].map((td) => ({ text: td.innerText.trim(), best: td.classList.contains('cmp-best') })) : null; })()`);

  await nav('Compare');
  await waitFor(`/Add a build to start/.test(document.body.innerText)`, 'the empty Compare page', 20000);
  check(true, 'with no builds it says how to add one');

  // One of your subs: the highest rank.
  await ev(`document.querySelector('.cmp-add .planner-picker-button').click()`);
  await waitFor(`document.querySelectorAll('.planner-picker-sub').length > 0`, 'the sub picker', 5000);
  const subName = await ev(`(() => { const subs = [...document.querySelectorAll('.planner-picker-sub')];
    const top = subs.sort((a, b) => Number(b.children[1].innerText.replace(/\\D/g, '')) - Number(a.children[1].innerText.replace(/\\D/g, '')))[0];
    const name = top.querySelector('.planner-picker-sub-name').innerText; top.click(); return name; })()`);
  await waitFor(`document.querySelectorAll('.cmp-table thead .cmp-head').length === 1`, 'the first build', 5000);
  // And one typed in, at rank 1.
  await button('Type one in');
  await waitFor(`document.querySelectorAll('.cmp-table thead .cmp-head').length === 2 && !!document.querySelector('.cmp-edit')`, 'the typed build, open to change', 5000);
  await setInput(`document.querySelector('.cmp-edit input[type=number]')`, 1);
  await button('Done');
  const heads = await ev(`[...document.querySelectorAll('.cmp-name')].map((n) => n.firstChild.textContent)`);
  check(heads[0] === subName && /^Build 2$/.test(heads[1]), `two builds as columns: your sub and a typed one (${heads.join(', ')})`);

  // Same route: O then J.
  for (const letter of ['O', 'J']) {
    await setSelect(`[...document.querySelectorAll('.finder-band')[1].querySelectorAll('select')][1]`,
      await ev(`[...[...document.querySelectorAll('.finder-band')[1].querySelectorAll('select')][1].options].find((o) => o.text.startsWith('${letter}:')).value`));
    await button('Add', `document.querySelectorAll('.finder-band')[1]`);
  }
  await waitFor(`document.querySelectorAll('.planner-chip').length === 2`, 'the route O, J', 5000);
  await waitFor(`(() => { const tr = [...document.querySelectorAll('.cmp-table tbody tr')].find((r) => r.querySelector('th') && r.querySelector('th').innerText.trim() === 'Gil a day');
    return tr && /\\d/.test(tr.querySelector('td').innerText); })()`, 'the numbers', 20000);
  await ev(`document.querySelector('.cmp-table').scrollIntoView()`);
  await t.shot('compare-same');
  const range = await row('Range');
  check(range[0].best && !range[1].best, `the rank ${'>'}1 sub has more range: marked best (${JSON.stringify(range)})`);
  const fly = await row('Can it fly it?');
  check(fly[0].text === 'Yes', `your sub can fly O-J (${JSON.stringify(fly)})`);
  check(fly[1].text === 'Yes' || /^Out of range: needs [\d,]+ more$/.test(fly[1].text), `the rank 1 build flies it or says by how much it's short (${fly[1].text})`);
  const gil = await row('Gil a day');
  check(fly[1].text === 'Yes' ? /\d/.test(gil[1].text) : gil[1].text === '—', `a build that can't fly it shows no voyage numbers (${JSON.stringify(gil)})`);
  const stops = await ev(`[...document.querySelectorAll('.cmp-table tbody tr')].filter((r) => r.querySelector('th .rf-letter')).map((r) => r.querySelector('.rf-letter').innerText)`);
  check(stops.join('') === 'OJ', `a row per stop with what each build reaches there (${stops.join(', ')})`);
  check(await ev(`[...document.querySelectorAll('.cmp-table td.cmp-best')].length > 0 && /green: the best/.test(document.body.innerText)`), 'best figures are green, with a key');

  // Best route each.
  await button('Best route each');
  await waitFor(`!/working out/.test(document.querySelector('.cmp').innerText)`, 'worked out', 20000);
  await waitFor(`(() => { const tr = [...document.querySelectorAll('.cmp-table tbody tr')].find((r) => r.querySelector('th') && r.querySelector('th').innerText.trim() === 'Its best route');
    return tr && tr.querySelectorAll('td')[0].querySelectorAll('.rf-letter').length > 0; })()`, 'each build\'s best route', 20000);
  await ev(`document.querySelector('.cmp-table').scrollIntoView()`);
  await t.shot('compare-best');
  const own = await ev(`(() => { const tr = [...document.querySelectorAll('.cmp-table tbody tr')].find((r) => r.querySelector('th').innerText.trim() === 'Its best route');
    return [...tr.querySelectorAll('td')].map((td) => [...td.querySelectorAll('.rf-letter')].map((l) => l.innerText).join('') || td.innerText.trim()); })()`);
  check(own[0].length > 0 && !own[0].includes('Z'), `each build shows its own route (the rank 1 one can only reach Z) (${own.join(' | ')})`);
  check(await ev(`/build and route together/.test(document.body.innerText)`), 'and says the numbers compare build and route together');
  // A must: every build's route goes to J.
  await ev(`[...document.querySelectorAll('.cmp-must')].find((b) => b.innerText === 'J').click()`);
  await waitFor(`(() => { const tr = [...document.querySelectorAll('.cmp-table tbody tr')].find((r) => r.querySelector('th') && r.querySelector('th').innerText.trim() === 'Its best route');
    return tr && [...tr.querySelectorAll('td')].every((td) => !td.querySelector('.rf-letter') || [...td.querySelectorAll('.rf-letter')].some((l) => l.innerText === 'J')); })()`, 'routes with J', 20000);
  check(true, 'a must goes in every build\'s route');
  await button('Same route');

  // Add to compare on the Planner: your sub is in already; another rank is added, and three is the most.
  await nav('Planner');
  await waitFor(`document.querySelectorAll('.planner-stat').length === 5`, 'the Planner', 15000);
  await setInput(`document.querySelector('.planner-fields input[type=number]')`, 50);
  await waitFor(`!!document.querySelector('.planner-compare button') && document.querySelector('.planner-compare button').innerText === 'Add to compare'`, 'Add to compare', 10000);
  await ev(`document.querySelector('.planner-compare button').click()`);
  await waitFor(`/^In Compare \\(3\\)/.test(document.querySelector('.planner-compare button').innerText)`, 'added', 5000);
  check(true, 'Add to compare on the Planner adds the build, and then opens Compare');
  await ev(`document.querySelector('.planner-compare button').click()`);
  await waitFor(`document.querySelectorAll('.cmp-table thead .cmp-head').length === 3`, 'three builds on Compare', 10000);
  check(await ev(`!document.querySelector('.cmp-add .planner-picker') && [...document.querySelectorAll('.cmp-add button')].find((b) => b.innerText === 'Type one in').disabled`),
    'with three builds, no more can be added');

  // Take one out; Open in Planner.
  await ev(`document.querySelectorAll('.cmp-x')[2].click()`);
  await waitFor(`document.querySelectorAll('.cmp-table thead .cmp-head').length === 2`, 'two again', 5000);
  await ev(`document.querySelectorAll('.cmp-foot .finder-open')[0].click()`);
  await waitFor(`document.querySelectorAll('.planner-chip').length === 2 && document.querySelectorAll('.planner-stat').length === 5`, 'the Planner with the route', 15000);
  check(true, 'Open in Planner loads that build and the route');
};
