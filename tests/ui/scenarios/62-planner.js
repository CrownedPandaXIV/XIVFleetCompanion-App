// Sub Calculator → Planner: the sub picker (grouped, searchable, saying where each sub is), a synced sub loads its
// build and route, and the page shows its five stats, the voyage,
// what each sector reaches and the loot it can bring back (sectors 1 and 2 have XIVStats data; tests/ui/fixtures.sql
// gives every rank and part made-up stats).
module.exports = async (t) => {
  const { ev, waitFor, check, nav } = t;
  await nav('Summary');
  check(await ev(`[...document.querySelectorAll('.sidebar-group-title')].some((g) => g.innerText.trim().toLowerCase() === 'sub calculator')`),
    'the sidebar has a Sub Calculator group');
  await nav('Voyage Planner');
  await waitFor(`document.querySelectorAll('.planner-stat').length === 5`, 'the Planner', 20000);

  // The sub picker: grouped by account and character, each sub saying where it is; the search narrows it.
  await ev(`document.querySelector('.planner-picker-button').click()`);
  await waitFor(`document.querySelectorAll('.planner-picker-sub').length > 0`, 'the sub picker', 10000);
  const picker = await ev(`({ subs: document.querySelectorAll('.planner-picker-sub').length,
    accounts: document.querySelectorAll('.planner-picker-account').length,
    where: [...document.querySelectorAll('.planner-picker-sub')].every((b) => /In port|At sea until|Back, waiting/.test(b.innerText)) })`);
  check(picker.subs > 0 && picker.accounts > 0 && picker.where, `the picker lists subs under accounts, each saying where it is (${picker.subs} subs, ${picker.accounts} accounts)`);
  await t.shot('planner-picker');
  await ev(`(() => { const i = document.querySelector('.planner-picker-panel input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'zzznothing');
    i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await waitFor(`document.querySelectorAll('.planner-picker-sub').length === 0 && document.body.innerText.includes('No sub matches')`, 'search with no match', 5000);
  check(true, 'a search with no match says so');
  await ev(`(() => { const i = document.querySelector('.planner-picker-panel input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, '');
    i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await waitFor(`document.querySelectorAll('.planner-picker-sub').length === ${picker.subs}`, 'search cleared', 5000);

  // Choose the first sub.
  await ev(`document.querySelector('.planner-picker-sub').click()`);
  await waitFor(`document.querySelectorAll('.planner-chip').length === 2 && document.body.innerText.includes('What this build reaches')`, 'the sub loaded', 15000);
  await t.shot('planner-loaded');

  const stats = await ev(`[...document.querySelectorAll('.planner-stat b')].map((b) => b.innerText)`);
  check(stats.every((s) => /^\d[\d,]*$/.test(s)), `all five stats are worked out (${stats.join(', ')})`);
  const text = await ev('document.body.innerText');
  check(/Range used\s*\d+ \/ \d+/.test(text) && /Voyage\s*\d+h \d\dm/.test(text) && /Ceruleum\s*2 tanks/.test(text),
    'range used, voyage length and ceruleum are shown');
  const reach = await ev(`[...document.querySelectorAll('.planner table')][0].querySelectorAll('tbody tr').length`);
  check(reach === 2 && /Tier [123]/.test(text), `each sector says the tier it reaches (${reach} rows)`);
  const loot = await ev(`[...document.querySelectorAll('.planner table')][1].querySelectorAll('tbody tr').length`);
  check(loot > 0 && /Gil per voyage/.test(text) && /kits a day/.test(text), `the loot it can bring back, gil and repairs are shown (${loot} items)`);
  check(/Loot and breakpoints: XIVStats/.test(text), 'where the data comes from is said');
  // (The made-up items have no vendor price, so Price each shows "—" here.)
  const loot2 = await ev(`(() => { const t = [...document.querySelectorAll('.planner table')][1];
    const heads = [...t.querySelectorAll('thead th')].map((th) => th.textContent.replace(/[▲▼]/g, '').trim().toLowerCase());
    const col = (name) => [...t.querySelectorAll('tbody tr')].map((tr) => tr.children[heads.indexOf(name)].innerText.trim());
    return { heads, often: col('how often'), price: col('price each') }; })()`);
  check(loot2.often.some((x) => /^(about \d[\d,]* in [\d,]+ voyages|nearly every voyage)$/.test(x)) && loot2.heads.includes('price each') && loot2.price.every((x) => /^(\d[\d,]*|—)$/.test(x)),
    `the loot says how often each item comes and its price each (${loot2.often.slice(0, 3).join(' | ')}; ${loot2.price.slice(0, 3).join(' | ')})`);

  // Removing a sector updates everything.
  await ev(`document.querySelector('.planner-chip button').click()`);
  await waitFor(`document.querySelectorAll('.planner-chip').length === 1 && document.querySelectorAll('.planner table')[0]?.querySelectorAll('tbody tr').length === 1`, 'one sector left', 10000);
  check(true, 'removing a sector leaves one row');
  await t.shot('planner');

  // "Open in Planner" on the Subs page loads that sub.
  await nav('Subs');
  await waitFor(`[...document.querySelectorAll('button')].some((b) => b.innerText === 'Open in Voyage Planner')`, 'Open in Planner on Subs', 15000);
  const subName = await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.innerText === 'Open in Voyage Planner');
    const name = b.closest('tr').querySelector('td').innerText; b.click(); return name; })()`);
  await waitFor(`document.querySelector('.planner-picker-button') && !document.querySelector('.planner-picker-button').innerText.includes('Choose') && document.querySelectorAll('.planner-chip').length > 0`, 'the Planner with that sub', 15000);
  const chosenText = await ev(`document.querySelector('.planner-picker-button').innerText`);
  check(chosenText.includes(subName), `Open in Planner on Subs loads that sub (${subName}: "${chosenText}")`);
};
