// Character Roster columns: move by dragging a header, remove and add from the master list (including columns
// the Roster does not have of its own), remembered across restarts, and reset.
module.exports = async (t) => {
  const { call, ev, sleep, waitFor, shot, check, nav } = t;
  await ev(`window.localStorage.clear()`);
  await call('Page.reload');
  await waitFor(`document.querySelectorAll('.sidebar-button').length>0`, 'app');
  await nav('Character Roster');
  await waitFor(`document.querySelectorAll('tbody tr[data-cid]').length>0`, 'roster rows');
  await sleep(500);

  const DEFAULT = ['name', 'world', 'fc', 'fc points', 'house', 'gil', 'ceruleum', 'repair kits', 'retainers', 'submarines', 'last synced'];
  const clean = `.innerText.trim().toLowerCase().replace(/[\\u25B2\\u25BC]/g,'').trim()`;
  // The first cell of each row holds the drag handle and the Remove ×; it is not a column.
  const headers = () => ev(`[...document.querySelector('thead').querySelectorAll('th')].slice(1).map(th=>th${clean})`);
  const firstRow = () => ev(`[...document.querySelector('tbody tr[data-cid]').children].slice(1).map(td=>td.innerText.trim())`);
  const cellCountsMatch = async () => (await ev(`document.querySelector('tbody tr[data-cid]').children.length - 1`)) === (await headers()).length;
  const column = (name) => ev(`(() => { const i = [...document.querySelector('thead').querySelectorAll('th')].slice(1).findIndex(th=>th${clean} === ${JSON.stringify(name)}); return [...document.querySelectorAll('tbody tr[data-cid]')].map(tr=>tr.children[i + 1].innerText.trim()); })()`);
  const drag = (from, to) => ev(`(() => {
    const th = (n) => [...document.querySelector('thead').querySelectorAll('th')].find(x => x${clean} === n);
    const dt = new DataTransfer();
    th(${JSON.stringify(from)}).querySelector('span').dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
    const target = th(${JSON.stringify(to)});
    target.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  })()`);
  const openMenu = async () => {
    if (!(await ev(`!!document.querySelector('.column-chooser')`))) {
      await ev(`[...document.querySelectorAll('button')].find(x => x.innerText.trim() === 'Columns').click()`);
      await sleep(200);
    }
  };
  const shownInMenu = () => ev(`[...document.querySelectorAll('.column-chooser-row[data-column]')].map(r => r.querySelector('span').innerText.trim().toLowerCase())`);
  const addable = () => ev(`[...document.querySelectorAll('.column-chooser-row[data-add]')].map(r => r.querySelector('span').innerText.trim())`);
  const removeFromMenu = (key) => ev(`document.querySelector('.column-chooser-row[data-column=${JSON.stringify(key)}] button[title^="Remove"]').click()`);
  const addFromMenu = (key) => ev(`document.querySelector('.column-chooser-row[data-add=${JSON.stringify(key)}] button').click()`);
  const reload = async () => {
    await call('Page.reload');
    await waitFor(`document.querySelectorAll('.sidebar-button').length>0`, 'app');
    await nav('Character Roster');
    await waitFor(`document.querySelectorAll('tbody tr[data-cid]').length>0`, 'roster rows');
    await sleep(600);
  };

  check(JSON.stringify(await headers()) === JSON.stringify(DEFAULT), 'columns start in the default order');
  const before = await firstRow();

  // drag Gil onto World: Gil takes World's place
  await drag('gil', 'world'); await sleep(300);
  const moved = await headers();
  check(moved[1] === 'gil' && moved[2] === 'world' && moved.length === DEFAULT.length, 'dragging Gil onto World moves it there: ' + moved.slice(0, 4).join(', '));
  const afterRow = await firstRow();
  check(afterRow[1] === before[5] && afterRow[2] === before[1], 'each cell moves with its header: ' + afterRow.slice(0, 3).join(' | '));
  check(await cellCountsMatch(), 'rows and headers have the same number of columns');

  await reload();
  const reloaded = await headers();
  check(reloaded[1] === 'gil' && reloaded[2] === 'world', 'the new order is remembered after a restart');

  // sorting still works on a moved column
  await ev(`[...document.querySelector('thead').querySelectorAll('th')].find(th=>th${clean}.startsWith('fc points')).querySelector('span').click()`);
  await sleep(300);
  const pts = (await column('fc points')).map((v) => Number(v.replace(/,/g, '')));
  check(pts.length === 80 && pts.every((v, i) => i === 0 || v >= pts[i - 1]), 'sorting still works on a moved column');
  for (let i = 0; i < 2; i++) {
    await ev(`[...document.querySelector('thead').querySelectorAll('th')].find(th=>th${clean}.startsWith('fc points')).querySelector('span').click()`);
    await sleep(250);
  }

  // the menu: Name always stays; remove two columns
  await openMenu();
  check(await ev(`document.querySelector('.column-chooser-row[data-column="name"] button[title^="This column"]').disabled`), 'the Name column cannot be removed');
  await removeFromMenu('house'); await sleep(200);
  await removeFromMenu('retainers'); await sleep(300);
  const trimmed = await headers();
  check(!trimmed.includes('house') && !trimmed.includes('retainers') && trimmed.length === DEFAULT.length - 2, 'removed columns disappear: ' + trimmed.join(', '));
  check(await cellCountsMatch(), 'rows and headers still match after removing');

  // the master list: removed own columns can come back, and columns the Roster never had can be added
  await openMenu();
  const options = await addable();
  check(options.includes('House') && options.includes('Retainers'), 'columns removed from the table are offered again under Add a column');
  check(options.includes('Account') && options.includes('FC Leader') && options.includes('Retainer Gil (total)') && options.includes('Ceruleum in FC Chest'),
    'columns from the master list are offered: ' + options.slice(0, 8).join(', ') + '...');
  check(!options.includes('Gil') && !options.includes('Free Company'), 'columns the table already shows are not offered twice');

  await addFromMenu('x_account'); await sleep(200);
  await addFromMenu('x_fc_leader'); await sleep(200);
  await addFromMenu('x_retainer_gil'); await sleep(200);
  await addFromMenu('x_fc_chest_ceruleum'); await sleep(200);
  await waitFor(`!document.body.innerText.includes('…')`, 'the added columns to load', 15000);
  const withExtras = await headers();
  check(['account', 'fc leader', 'retainer gil (total)', 'ceruleum in fc chest'].every((h) => withExtras.includes(h)), 'added columns appear as new columns: ' + withExtras.slice(-5).join(', '));
  check(await cellCountsMatch(), 'rows and headers match with the added columns');
  const accounts = await column('account');
  check(accounts.length === 80 && accounts.every((v) => /^acct[0-2]$/.test(v)), "the Account column shows each character's account: " + accounts.slice(0, 3).join(', '));
  const leaders = await column('fc leader');
  const names = await column('name');
  check(leaders.every((v, i) => v === names[i]), 'FC Leader shows the right value for each row (each test FC is led by its only member)');
  const chest = await column('ceruleum in fc chest');
  check(chest.length === 80 && chest.every((v) => v === '—' || /^[\d,]+$/.test(v)), 'a number-or-dash column formats correctly: ' + [...new Set(chest)].slice(0, 3).join(', '));
  await shot('added-columns');

  // sorting works on an added column
  await ev(`[...document.querySelector('thead').querySelectorAll('th')].find(th=>th${clean}.startsWith('account')).querySelector('span').click()`);
  await sleep(300);
  const sortedAccounts = await column('account');
  check(sortedAccounts.every((v, i) => i === 0 || v >= sortedAccounts[i - 1]), 'sorting works on an added column');
  for (let i = 0; i < 2; i++) {
    await ev(`[...document.querySelector('thead').querySelectorAll('th')].find(th=>th${clean}.startsWith('account')).querySelector('span').click()`);
    await sleep(250);
  }

  // arrows in the menu move a column
  await openMenu();
  const beforeArrow = await headers();
  await ev(`document.querySelector('.column-chooser-row[data-column="x_account"] button[title="Move earlier"]').click()`); await sleep(300);
  const afterArrow = await headers();
  check(afterArrow.indexOf('account') === beforeArrow.indexOf('account') - 1, 'the up arrow moves a column one place earlier');

  // everything is remembered, including the added columns and their values
  const expected = await headers();
  await reload();
  await waitFor(`!document.body.innerText.includes('…')`, 'the added columns to load', 15000);
  check(JSON.stringify(await headers()) === JSON.stringify(expected), 'the layout, including added columns, is remembered after a restart');
  const again = await column('fc leader');
  check(again.length === 80 && again.every((v) => v !== '…'), 'added columns are filled in again after a restart');

  // a removed column stays removed, and reset puts it all back
  await openMenu();
  await ev(`[...document.querySelectorAll('.column-chooser button')].find(b => b.innerText.trim() === 'Reset columns').click()`); await sleep(400);
  check(JSON.stringify(await headers()) === JSON.stringify(DEFAULT), 'Reset columns brings back the default columns and order');
  check(await cellCountsMatch(), 'rows and headers match after the reset');
};
