// Every other converted tab: columns can be moved (cells follow their headers), removed and added back, extra columns
// from the master list appear where they make sense, and the layout is remembered and can be reset.
const columnTools = require('../columns-helpers');

module.exports = async (t) => {
  const { call, ev, sleep, waitFor, check, nav, clickText } = t;
  const c = columnTools(t);
  await ev(`window.localStorage.clear()`);
  await call('Page.reload');
  await waitFor(`document.querySelectorAll('.sidebar-button').length>0`, 'app');

  // Buttons that switch a tab's sub-view exist only once its data has loaded.
  const pressWhenThere = async (text) => {
    await waitFor(`[...document.querySelectorAll('button')].some(b => b.innerText.trim() === ${JSON.stringify(text)})`, `the ${text} button`, 20000);
    // the button for the view that is already showing is disabled: nothing to do
    await ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === ${JSON.stringify(text)}); if (!b.disabled) b.click(); })()`);
    await sleep(500);
  };
  const pickFirst = async (placeholder) => {
    await ev(`[...document.querySelectorAll('input')].find(i => (i.placeholder || '').startsWith(${JSON.stringify(placeholder)})).dispatchEvent(new FocusEvent('focusin', { bubbles: true }))`);
    await sleep(250);
    await ev(`[...document.querySelectorAll('div')].find(d => d.style && d.style.cursor === 'pointer' && d.children.length === 0 && d.innerText.includes('(')).dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
    await sleep(600);
  };

  const TABS = [
    {
      name: 'Salvage', nav: 'Salvage',
      default: ['character', 'world', 'standard salvage', 'extravagant salvage', 'value'],
      move: ['value', 'world'], remove: 'World', extra: { label: 'Account', pattern: /^acct[0-2]$/ },
    },
    {
      name: 'Subs', nav: 'Subs',
      default: ['sub', 'status', 'rank', 'next rank', 'next build', 'current setup', 'speed', 'range', 'current route', 'current gil/day', 'target route', 'target gil/day', 'craft?'],
      move: ['rank', 'status'], remove: 'Range', extra: { label: 'Account', pattern: /^acct[0-2]$/ },
      afterSort: { header: 'rank', expectFirst: ['character', 'world', 'sub'] },
    },
    {
      name: 'Retainers', nav: 'Retainers',
      default: ['owner', 'world', 'retainer', 'class/level', 'gil', 'avg ilvl', 'venture type', 'status', 'target mode', 'target value', 'only crafted?', 'actions'],
      move: ['gil', 'world'], remove: 'Venture Type', extra: { label: 'Account', pattern: /^acct[0-2]$/ },
      editTarget: true,
    },
    {
      name: 'Parts summary', nav: 'Parts',
      default: ['slot', 'needed class', 'qty still needed'],
      move: ['qty still needed', 'slot'], remove: 'Needed Class',
    },
    {
      name: 'Parts detail', nav: 'Parts', prepare: async () => { await pressWhenThere('Detail'); },
      default: ['sub', 'rank', 'slot', 'needed', 'status'],
      move: ['status', 'rank'], remove: 'Slot', extra: { label: 'Account', pattern: /^acct[0-2]$/ },
      afterSort: { header: 'rank', expectFirst: ['character', 'world', 'sub'] },
    },
    {
      name: 'Route Optimization', nav: 'Route Optimization',
      default: ['character', 'world', 'sub', 'current route', 'current gil/day', 'target route', 'target gil/day', 'gil/day gain'],
      move: ['gil/day gain', 'world'], remove: 'Sub', extra: { label: 'Account', pattern: /^acct[0-2]$/ },
    },
    {
      name: 'Inventory (Fleet)', nav: 'Inventory', prepare: async () => { await pressWhenThere('Fleet'); },
      default: ['item', 'total quantity'],
      move: ['total quantity', 'item'], remove: 'Total Quantity',
    },
    {
      name: 'Inventory (Character)', nav: 'Inventory', prepare: async () => { await pressWhenThere('Character'); await sleep(400); await pickFirst('Search characters'); },
      default: ['character', 'location', 'item', 'quantity'],
      move: ['quantity', 'character'], remove: 'Location',
    },
    {
      name: 'Inventory (FC)', nav: 'Inventory', prepare: async () => { await pressWhenThere('FC'); await sleep(400); await pickFirst('Search FCs'); },
      default: ['fc', 'tab', 'item', 'quantity'],
      move: ['quantity', 'fc'], remove: 'Tab',
    },
  ];

  const open = async (spec) => {
    await nav(spec.nav);
    if (spec.prepare) await spec.prepare();
    await waitFor(`document.querySelectorAll('tbody tr').length>0`, spec.name + ' rows', 20000);
    await sleep(400);
  };

  for (const spec of TABS) {
    const label = spec.name;
    await open(spec);
    check(JSON.stringify(await c.headers()) === JSON.stringify(spec.default), `${label}: starts with its usual columns`);

    // move a column: it lands where the other one was, and its cells go with it
    const [from, to] = spec.move;
    const before = await c.headers();
    const textsBefore = await c.column(from);
    await c.drag(from, to); await sleep(300);
    const after = await c.headers();
    check(after.indexOf(from) === before.indexOf(to) && after.length === before.length, `${label}: dragging "${from}" onto "${to}" moves it: ${after.join(', ')}`);
    const textsAfter = await c.column(from);
    check(textsAfter.length > 0 && JSON.stringify(textsAfter) === JSON.stringify(textsBefore), `${label}: the moved column keeps its own values`);
    check(await c.cellsAlign(), `${label}: every row has as many cells as there are headers`);

    // remove a column, then add it back from the list
    await c.openMenu();
    await c.removeFromMenu(spec.remove); await sleep(300);
    check(!(await c.headers()).includes(spec.remove.toLowerCase()), `${label}: "${spec.remove}" can be removed`);
    await c.openMenu();
    check((await c.addable()).includes(spec.remove), `${label}: and is offered again under Add a column`);
    await c.addFromMenu(spec.remove); await sleep(300);
    const readded = await c.headers();
    check(readded[readded.length - 1] === spec.remove.toLowerCase(), `${label}: adding it back puts it at the end`);
    check(await c.cellsAlign(), `${label}: rows still match the headers after removing and adding`);

    // a column from the master list
    if (spec.extra) {
      await c.openMenu();
      check((await c.addable()).includes(spec.extra.label), `${label}: the master list offers "${spec.extra.label}"`);
      await c.addFromMenu(spec.extra.label); await sleep(200);
      await c.loaded();
      const values = await c.column(spec.extra.label.toLowerCase());
      check(values.length > 0 && values.every((v) => spec.extra.pattern.test(v)), `${label}: the added "${spec.extra.label}" column has the right values: ${[...new Set(values)].slice(0, 3).join(', ')}`);
      check(await c.cellsAlign(), `${label}: rows still match the headers with the added column`);
    } else {
      await c.openMenu();
      const options = await c.addable();
      check(!options.includes('Account'), `${label}: this table offers no master-list columns (its rows are not characters)`);
    }
    await c.closeMenu();

    // sorting a per-character table turns on Character and World automatically
    if (spec.afterSort) {
      const shown = await c.headers();
      check(!shown.includes('character'), `${label}: Character is not a column while the tab is split by character`);
      await c.clickHeader(spec.afterSort.header); await sleep(400);
      const flat = await c.headers();
      check(JSON.stringify(flat.slice(0, 3)) === JSON.stringify(spec.afterSort.expectFirst), `${label}: sorting shows Character and World in front: ${flat.slice(0, 4).join(', ')}`);
      for (let i = 0; i < 2; i++) { await c.clickHeader(spec.afterSort.header); await sleep(250); }
      check((await c.headers()).join() === shown.join(), `${label}: clearing the sort returns to the same columns`);
    }

    // the tab's own controls still work in a moved layout
    if (spec.editTarget) {
      const actionsDefault = (await c.headers()).indexOf('actions');
      await c.drag('actions', 'owner'); await sleep(300);
      check((await c.headers())[0] === 'actions', `${label}: the Actions column can be moved to the front`);
      await ev(`(() => {
        const heads = [...document.querySelector('thead').querySelectorAll('th')];
        const tr = document.querySelector('tbody tr');
        const set = (el, v, proto) => { Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new Event(proto === HTMLSelectElement.prototype ? 'change' : 'input', { bubbles: true })); };
        set(tr.querySelector('select'), 'level', HTMLSelectElement.prototype);
      })()`);
      await sleep(200);
      await ev(`(() => { const tr = document.querySelector('tbody tr'); const num = tr.querySelector('input[type=number]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(num, '90'); num.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await sleep(200);
      await ev(`[...document.querySelector('tbody tr').querySelectorAll('button')].find(b => b.innerText.trim() === 'Save').click()`);
      await waitFor(`document.querySelector('tbody tr').innerText.includes('Saved.')`, 'the target to save', 10000);
      check(true, `${label}: saving a target works from the moved Actions column`);
      await sleep(600);
      await ev(`[...document.querySelector('tbody tr').querySelectorAll('button')].find(b => b.innerText.trim() === 'Clear').click()`);
      await waitFor(`document.querySelector('tbody tr').innerText.includes('Cleared.')`, 'the target to clear', 10000);
      check(true, `${label}: and clearing it works too`);
    }

    // remembered after a restart
    const expected = await c.headers();
    await call('Page.reload');
    await waitFor(`document.querySelectorAll('.sidebar-button').length>0`, 'app');
    await open(spec);
    await c.loaded();
    check(JSON.stringify(await c.headers()) === JSON.stringify(expected), `${label}: the layout is remembered after a restart`);

    // reset
    await c.resetColumns();
    check(JSON.stringify(await c.headers()) === JSON.stringify(spec.default), `${label}: Reset columns restores the usual columns`);
    await c.closeMenu();
  }
};
