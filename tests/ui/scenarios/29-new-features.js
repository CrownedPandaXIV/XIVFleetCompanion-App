// App 0.20.0: Summary's subs ready for new parts, ceruleum from FC credits (Supplies), loot per voyage
// and venture income (Income), the Gil & Market tab, the PCs tab, Shopping List progress, the summary and
// ready-for-parts choices in Settings → Discord Alerts, and right-click → Copy table / CSV on any table.
// The database version 8 tables are in the scratch database (db/schema.sql); this run adds two PCs, two
// voyages and three venture rewards for a character with subs, and two market listings (one up for 10
// days, one new).

let pick = null; // { cid, name, fc_id, sub_name, retainer_id, retainer_name, account_label }

module.exports = async (t) => {
  const { ev, sleep, waitFor, check, nav, clickText, shot } = t;
  await ev(`window.localStorage.clear()`);

  // ---- Summary: subs whose rank calls for new parts (the Parts tab's needs at rank above 0) ----
  await nav('Summary');
  await waitFor(`!!document.querySelector('.ready-subs') || /No sub has reached/.test(document.body.innerText)`, 'the ready subs section', 20000);
  await sleep(500);
  const expectedReady = await ev(`Promise.all([window.api.getPartsNeeded(), window.api.getFleetWarnings()]).then(([p, w]) => {
    const skip = new Set((w.notSynced || []).map(c => String(c.cid)));
    return new Set(p.rows.filter(x => x.rank > 0 && !skip.has(String(x.cid))).map(x => x.cid + '|' + x.sub_name)).size;
  })`);
  const shownReady = await ev(`document.querySelectorAll('.ready-subs tbody tr').length`);
  check(expectedReady > 0 && shownReady === expectedReady, `Summary lists each sub ready for new parts once (${shownReady} of ${expectedReady})`);
  check(/\((spare in .+|to craft)\)/.test(await ev(`(document.querySelector('.ready-subs tbody tr') || {}).innerText || ''`)), 'each part says where a spare is or that it is to craft');

  // ---- Supplies: ceruleum from FC credits, per FC, per account and for the fleet ----
  await nav('Supplies');
  await waitFor(`!!document.querySelector('.fc-credits')`, 'the FC credits section', 20000);
  const fcPoints = await t.query(`SELECT DISTINCT ON (fc_id) fc_id, fc_points FROM companion_character_housing WHERE fc_id IS NOT NULL ORDER BY fc_id, updated_at DESC`);
  const tanksAt = (cost) => fcPoints.reduce((sum, r) => sum + Math.floor((Number(r.fc_points) || 0) / cost), 0);
  const fleetTanks = () => ev(`Number(document.querySelector('.fc-credits .supply-card-value').innerText.replace(/[^0-9]/g, ''))`);
  check(await fleetTanks() === tanksAt(100), `the fleet's FC credits buy ${tanksAt(100)} tanks at 100 credits each`);
  check(await ev(`document.querySelectorAll('.fc-credit-fcs tbody tr').length`) === fcPoints.length, 'one row per Free Company');
  check(await ev(`document.querySelectorAll('.fc-credit-accounts tbody tr').length`) > 0, 'a row per account');
  await ev(`(() => { const input = document.querySelector('.fc-credits input[type=number]'); input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '50');
    input.dispatchEvent(new Event('input', { bubbles: true })); input.blur(); })()`);
  await waitFor(`Number(document.querySelector('.fc-credits .supply-card-value').innerText.replace(/[^0-9]/g, '')) === ${tanksAt(50)}`, 'the tanks at 50 credits', 10000);
  check((await t.query(`SELECT setting_value FROM fleet_economics_settings WHERE setting_key = 'fc_credit_tank_cost'`)).map((r) => Number(r.setting_value))[0] === 50,
    'the price per tank is saved for every PC, and the tanks follow it');
  await shot('fc-credits');

  // ---- Income: loot per voyage and venture income ----
  await nav('Income');
  await waitFor(`!!document.querySelector('.loot-subs')`, 'the loot per voyage table', 20000);
  const lootRow = await ev(`(() => { const tr = [...document.querySelectorAll('.loot-subs tbody tr')].find(r => r.children[1].innerText.trim() === ${JSON.stringify(pick.sub_name)});
    return tr ? [...tr.children].map(td => td.innerText.trim()) : null; })()`);
  // Voyage 1: 3 x 22500 (8,000) + 1 x 22505 (28,500); voyage 2: 2 x 22507 (34,500) = 52,500 + 69,000.
  check(lootRow && lootRow[0] === pick.name && lootRow[3] === '2' && lootRow[4] === (121500 / 2).toLocaleString(),
    'a sub\'s voyages, with its character and gil per voyage: ' + JSON.stringify(lootRow));
  check(await ev(`[...document.querySelectorAll('.loot-routes tbody tr')].some(r => r.children[0].innerText.trim() !== '')`), 'the routes taken are listed');
  const ventureRow = await ev(`(() => { const tr = [...document.querySelectorAll('.venture-income tbody tr')].find(r => r.children[0].innerText.trim() === ${JSON.stringify(pick.name)});
    return tr ? [...tr.children].map(td => td.innerText.trim()) : null; })()`);
  check(ventureRow && ventureRow[2] === '2' && ventureRow[3] === '3', 'venture rewards per character: 2 retainers, 3 rewards: ' + JSON.stringify(ventureRow));
  await shot('loot');

  // ---- Gil & Market ----
  await nav('Gil & Market');
  await waitFor(`!!document.querySelector('.market-accounts')`, 'the gil table', 20000);
  const gil = await t.query(`SELECT (SELECT coalesce(sum(gil), 0) FROM companion_character_current)
    + (SELECT coalesce(sum(r.gil), 0) FROM companion_retainer_lookup r JOIN companion_character_current c ON c.cid = r.owner_cid) AS total`);
  check(await ev(`document.querySelector('.market .supply-card-value').innerText`) === `${Number(gil[0].total).toLocaleString()} gil`,
    'fleet gil: characters and their retainers');
  const stale = await ev(`[...document.querySelectorAll('.market-stale tbody tr')].map(tr => [...tr.children].map(td => td.innerText.trim()))`);
  check(stale.length === 1 && stale[0][1] === '3' && stale[0][3] === '8,000' && stale[0][5] === '10 days' && stale[0][6] === pick.retainer_name,
    'only the listing up for 7+ days is listed, with its vendor price, age and retainer: ' + JSON.stringify(stale));

  // Right-click any table: Copy table and Export this table to CSV.
  const rows = await ev(`tableToRows(document.querySelector('.market-accounts'))`);
  check(JSON.stringify(rows[0]) === JSON.stringify(['Account', 'Characters', 'Character gil', 'Retainers', 'Retainer gil', 'Total']) && rows.length > 1,
    'a table is read row by row for the export: ' + JSON.stringify(rows.slice(0, 2)));
  check(await ev(`tableTitle(document.querySelector('.market-stale'))`) === 'Gil & Market - Listings Unsold for a While', 'the export is named after the tab and the table\'s heading');
  await ev(`document.querySelector('.market-accounts td').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 200 }))`);
  await waitFor(`!!document.querySelector('.table-menu')`, 'the table menu');
  check(JSON.stringify(await ev(`[...document.querySelectorAll('.table-menu button')].map(b => b.innerText)`)) === JSON.stringify(['Export this table to CSV', 'Copy table']),
    'right-clicking a table offers Export to CSV and Copy');
  await shot('table-menu');
  await ev(`document.body.click()`);
  await sleep(200);
  check(await ev(`!document.querySelector('.table-menu')`), 'clicking elsewhere closes it');

  await ev(`(() => { const input = document.querySelector('.market .controls input[type=number]'); input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '15');
    input.dispatchEvent(new Event('input', { bubbles: true })); input.blur(); })()`);
  await waitFor(`/Nothing has been up for 15 days/.test(document.querySelector('.market').innerText)`, 'no listing up for 15 days', 10000);
  check(true, 'up for at least 15 days: nothing');

  // ---- PCs ----
  await nav('PCs');
  await waitFor(`!!document.querySelector('.pcs-table')`, 'the PCs table', 20000);
  const pcs = await ev(`[...document.querySelectorAll('.pcs-table tbody tr')].map(tr => [...tr.children].map(td => ({ text: td.innerText.trim(), cls: td.className })))`);
  check(pcs.length === 2 && pcs[0][0].text.replace('×', '').trim() === 'DESKTOP-1' && pcs[1][0].text.replace('×', '').trim() === 'LAPTOP', 'one row per PC and account');
  check(pcs[0][2].cls.includes('supply-danger') && pcs[0][2].text === '0.11.1 (update)' && pcs[1][2].cls === '' && pcs[1][2].text === '0.14.0',
    'a plugin too old for this app shows red, marked "update": ' + JSON.stringify(pcs.map((r) => r[2])));
  check(/^Update the plugin on DESKTOP-1 \(acct1\)\. This version of the app needs plugin 0\.14\.0 or newer/.test(await ev(`document.querySelector('.pcs-update-plugin').innerText`)),
    'and a note above the table says which PC to update and how');
  check(pcs[0][10].text.startsWith('2 things') && pcs[1][10].text === 'Nothing', 'what each PC could not see');
  check(pcs[0][5].text === 'Yes' && pcs[1][5].text === 'No' && pcs[1][5].cls.includes('supply-warn') && !pcs[0][5].cls.includes('supply-warn'),
    'AutoRetainer comes first of the other plugins, amber when it is not running: ' + JSON.stringify(pcs.map((r) => r[5])));
  check(await ev(`[...document.querySelectorAll('.pcs-table thead th')].map(th => th.textContent.replace(/[▲▼]/g, '').trim()).slice(5, 10).join('|')`) ===
    'AutoRetainer|Allagan Tools|FC Tracker|Submarine Tracker|Venture Log', 'the other plugins, AutoRetainer first');
  check(await ev(`document.querySelectorAll('.pcs-check').length`) === 1 && /Check what I can see: DESKTOP-1 \(acct1\), .*, 1 thing to fix/.test(await ev(`document.querySelector('.pcs-check summary').innerText`)),
    'the last "Check what I can see" from a PC, folded');
  check(/No PC has reported for: acct0/.test(await ev(`(document.querySelector('.pcs-unreported') || {}).innerText || ''`)), 'accounts no PC has reported for are named');
  await shot('pcs');

  // A PC no longer used: the × beside its name, then "Yes, remove" (nothing before that).
  const laptopRow = `[...document.querySelectorAll('.pcs-table tbody tr')].find(tr => tr.children[0].innerText.startsWith('LAPTOP'))`;
  await ev(`${laptopRow}.querySelector('button.remove-character').click()`);
  await waitFor(`!!document.querySelector('.remove-confirm')`, 'the remove box', 5000);
  check(/Remove LAPTOP \(acct2\)\?/.test(await ev(`document.querySelector('.remove-confirm h2').innerText`)), 'the box names the PC and account');
  await ev(`[...document.querySelectorAll('.remove-confirm button')].find(b => b.textContent === 'No').click()`);
  check(Number((await t.query(`SELECT count(*) AS n FROM companion_pc_status`))[0].n) === 2, 'nothing is removed on "No"');
  await ev(`${laptopRow}.querySelector('button.remove-character').click()`);
  await waitFor(`!!document.querySelector('.remove-confirm')`, 'the remove box again', 5000);
  await ev(`[...document.querySelectorAll('.remove-confirm button')].find(b => b.textContent === 'Yes, remove').click()`);
  await waitFor(`document.querySelectorAll('.pcs-table tbody tr').length === 1 && !document.querySelector('.remove-confirm')`, 'the PC gone from the table', 10000);
  check((await t.query(`SELECT pc_name FROM companion_pc_status`)).map((r) => r.pc_name).join() === 'DESKTOP-1', 'only that PC\'s row is removed');

  // Without the database version 8 tables, the tab says the app adds them (and where to look if it couldn't).
  await t.query('ALTER TABLE companion_pc_status RENAME TO zz_pc_status');
  await nav('Summary');
  await nav('PCs');
  await waitFor(`!!document.querySelector('.pcs-missing')`, 'the note about the missing table', 20000);
  check(/The app adds it when it connects; if it couldn't, the banner at the top says why/.test(await ev(`document.querySelector('.pcs-missing').innerText`)),
    'without the PCs table, the PCs tab says the app adds it, not to run SQL');
  await t.query('ALTER TABLE zz_pc_status RENAME TO companion_pc_status');

  // ---- Shopping List progress ----
  await nav('Parts');
  await waitFor(`[...document.querySelectorAll('button')].some(b => b.innerText.trim() === 'Shopping List')`, 'the Shopping List button', 20000);
  await clickText('button', 'Shopping List');
  await waitFor(`!!document.querySelector('.shopping-parts .shopping-made')`, 'the Made column', 20000);
  const part = await ev(`(() => { const tr = document.querySelector('.shopping-parts tbody tr'); return { name: tr.children[0].innerText.trim(), crafts: Number(tr.children[1].innerText) }; })()`);
  await ev(`document.querySelector('.shopping-parts tbody tr .shopping-made input[type=checkbox]').click()`);
  await sleep(1000);
  const saved = await t.query(`SELECT setting_value FROM tier3_settings WHERE setting_key = 'shopping_progress'`);
  const progress = saved.length ? Object.values(JSON.parse(saved[0].setting_value)) : [];
  check(progress.length === 1 && progress[0].made === part.crafts && progress[0].outOf === part.crafts, `"all made" saves ${part.crafts} of ${part.crafts} for every PC: ` + JSON.stringify(progress));
  await nav('Summary');
  await nav('Parts');
  await waitFor(`[...document.querySelectorAll('button')].some(b => b.innerText.trim() === 'Shopping List')`, 'the Shopping List button again', 20000);
  await clickText('button', 'Shopping List');
  await waitFor(`!!document.querySelector('.shopping-parts .shopping-made')`, 'the Made column again', 20000);
  check(await ev(`(() => { const tr = document.querySelector('.shopping-parts tbody tr'); return tr.className.includes('shopping-done') && tr.querySelector('.shopping-made input[type=number]').value; })()`) === String(part.crafts),
    'reopened, the part is still ticked off');

  // ---- Settings → Discord Alerts: ready for new parts and the summary ----
  await ev(`document.querySelector('.gear-button').click()`);
  await waitFor(`!!document.querySelector('.settings-tab.active')`, 'Settings');
  await ev(`[...document.querySelectorAll('.settings-tab')].find((b) => b.innerText === 'Discord Alerts').click()`);
  await waitFor(`!!document.querySelector('.alerts-summary-every')`, 'the summary choice', 20000);
  check(await ev(`document.querySelector('.alerts-section').innerText.includes('A sub is ready for new parts')`), 'the ready-for-parts alert can be turned off');
  await ev(`(() => { const s = document.querySelector('.alerts-summary-every'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, '7'); s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await waitFor(`!!document.querySelector('.alerts-summary-day')`, 'the summary day');
  await clickText('.alerts-section button', 'Save Alert Settings');
  await sleep(1000);
  const summarySettings = await t.query(`SELECT setting_key, setting_value FROM fleet_economics_settings WHERE setting_key IN ('alert_summary_every', 'alert_summary_day', 'alert_summary_time') ORDER BY 1`);
  check(JSON.stringify(summarySettings.map((r) => Number(r.setting_value))) === JSON.stringify([1, 7, 540]), 'a weekly summary on Monday at 09:00 is saved: ' + JSON.stringify(summarySettings));
  await shot('summary-settings');
};

module.exports.before = async (db) => {
  pick = (await db.query(`
    SELECT c.cid::text AS cid, c.name, c.fc_id::text AS fc_id, c.account_label, s.sub_name, r.retainer_id::text AS retainer_id, r.name AS retainer_name
    FROM companion_character_current c
    JOIN companion_submarine_snapshot s ON s.cid = c.cid AND s.level > 0
    JOIN companion_retainer_lookup r ON r.owner_cid = c.cid
    WHERE c.fc_id IS NOT NULL AND c.account_label = 'acct1'
    ORDER BY c.name, s.sub_name, r.name LIMIT 1`)).rows[0];
  const second = (await db.query(`SELECT name FROM companion_retainer_lookup WHERE owner_cid = $1 AND name <> $2 LIMIT 1`, [pick.cid, pick.retainer_name])).rows[0];
  pick.second_retainer = second ? second.name : 'Other';
  await db.query(`INSERT INTO companion_pc_status (pc_name, account_label, plugin_version, last_sync_at, autoretainer_ready, allagantools_ready,
      fctracker_found, submarinetracker_found, venture_stats_found, characters_synced, characters_left_out, problems, check_text, check_to_fix, check_at) VALUES
    ('DESKTOP-1', 'acct1', '0.11.1', now() - interval '3 minutes', true, true, true, true, true, 1, 39,
     ARRAY['Open retainer Newret (Aki@Maduin) at a summoning bell.', 'Open the Free Company chest of Aki@Maduin''s FC.'],
     E'XIV Fleet Companion 0.10.0: what this PC can see\\n! Open Newret at a summoning bell on this PC.', 1, now() - interval '1 hour'),
    ('LAPTOP', 'acct2', '0.14.0', now() - interval '1 minute', false, true, true, false, true, 12, 0, ARRAY[]::text[], NULL, NULL, NULL)`);
  await db.query(`INSERT INTO companion_voyage_loot (fc_id, sub_register, returned_at, sector, sub_name, primary_item, primary_count, primary_hq,
      additional_item, additional_count, additional_hq, valid) VALUES
    ($1, 1700000000, now() - interval '2 days', 15, $2, 22500, 3, false, 22505, 1, false, true),
    ($1, 1700000000, now() - interval '1 day', 15, $2, 22507, 2, false, 0, 0, false, true)`, [pick.fc_id, pick.sub_name]);
  await db.query(`INSERT INTO companion_venture_result (owner_cid, retainer_name, received_at, item_id, hq, quantity, venture_id) VALUES
    ($1, $2, now() - interval '3 days', 22500, false, 1, 395), ($1, $2, now() - interval '2 days', 22501, false, 1, 395),
    ($1, $3, now() - interval '1 day', 22502, false, 1, 395)`, [pick.cid, pick.retainer_name, pick.second_retainer]);
  await db.query(`INSERT INTO companion_market_listing (retainer_id, owner_cid, slot, item_id, quantity, hq, unit_price, first_seen_at) VALUES
    ($1, $2, 0, 22500, 3, false, 9000, now() - interval '10 days 1 hour'), ($1, $2, 1, 22501, 1, false, 9500, now() - interval '1 hour')`, [pick.retainer_id, pick.cid]);
};

module.exports.after = async (db) => {
  await db.query('DELETE FROM companion_pc_status');
  await db.query('DELETE FROM companion_voyage_loot');
  await db.query('DELETE FROM companion_venture_result');
  await db.query('DELETE FROM companion_market_listing');
  await db.query(`DELETE FROM tier3_settings WHERE setting_key = 'shopping_progress'`);
  await db.query(`DELETE FROM fleet_economics_settings WHERE setting_key IN ('fc_credit_tank_cost', 'market_stale_days', 'alert_summary_every', 'alert_summary_day', 'alert_summary_time')`);
  await db.query(`DELETE FROM fleet_economics_settings WHERE setting_key LIKE 'alert\\_%'`);
};
