// Every table on every tab has adjustable columns: resizable headers (and so movable and sortable ones from
// the same column library) and a Columns menu nearby. Goes through each tab and its views and lists any table
// without them. The Trends tab's table view is left out: its columns are the series chosen for the chart.
// A PC, a voyage, a venture reward and a listing are added so those tables show.

// The route added in before(), as the Income tab should show it.
let ranRoute = '';

module.exports = async (t) => {
  const { ev, sleep, waitFor, check, nav, clickText } = t;
  await ev(`window.localStorage.clear()`);

  // Tables on the page whose headers cannot be resized (popups and Settings are not tabs).
  const fixed = () => ev(`[...document.querySelectorAll('table')]
    .filter(t => !t.closest('.modal') && t.querySelector('thead th') && !t.querySelector('thead div[title="Drag to resize"]'))
    .map(t => t.className || [...t.querySelectorAll('thead th')].map(th => th.textContent.trim()).join('|'))`);
  const tableCount = () => ev(`[...document.querySelectorAll('table')].filter(t => !t.closest('.modal') && t.querySelector('thead div[title="Drag to resize"]')).length`);
  const pickers = () => ev(`document.querySelectorAll('.column-chooser-wrap').length`);

  const visit = async (label, ready, extra = async () => {}) => {
    await waitFor(ready, label, 30000);
    await sleep(600);
    await extra();
    const missing = await fixed();
    const n = await tableCount();
    check(missing.length === 0 && n > 0 && await pickers() > 0, `${label}: ${n} table(s), all with adjustable columns and a Columns menu${missing.length ? ' — not: ' + JSON.stringify(missing) : ''}`);
  };

  const tabs = [
    ['Summary', `!!document.querySelector('.house-warnings, .ready-subs, .low-supplies')`],
    ['Character Roster', `!!document.querySelector('tr[data-cid]')`],
    ['Free Companies', `document.querySelectorAll('tbody tr').length > 0`],
    ['Salvage', `document.querySelectorAll('tbody tr').length > 0`],
    ['Subs', `document.querySelectorAll('tbody tr').length > 0`],
    ['Supplies', `!!document.querySelector('.fc-credit-fcs')`],
    ['Income', `!!document.querySelector('.loot-subs') && !!document.querySelector('.venture-income')`],
    ['Route Optimization', `document.querySelectorAll('tbody tr').length > 0`],
    ['Retainers', `document.querySelectorAll('tbody tr').length > 0`],
    ['Gil & Market', `!!document.querySelector('.market-stale')`],
    ['PCs', `!!document.querySelector('.pcs-table')`],
  ];
  for (const [label, ready] of tabs) {
    await nav(label);
    await visit(label, ready);
  }

  // Parts: Summary, Detail (with the Sub Rules beside them) and the Shopping List.
  await nav('Parts');
  await visit('Parts summary and Sub Rules', `document.querySelectorAll('table').length >= 2`);
  await clickText('button', 'Detail');
  await visit('Parts detail', `document.querySelectorAll('tbody tr').length > 3`);
  await clickText('button', 'Shopping List');
  await visit('Shopping List', `!!document.querySelector('.shopping-parts table')`);

  // Inventory: Where Is It? and the fleet view.
  await nav('Inventory');
  await waitFor(`[...document.querySelectorAll('button')].some(b => b.innerText.trim() === 'Where Is It?')`, 'the Inventory views');
  await clickText('button', 'Where Is It?');
  await ev(`(() => { const input = document.querySelector('.where-is-it input[type=text]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'test o');
    input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await visit('Where Is It?', `!!document.querySelector('.where-item table')`);
  await clickText('button', 'Fleet');
  await visit('Inventory fleet', `document.querySelectorAll('tbody tr').length > 0`);

  // Loot per voyage shows each route in the order it was run (sector 20 first, then 15), not by number.
  await nav('Income');
  await waitFor(`!!document.querySelector('.loot-routes')`, 'the routes table');
  const routes = await ev(`[...document.querySelectorAll('.loot-routes tbody tr')].map(r => r.children[0].innerText.trim())`);
  check(routes.includes(ranRoute), `a route is shown in the order it was run (${ranRoute}): ` + JSON.stringify(routes));

  // A column taken off a new table stays off, and Reset brings it back.
  await nav('Gil & Market');
  await waitFor(`!!document.querySelector('.market-accounts')`, 'the gil table');
  const heads = () => ev(`[...document.querySelectorAll('.market-accounts thead th')].map(th => th.textContent.trim())`);
  await ev(`document.querySelector('.market-accounts').previousElementSibling.querySelector('.column-chooser-wrap > button').click()`);
  await waitFor(`!!document.querySelector('.column-chooser')`, 'the Columns menu');
  await ev(`document.querySelector('.column-chooser-row[data-column="characters"] button[title="Remove this column"]').click()`);
  await sleep(300);
  check(!(await heads()).includes('Characters'), 'a column can be taken off: ' + JSON.stringify(await heads()));
  await nav('PCs');
  await nav('Gil & Market');
  await waitFor(`!!document.querySelector('.market-accounts')`, 'the gil table again');
  check(!(await heads()).includes('Characters'), 'and it stays off when the tab is opened again');
  await ev(`document.querySelector('.market-accounts').previousElementSibling.querySelector('.column-chooser-wrap > button').click()`);
  await waitFor(`!!document.querySelector('.column-chooser')`, 'the Columns menu again');
  await clickText('.column-chooser button', 'Reset columns');
  await sleep(300);
  check((await heads()).includes('Characters'), 'Reset columns brings it back');
};

module.exports.before = async (db) => {
  const c = (await db.query(`
    SELECT c.cid::text AS cid, c.fc_id::text AS fc_id, s.sub_name, r.retainer_id::text AS retainer_id, r.name AS retainer_name
    FROM companion_character_current c
    JOIN companion_submarine_snapshot s ON s.cid = c.cid AND s.level > 0
    JOIN companion_retainer_lookup r ON r.owner_cid = c.cid
    WHERE c.fc_id IS NOT NULL ORDER BY c.name LIMIT 1`)).rows[0];
  await db.query(`INSERT INTO companion_pc_status (pc_name, account_label, plugin_version, last_sync_at, problems) VALUES ('DESKTOP-1', 'acct1', '0.10.0', now(), ARRAY[]::text[])`);
  await db.query(`INSERT INTO companion_voyage_loot (fc_id, sub_register, returned_at, sector, sub_name, primary_item, primary_count, primary_hq,
      additional_item, additional_count, additional_hq, valid) VALUES ($1, 1700000000, now() - interval '1 day', 15, $2, 22500, 3, false, 0, 0, false, true)`, [c.fc_id, c.sub_name]);
  await db.query(`INSERT INTO companion_voyage_loot (fc_id, sub_register, returned_at, sector, sub_name, primary_item, primary_count, primary_hq,
      additional_item, additional_count, additional_hq, valid, leg) VALUES
    ($1, 1700000001, now() - interval '1 day', 15, 'Ran-Order', 22500, 1, false, 0, 0, false, true, 2),
    ($1, 1700000001, now() - interval '1 day', 20, 'Ran-Order', 22500, 1, false, 0, 0, false, true, 1)`, [c.fc_id]);
  const letter = async (id) => ((await db.query('SELECT location FROM ffxiv_submarineexploration WHERE id = $1', [String(id)])).rows[0] || {}).location || String(id);
  ranRoute = `${await letter(20)}-${await letter(15)}`;
  await db.query(`INSERT INTO companion_venture_result (owner_cid, retainer_name, received_at, item_id, hq, quantity, venture_id) VALUES ($1, $2, now() - interval '1 day', 22500, false, 1, 395)`, [c.cid, c.retainer_name]);
  await db.query(`INSERT INTO companion_market_listing (retainer_id, owner_cid, slot, item_id, quantity, hq, unit_price, first_seen_at) VALUES ($1, $2, 0, 22500, 3, false, 9000, now() - interval '10 days')`, [c.retainer_id, c.cid]);
};

module.exports.after = async (db) => {
  await db.query('DELETE FROM companion_pc_status');
  await db.query('DELETE FROM companion_voyage_loot');
  await db.query('DELETE FROM companion_venture_result');
  await db.query('DELETE FROM companion_market_listing');
};
