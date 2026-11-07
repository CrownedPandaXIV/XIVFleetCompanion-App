// The tables' look, as the plugin's: gil in gold, an FC's name in lavender, a house's address in blue, numbers on
// the right, and a resizable table keeping each column at the width it is given, so the last column can be dragged
// wider too (the room left over sits after it).
const BEX = '18014498578000001';

module.exports = async (t) => {
  const { ev, sleep, waitFor, check, nav, shot } = t;
  await ev(`window.localStorage.clear()`);
  await nav('Character Roster');
  await waitFor(`!!document.querySelector('tr[data-cid="${BEX}"]')`, 'the Roster', 20000);
  check(await ev(`document.querySelectorAll('tbody .gil').length > 0`), 'gil is in gold');
  check(await ev(`getComputedStyle(document.querySelector('tbody .gil')).color`) === 'rgb(242, 208, 107)', 'the same gold as the plugin');
  check(await ev(`document.querySelectorAll('tbody .fc-name').length > 0`), "FC names are in lavender");
  check(await ev(`document.querySelectorAll('tbody td.num').length > 0 && getComputedStyle(document.querySelector('tbody td.num')).textAlign === 'right'`), 'numbers sit on the right');
  check(await ev(`document.querySelectorAll('tbody .tone-good, tbody .tone-warn, tbody .tone-danger').length > 0`), 'colours by meaning');

  // Drag the last column's edge 120px to the right: it grows by that, and the others stay as they are.
  const widths = () => ev(`[...document.querySelector('table').querySelectorAll('thead th')].map((th) => Math.round(th.getBoundingClientRect().width))`);
  const before = await widths();
  const tableWidth = await ev(`Math.round(document.querySelector('table').getBoundingClientRect().width)`);
  const sum = before.reduce((a, b) => a + b, 0);
  check(Math.abs(tableWidth - sum) <= before.length, `the table is as wide as its columns, not stretched to the page (${tableWidth}, columns ${sum})`);
  await ev(`(() => {
    const ths = document.querySelector('table').querySelectorAll('thead th');
    const handle = ths[ths.length - 1].querySelector('div[title="Drag to resize"]');
    const r = handle.getBoundingClientRect();
    handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: r.left + 2, clientY: r.top + 2 }));
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.left + 122, clientY: r.top + 2 }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: r.left + 122, clientY: r.top + 2 }));
  })()`);
  await sleep(300);
  const after = await widths();
  const last = before.length - 1;
  check(Math.abs(after[last] - before[last] - 120) <= 2, `the last column grew by 120px (${before[last]} → ${after[last]})`);
  check(after.slice(0, last).every((w, i) => Math.abs(w - before[i]) <= 1), 'the other columns kept their widths');
  await shot('table-look-roster');

  // Character and world together, FC points in aqua, supplies that don't count dim.
  check(await ev(`!!document.querySelector('tr[data-cid="${BEX}"] .world-after')`), 'the world follows the name, softer');
  check(!(await ev(`[...document.querySelectorAll('thead th')].some((th) => th.innerText.trim().toUpperCase().startsWith('WORLD'))`)), 'no separate World column');

  // Retainers: each owner once, the class in its role's colour with the level softer.
  await nav('Retainers');
  await waitFor(`document.querySelectorAll('tbody tr').length > 1`, 'the retainers', 20000);
  const owners = await ev(`[...document.querySelector('table').querySelectorAll('tbody tr')].map((tr) => tr.children[0].innerText.trim())`);
  check(owners[0] !== '' && owners[1] === '' && owners[2] !== '' && owners[3] === '', 'an owner with several retainers is named once: ' + JSON.stringify(owners.slice(0, 4)));
  // The test data's retainers are crafters (no role, so plain); the roles themselves:
  check(await ev(`[roleClass('PLD'), roleClass('GLA'), roleClass('WHM'), roleClass('CNJ'), roleClass('SMN'), roleClass('ACN'), roleClass('BTN') || 'none'].join(' ')`)
    === 'role-tank role-tank-base role-healer role-healer-base role-dps role-dps-base none', 'classes are coloured by role, base classes lighter, gatherers plain');
  await shot('table-look-retainers');

  // Subs: a bar for the rank's progress, builds with softer dashes.
  await nav('Subs');
  await waitFor(`document.querySelectorAll('tbody tr').length > 0`, 'the subs', 20000);
  check(await ev(`document.querySelectorAll('.rank-bar').length > 0`), 'a bar for how far to the next rank');
  await shot('table-look-subs');
};
