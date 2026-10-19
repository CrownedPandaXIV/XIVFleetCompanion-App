// The Free Companies tab: its own columns can be moved, and columns from the master list (members' totals,
// the FC chest, ...) can be added, which the tab did not have before.
module.exports = async (t) => {
  const { call, ev, sleep, waitFor, check, nav } = t;
  await ev(`window.localStorage.clear()`);
  await call('Page.reload');
  await waitFor(`document.querySelectorAll('.sidebar-button').length>0`, 'app');
  await nav('Free Companies');
  await waitFor(`document.querySelectorAll('tbody tr').length>0`, 'fc rows');
  await sleep(500);

  const clean = `.innerText.trim().toLowerCase().replace(/[\\u25B2\\u25BC]/g,'').trim()`;
  const headers = () => ev(`[...document.querySelector('thead').querySelectorAll('th')].map(th=>th${clean})`);
  const column = (name) => ev(`(() => { const i = [...document.querySelector('thead').querySelectorAll('th')].findIndex(th=>th${clean} === ${JSON.stringify(name)}); return [...document.querySelectorAll('tbody tr')].map(tr=>tr.children[i].innerText.trim()); })()`);
  const openMenu = async () => {
    if (!(await ev(`!!document.querySelector('.column-chooser')`))) {
      await ev(`[...document.querySelectorAll('button')].find(x => x.innerText.trim() === 'Columns').click()`);
      await sleep(200);
    }
  };
  const addFromMenu = (key) => ev(`document.querySelector('.column-chooser-row[data-add=${JSON.stringify(key)}] button').click()`);

  const DEFAULT = ['fc name', 'leader', 'world', 'fc points', 'members', 'house', 'last entered'];
  check(JSON.stringify(await headers()) === JSON.stringify(DEFAULT), 'the tab starts with its usual columns');
  const rowCount = (await column('fc name')).length;
  check(rowCount === 80, 'all 80 Free Companies are listed: ' + rowCount);

  // move a column by dragging its header
  await ev(`(() => {
    const th = (n) => [...document.querySelector('thead').querySelectorAll('th')].find(x => x${clean} === n);
    const dt = new DataTransfer();
    th('members').querySelector('span').dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
    const target = th('leader');
    target.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  })()`);
  await sleep(300);
  const moved = await headers();
  check(moved[1] === 'members' && moved[2] === 'leader', 'dragging Members onto Leader moves it: ' + moved.join(', '));
  const members = await column('members');
  check(members.length === rowCount && members.every((v) => /^\d+$|^—$/.test(v)), 'the moved column still shows member counts');

  // add columns from the master list
  await openMenu();
  const options = await ev(`[...document.querySelectorAll('.column-chooser-row[data-add]')].map(r => r.querySelector('span').innerText.trim())`);
  check(['Tracked Members', 'Gil (members total)', 'Ceruleum (members total)', 'Ceruleum (in FC chest)', 'Rank', 'Founded'].every((o) => options.includes(o)),
    "members' totals and the FC chest are offered: " + options.join(', '));
  for (const key of ['x_members_tracked', 'x_members_ceruleum', 'x_chest_ceruleum', 'x_fc_rank']) {
    await addFromMenu(key); await sleep(200);
  }
  await waitFor(`!document.body.innerText.includes('…')`, 'the added columns to load', 15000);
  const now = await headers();
  check(['tracked members', 'ceruleum (members total)', 'ceruleum (in fc chest)', 'rank'].every((h) => now.includes(h)), 'the added columns appear: ' + now.join(', '));

  const tracked = await column('tracked members');
  check(tracked.length === rowCount && tracked.every((v) => v === '1'), 'each test Free Company has exactly one tracked member');
  const memberCeruleum = await column('ceruleum (members total)');
  check(memberCeruleum.every((v) => v === '5,000'), "members' ceruleum total is that member's ceruleum (5,000)");
  const chest = await column('ceruleum (in fc chest)');
  const numbers = chest.filter((v) => v !== '—').map((v) => Number(v.replace(/,/g, '')));
  check(numbers.length === 20 && numbers.every((v) => v % 10 === 0 && v >= 10 && v <= 200), 'the FC chest ceruleum shows for the 20 Free Companies that have some, dashes for the rest: ' + chest.filter((v, i) => i < 4).join(', '));

  // sort on an added column
  await ev(`[...document.querySelector('thead').querySelectorAll('th')].find(th=>th${clean}.startsWith('ceruleum (in fc chest)')).querySelector('span').click()`);
  await sleep(400);
  const sorted = await column('ceruleum (in fc chest)');
  const sortedNumbers = sorted.filter((v) => v !== '—').map((v) => Number(v.replace(/,/g, '')));
  check(sortedNumbers.every((v, i) => i === 0 || v >= sortedNumbers[i - 1]) && sorted.slice(-1)[0] === '—', 'sorting the added column puts numbers in order and blanks last');
  for (let i = 0; i < 2; i++) {
    await ev(`[...document.querySelector('thead').querySelectorAll('th')].find(th=>th${clean}.startsWith('ceruleum (in fc chest)')).querySelector('span').click()`);
    await sleep(250);
  }

  // remembered after a restart
  const expected = await headers();
  await call('Page.reload');
  await waitFor(`document.querySelectorAll('.sidebar-button').length>0`, 'app');
  await nav('Free Companies');
  await waitFor(`document.querySelectorAll('tbody tr').length>0`, 'fc rows');
  await waitFor(`!document.body.innerText.includes('…')`, 'the added columns to load', 15000);
  await sleep(300);
  check(JSON.stringify(await headers()) === JSON.stringify(expected), 'the layout is remembered after a restart');
  check((await column('tracked members')).every((v) => v === '1'), 'and the added columns are filled in again');

  // the Roster keeps its own separate layout
  await nav('Character Roster');
  await waitFor(`document.querySelectorAll('tbody tr[data-cid]').length>0`, 'roster');
  await sleep(400);
  const roster = await headers();
  check(!roster.includes('tracked members') && roster.includes('house') && roster.indexOf('name') < roster.indexOf('world'), 'each tab keeps its own layout');
};
