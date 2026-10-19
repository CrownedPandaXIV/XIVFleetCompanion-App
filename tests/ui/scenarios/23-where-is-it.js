// Inventory → Where Is It?: type part of an item name and see every place it is held, with counts. From
// tests/ui/fixtures.sql: Test Ore sits in Bex Kitteh 1's bags (5), a retainer's bag (10) and up for sale
// by that retainer (99); Test Ingot in an FC chest (7). Added for this run: 2 HQ Test Ore in Cal Kitteh
// 2's saddlebag (counted with the normal ones), 1000 in a currency slot (never searched), 500 in Dara
// Kitteh 3's bags and 3 in Bex's Free Company chest. Roster order is Bex (acct1), Cal (acct2), Dara
// (acct0); results follow it and, by default, are grouped by account (acct0, acct1, acct2).
const CAL = '18014498578000002';
const DARA = '18014498578000003';

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
    rows: [...div.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(td => td.innerText.trim())),
  }))`);
  const statusText = () => ev(`[...document.querySelectorAll('.where-is-it > .status')].map(s => s.innerText).join(' ')`);

  await type('t');
  check(/at least 2 letters/.test(await statusText()), 'one letter asks for more');

  await type('test o');
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
  check(found.map((f) => f.title.split(/\s{2,}|\s(?=\d)/)[0]).join(',') === 'Test Ingot,Test Ore', 'case does not matter, and only held items are listed: ' + found.map((f) => f.title).join(' / '));
  const ingot = found.find((f) => f.title.startsWith('Test Ingot'));
  check(ingot && ingot.rows.length === 1 && ingot.rows[0][0] === 'Best Cats (FC)' && ingot.rows[0][2] === 'FC chest tab 2' && ingot.rows[0][3] === '7', 'FC chests show the FC and the tab: ' + JSON.stringify(ingot && ingot.rows));

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
    (${CAL}, ${CAL}, 4000, 0, 1005003, 2), (${CAL}, ${CAL}, 2000, 50, 5003, 1000), (${DARA}, ${DARA}, 1, 7, 5003, 500)`);
  await db.query(`INSERT INTO companion_fc_inventory_snapshot (fc_id, sorted_container, sorted_slot_index, item_id, quantity) VALUES (9000001, 20000, 40, 5003, 3)`);
};

module.exports.after = async (db) => {
  await db.query(`DELETE FROM companion_inventory_snapshot WHERE owner_cid IN (${CAL}, ${DARA}) AND item_id IN (1005003, 5003)`);
  await db.query(`DELETE FROM companion_fc_inventory_snapshot WHERE fc_id = 9000001 AND item_id = 5003`);
};
