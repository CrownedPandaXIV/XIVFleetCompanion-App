// Shared helpers for UI scenarios that exercise the column system (move, remove, add, reset) on any table.
module.exports = function columnTools(t) {
  const { call, ev, sleep, waitFor } = t;
  const clean = `.innerText.trim().toLowerCase().replace(/[\\u25B2\\u25BC]/g,'').trim()`;
  const q = JSON.stringify;

  // Header names of the first table on the page (the drag-handle cell, if any, shows as an empty name).
  const headers = async () => (await ev(`[...document.querySelector('thead').querySelectorAll('th')].map(th=>th${clean})`)).filter((h) => h !== '');
  // The body rows of every table that has the same headers as the first table (a page can hold other tables too,
  // for example the Sub Build Rules panel next to the Parts tab).
  const sameTableRows = `(() => {
    const names = (table) => [...table.querySelectorAll('thead th')].map(th => th${clean}).join('|');
    const key = names(document.querySelector('table'));
    return [...document.querySelectorAll('table')].filter(tb => names(tb) === key).flatMap(tb => [...tb.querySelectorAll('tbody tr')]);
  })()`;
  // Texts in one column, across every table that shares the first table's headers.
  const column = (name) => ev(`(() => {
    const heads = [...document.querySelector('thead').querySelectorAll('th')];
    const i = heads.findIndex(th => th${clean} === ${q(name)});
    return ${sameTableRows}.map(tr => tr.children[i].innerText.trim());
  })()`);
  const cellsAlign = () => ev(`(() => {
    const n = document.querySelector('thead').querySelectorAll('th').length;
    const rows = ${sameTableRows};
    return rows.length > 0 && rows.every(tr => tr.children.length === n);
  })()`);
  const drag = (from, to) => ev(`(() => {
    const th = (n) => [...document.querySelector('thead').querySelectorAll('th')].find(x => x${clean} === n);
    const dt = new DataTransfer();
    th(${q(from)}).querySelector('span').dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
    const target = th(${q(to)});
    target.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  })()`);
  const menuOpen = () => ev(`!!document.querySelector('.column-chooser')`);
  const openMenu = async () => {
    if (!(await menuOpen())) {
      await ev(`[...document.querySelectorAll('button')].find(x => x.innerText.trim() === 'Columns').click()`);
      await sleep(200);
    }
  };
  const closeMenu = async () => {
    if (await menuOpen()) {
      await ev(`document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
      await sleep(150);
    }
  };
  const addable = () => ev(`[...document.querySelectorAll('.column-chooser-row[data-add]')].map(r => r.querySelector('span').innerText.trim())`);
  const removeFromMenu = (label) => ev(`(() => {
    const row = [...document.querySelectorAll('.column-chooser-row[data-column]')].find(r => r.querySelector('span').innerText.trim().toLowerCase() === ${q(label.toLowerCase())});
    row.querySelector('button[title^="Remove"]').click();
  })()`);
  const addFromMenu = (label) => ev(`(() => {
    const row = [...document.querySelectorAll('.column-chooser-row[data-add]')].find(r => r.querySelector('span').innerText.trim() === ${q(label)});
    row.querySelector('button').click();
  })()`);
  const resetColumns = async () => {
    await openMenu();
    await ev(`[...document.querySelectorAll('.column-chooser button')].find(b => b.innerText.trim() === 'Reset columns').click()`);
    await sleep(400);
  };
  const clickHeader = (name) => ev(`[...document.querySelector('thead').querySelectorAll('th')].find(th=>th${clean}.startsWith(${q(name)})).querySelector('span').click()`);
  const loaded = () => waitFor(`!document.body.innerText.includes('…')`, 'added columns to load', 15000);
  return { headers, column, cellsAlign, drag, openMenu, closeMenu, addable, removeFromMenu, addFromMenu, resetColumns, clickHeader, loaded, clean };
};
