// Inventory → Where Is It?: type part of an item name and see every place it is held, with counts. From
// tests/ui/fixtures.sql: Test Ore sits in Bex Kitteh 1's bags (5), a retainer's bag (10) and up for sale
// by that retainer (99); Test Ingot in an FC chest (7). Added for this run: 2 HQ Test Ore in Cal Kitteh
// 2's saddlebag (counted with the normal ones), 1000 in a currency slot (never searched), 500 in Dara
// Kitteh 3's bags and 3 in Bex's Free Company chest. Roster order is Bex (acct1), Cal (acct2), Dara
// (acct0); results follow it and, by default, are grouped by account (acct0, acct1, acct2). Test Log, for searching word
// by word and "Hide equipped gear": 2 in Dara's bags, 1 she wears and 1 Bex's first retainer wears.
const CAL = '18014498578000002';
const DARA = '18014498578000003';
const BEX = '18014498578000001';

module.exports = async (t) => {
  const { ev, sleep, waitFor, check, nav, shot } = t;
  await ev(`window.localStorage.clear()`);
  await nav('Inventory');
  await waitFor(`[...document.querySelectorAll('button')].some(b => b.innerText.trim() === 'Where Is It?' && b.disabled)`, 'Where Is It? to open first', 20000);
  const type = async (text) => {
    await ev(`(() => {
      const input = document.querySelector('.where-is-it input');
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(input, ${JSON.stringify(text)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await sleep(400);
    await waitFor(`!document.querySelector('.where-is-it .status-inline')`, 'the search to finish', 20000);
    await sleep(200);
  };
  const results = () => ev(`[...document.querySelectorAll('.where-item')].map(div => ({
    title: div.querySelector('h3').innerText.trim(),
    // The name and its world are one cell; split back into two so each row reads name, world, where, quantity.
    rows: [...div.querySelectorAll('tbody tr')].map(tr => [...tr.children].flatMap((td, i) => {
      if (i > 0 || tr.children.length === 1) return [td.innerText.trim()];
      const w = td.querySelector('.world-after');
      const c = td.cloneNode(true);
      const cw = c.querySelector('.world-after');
      if (cw) cw.remove();
      return [c.textContent.trim(), w ? w.textContent.replace(/[()]/g, '').trim() : ''];
    })),
  }))`);
  const statusText = () => ev(`[...document.querySelectorAll('.where-is-it > .status')].map(s => s.innerText).join(' ')`);

  await type('t');
  check(/at least 2 letters/.test(await statusText()), 'one letter asks for more');

  await type('test ore');
  let found = await results();
  await shot('where-is-it');
  check(found.length === 1 && /^Test Ore\s+619 in 6 places$/.test(found[0].title), 'Test Ore: 619 in 6 places: ' + (found[0] && found[0].title));
  const cells = (rows) => rows.map((r) => r.join(' | '));
  check(JSON.stringify(cells(found[0] ? found[0].rows : [])) === JSON.stringify([
    'acct0',
    'Dara Kitteh 3 | Maduin | Bags | 500',
    'acct1',
    'Bex Kitteh 1 | Cuchulainn | Bags | 5',
    'Bex Kitteh 1 | Cuchulainn | Retainer Retainer 1-1 (for sale) | 99',
    'Bex Kitteh 1 | Cuchulainn | Retainer Retainer 1-1 | 10',
    'Best Cats (FC) |  | FC chest tab 1 | 3',
    'acct2',
    'Cal Kitteh 2 | Behemoth | Saddlebag | 2',
  ]), 'grouped by account; Roster order inside each, own places then retainers then the FC chest it holds: ' + JSON.stringify(cells(found[0] ? found[0].rows : [])));

  // Without grouping: one list in Roster order.
  await ev(`[...document.querySelectorAll('.where-is-it label')].find(l => l.innerText.includes('Group by account')).querySelector('input').click()`);
  await sleep(300);
  found = await results();
  const rows = found[0] ? found[0].rows : [];
  check(JSON.stringify(rows.map((r) => r[0])) === JSON.stringify(['Bex Kitteh 1', 'Bex Kitteh 1', 'Bex Kitteh 1', 'Best Cats (FC)', 'Cal Kitteh 2', 'Dara Kitteh 3']),
    'ungrouped, places follow the Roster (Bex, Cal, Dara), not the biggest count: ' + rows.map((r) => r[0]).join(', '));
  const row = (who, where) => rows.find((r) => r[0] === who && r[2] === where);
  check(row('Cal Kitteh 2', 'Saddlebag')?.[3] === '2', 'HQ copies count with the normal ones');
  check(!rows.some((r) => r[3] === '1,000'), 'money slots are never searched');

  await type('TEST');
  found = await results();
  check(found.map((f) => f.title.split(/\s{2,}|\s(?=\d)/)[0]).join(',') === 'Test Ingot,Test Log,Test Ore', 'case does not matter, and only held items are listed: ' + found.map((f) => f.title).join(' / '));
  const ingot = found.find((f) => f.title.startsWith('Test Ingot'));
  check(ingot && ingot.rows.length === 1 && ingot.rows[0][0] === 'Best Cats (FC)' && ingot.rows[0][2] === 'FC chest tab 2' && ingot.rows[0][3] === '7', 'FC chests show the FC and the tab: ' + JSON.stringify(ingot && ingot.rows));

  // Word by word: every word, in any order.
  await type('log test');
  found = await results();
  check(found.length === 1 && /^Test Log\s+4 in 3 places$/.test(found[0].title), 'the words in any order find Test Log: ' + found.map((f) => f.title).join(' / '));
  await type('test ore ingot');
  check(/Nothing held matches/.test(await statusText()), 'a name needs every word');

  // Hide equipped gear: worn gear (on Dara and on Bex's retainer) is left out, and the total with it.
  await type('log test');
  const hideBox = `[...document.querySelectorAll('.where-is-it label')].find(l => l.innerText.includes('Hide equipped gear')).querySelector('input')`;
  await ev(`${hideBox}.click()`);
  await sleep(300);
  found = await results();
  check(found.length === 1 && /^Test Log\s+2 in 1 place$/.test(found[0].title) && found[0].rows.every((r) => !/Equipped|equipped/.test(r.join(' '))),
    'with Hide equipped gear, only the 2 in the bags: ' + JSON.stringify(found));
  // The same choice on Fleet: Test Log counts 2 there too, 4 without it.
  await ev(`[...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Fleet').click()`);
  await waitFor(`!!document.querySelector('input.hide-equipped')`, 'Fleet totals');
  await sleep(800);
  const fleetLog = () => ev(`(() => { const tr = [...document.querySelectorAll('tbody tr')].find(r => r.innerText.includes('Test Log')); return tr ? [...tr.children].map((td) => td.innerText.trim()).join(' ') : null; })()`);
  check(await ev(`document.querySelector('input.hide-equipped').checked`) === true, 'Fleet remembers the choice');
  check(/Test Log 2$/.test(await fleetLog() || ''), 'Fleet totals without worn gear: ' + await fleetLog());
  await ev(`document.querySelector('input.hide-equipped').click()`);
  await sleep(300);
  check(/Test Log 4$/.test(await fleetLog() || ''), 'Fleet totals with it: ' + await fleetLog());
  await ev(`[...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Where Is It?').click()`);
  await waitFor(`!!document.querySelector('.where-is-it input')`, 'Where Is It? again');
  await sleep(300);

  await type('100%');
  check(/Nothing held matches/.test(await statusText()), '% is taken literally: ' + await statusText());

  await nav('Summary');
  await sleep(300);
  await nav('Inventory');
  await waitFor(`!!document.querySelector('.where-is-it input')`, 'the search box');
  await sleep(800);
  check(await ev(`document.querySelector('.where-is-it input').value`) === '100%', 'the last search is kept when coming back');
};

module.exports.before = async (db) => {
  await db.query(`INSERT INTO companion_inventory_snapshot (owner_cid, retainer_id, sorted_container, sorted_slot_index, item_id, quantity) VALUES
    (${CAL}, ${CAL}, 4000, 0, 1005003, 2), (${CAL}, ${CAL}, 2000, 50, 5003, 1000), (${DARA}, ${DARA}, 1, 7, 5003, 500),
    (${DARA}, ${DARA}, 1, 90, 5004, 2), (${DARA}, ${DARA}, 1000, 90, 5004, 1), (${BEX}, 50000011, 11000, 90, 5004, 1)`);
  await db.query(`INSERT INTO companion_fc_inventory_snapshot (fc_id, sorted_container, sorted_slot_index, item_id, quantity) VALUES (9000001, 20000, 40, 5003, 3)`);
};

module.exports.after = async (db) => {
  await db.query(`DELETE FROM companion_inventory_snapshot WHERE owner_cid IN (${CAL}, ${DARA}) AND item_id IN (1005003, 5003)`);
  await db.query(`DELETE FROM companion_inventory_snapshot WHERE item_id = 5004`);
  await db.query(`DELETE FROM companion_fc_inventory_snapshot WHERE fc_id = 9000001 AND item_id = 5003`);
};
