// Sub Calculator → Planner: a synced sub loads its build and route, and the page shows its five stats, the voyage,
// what each sector reaches and the loot it can bring back (sectors 1 and 2 have XIVStats data; tests/ui/fixtures.sql
// gives every rank and part made-up stats).
module.exports = async (t) => {
  const { ev, waitFor, check, nav } = t;
  await nav('Summary');
  check(await ev(`[...document.querySelectorAll('.sidebar-group-title')].some((g) => g.innerText.trim().toLowerCase() === 'sub calculator')`),
    'the sidebar has a Sub Calculator group');
  await nav('Planner');
  await waitFor(`document.querySelectorAll('.planner-stat').length === 5`, 'the Planner', 20000);

  // Load the first synced sub (Load from my sub).
  await ev(`(() => { const s = document.querySelector('.planner .controls select');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, '0');
    s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
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

  // Removing a sector updates everything.
  await ev(`document.querySelector('.planner-chip button').click()`);
  await waitFor(`document.querySelectorAll('.planner-chip').length === 1 && document.querySelectorAll('.planner table')[0]?.querySelectorAll('tbody tr').length === 1`, 'one sector left', 10000);
  check(true, 'removing a sector leaves one row');
  await t.shot('planner');
};
