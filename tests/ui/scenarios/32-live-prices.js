// Settings → General → Live Market Prices (universalis.js), against a stand-in Universalis on this machine:
// item 5111's cheapest listing is 8,500 on the character's world, 8,000 on the data center (Golem) and
// 7,000 in the region (Siren); one of the player's own retainers sells it for 100, which does not count.
// A voyage and a venture brought back 10 and 4 of it; a listing at 9,000 is undercut by 500.
const http = require('http');

const PORT = 9411;
let server = null;
let pick = null;
const asked = [];
const posts = []; // messages posted to the stand-in Discord webhook

module.exports = async (t) => {
  const { ev, sleep, waitFor, check, nav, shot } = t;
  await ev(`window.localStorage.clear()`);

  // Off by default: no market columns, nothing asked.
  await nav('Income');
  await waitFor(`!!document.querySelector('.loot-subs')`, 'Loot per Voyage', 20000);
  check(await ev(`!document.querySelector('.income-market') && !document.querySelector('.market-note')`), 'live prices are off until turned on');
  check(asked.length === 0, 'Universalis is not asked while off');

  await ev(`localStorage.setItem('settingsTab', 'general')`);
  await ev(`document.querySelector('.gear-button').click()`);
  await waitFor(`!!document.querySelector('.live-prices input[type=checkbox]')`, 'Live Market Prices');
  await ev(`document.querySelector('.live-prices input[type=checkbox]').click()`);
  await waitFor(`/Saved/.test(document.querySelector('.live-prices').innerText)`, 'the setting saved');
  await ev(`document.querySelector('.settings-modal .modal-actions button').click()`);
  await sleep(500);

  await nav('Summary');
  await nav('Income');
  await waitFor(`!!document.querySelector('.market-note')`, 'live prices on Income', 20000);
  check(/Maduin \/ Dynamis \/ NA/.test(await ev(`document.querySelector('.market-note').innerText`)), 'the note names the world, data center and region');
  const sub = await ev(`(() => { const tr = [...document.querySelectorAll('.loot-subs tbody tr')].find(r => r.innerText.includes(${JSON.stringify(pick.sub_name)}));
    return tr ? [...tr.querySelectorAll('.income-market')].map(td => td.innerText.trim()) : null; })()`);
  const perDay = (price) => Math.round(10 * price / 7).toLocaleString();
  check(JSON.stringify(sub) === JSON.stringify([perDay(8500), perDay(8000), perDay(7000)]),
    `a sub's loot a day at the cheapest listing on its world, data center and region: ${JSON.stringify(sub)}`);
  const venture = await ev(`(() => { const tr = [...document.querySelectorAll('.venture-income tbody tr')].find(r => r.children[0].innerText.trim() === ${JSON.stringify(pick.name)});
    return tr ? [...tr.querySelectorAll('.income-market')].map(td => td.innerText.trim()) : null; })()`);
  const vDay = (price) => Math.round(4 * price / 7).toLocaleString();
  check(JSON.stringify(venture) === JSON.stringify([vDay(8500), vDay(8000), vDay(7000)]), `venture rewards at market prices: ${JSON.stringify(venture)}`);
  check(asked.some((u) => u.startsWith('/api/v2/Maduin/')) && asked.some((u) => u.startsWith('/api/v2/Dynamis/')) && asked.some((u) => u.startsWith('/api/v2/North-America/')),
    'asked for the world, the data center and the region');
  const lootHeads = await ev(`[...document.querySelectorAll('.loot-subs thead th')].map(th => th.textContent.replace(/[▲▼]/g, '').trim())`);
  check(lootHeads.includes('Vendor gil / voyage') && lootHeads.includes('Vendor value / day') && lootHeads.includes('World market / day'),
    'vendor and market columns side by side, named as such: ' + JSON.stringify(lootHeads));
  await shot('income-live');

  await nav('Summary');
  await waitFor(`/market: /.test((document.querySelector('.retainers-income-tile') || {}).innerText || '')`, 'the market value on the Summary', 20000);
  const tile = await ev(`document.querySelector('.retainers-income-tile').innerText`);
  check(tile.includes('at what a vendor pays') && tile.includes('4,857 (World)') && tile.includes('4,571 (DC)') && tile.includes('4,000 (Region)'),
    'the Summary shows venture income at vendor and market prices: ' + JSON.stringify(tile));

  await nav('Gil & Market');
  await waitFor(`!!document.querySelector('.market-undercut')`, 'the undercut listings', 20000);
  const row = await ev(`[...document.querySelector('.market-undercut tbody tr').children].map(td => td.innerText.trim())`);
  const marketHeads = await ev(`[...document.querySelectorAll('.market-undercut thead th')].map(th => th.textContent.replace(/[▲▼]/g, '').trim())`);
  check(marketHeads.slice(0, 5).join('|') === 'Item|Qty|Price each|Vendor price|Cheaper by', 'the vendor price beside your price: ' + JSON.stringify(marketHeads));
  check(row[0] === 'Test Item 5111' && row.includes('500') && row.includes('8,500') && row.includes('8,000 (Golem)') && row.includes('7,000 (Siren)'),
    'an undercut listing: cheaper by 500, cheapest on the world, data center (Golem) and region (Siren): ' + JSON.stringify(row));
  check(await ev(`document.querySelectorAll('.market-undercut tbody tr').length`) === 1, 'only the undercut listing (own retainers do not count, the cheaper one is not undercut)');
  await shot('market-live');

  // Discord: the undercut alert from a check, and the summary with market values.
  const section = `document.querySelector('.alerts-section')`;
  const alertStatus = () => ev(`(${section}.querySelector('.alerts-status') || {}).innerText || ''`);
  const click = (text) => ev(`[...${section}.querySelectorAll('button')].find((x) => x.innerText.trim() === ${JSON.stringify(text)}).click()`);
  await ev(`localStorage.setItem('settingsTab', 'alerts')`);
  await ev(`document.querySelector('.gear-button').click()`);
  await waitFor(`!!${section} && !!${section}.querySelector('input.alerts-webhook')`, 'the Discord Alerts tab', 20000);
  await ev(`(() => { const el = ${section}.querySelector('input.alerts-webhook');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, 'http://127.0.0.1:${PORT}/api/webhooks/1/test');
    el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await click('Save');
  await waitFor(`${section}.innerText.includes('Discord webhook saved on this PC.')`, 'the saved webhook');
  await click('Check Now');
  await waitFor(`/Check: done|Check failed/.test((${section}.querySelector('.alerts-status') || {}).innerText || '')`, 'the alert check', 60000);
  const undercutPost = posts.map((p) => p.content).find((c) => /listing undercut/.test(c)) || '';
  check(/Maduin: 1 listing undercut\. Test Item 5111 on .+ \(.+\): yours 9,000, cheapest 8,500\./.test(undercutPost),
    'Discord: the undercut listing, with yours and the cheapest price: ' + JSON.stringify(undercutPost || posts.map((p) => p.content)) + ' ' + await alertStatus());
  const before = posts.length;
  await click('Send Summary Now');
  await waitFor(`${posts.length} < 0 || /Summary: (done|failed)|posted|failed/i.test((${section}.querySelector('.alerts-status') || {}).innerText || '')`, 'the summary', 60000);
  await sleep(500);
  const summary = (posts.slice(before).find((p) => /Fleet summary/.test(p.content)) || {}).content || '';
  check(/Ventures: 1 reward collected, worth 0 gil at vendor prices\. At market prices: 34,000 gil \(world\), 32,000 gil \(data center\), 28,000 gil \(region\)\./.test(summary),
    'the Discord summary gives venture rewards at vendor and market prices: ' + JSON.stringify(summary) + ' ' + await alertStatus());
  check(/all loot worth .+ gil at vendor prices\. At market prices: 85,000 gil \(world\)/.test(summary), 'and the loot: ' + JSON.stringify(summary));
  await ev(`document.querySelector('.settings-modal .modal-actions button').click()`);
  await sleep(300);

  // Turned off again: nothing more is asked.
  await ev(`localStorage.setItem('settingsTab', 'general')`);
  await ev(`document.querySelector('.gear-button').click()`);
  await waitFor(`!!document.querySelector('.live-prices input[type=checkbox]')`, 'Live Market Prices');
  await ev(`document.querySelector('.live-prices input[type=checkbox]').click()`);
  await waitFor(`/Saved/.test(document.querySelector('.live-prices').innerText)`, 'the setting saved');
  await ev(`document.querySelector('.settings-modal .modal-actions button').click()`);
  await sleep(800);
  check(await ev(`!document.querySelector('.market-undercut')`), 'turned off, the undercut listings go');
};

module.exports.setup = () => new Promise((resolve) => {
  const scopeOf = { maduin: 'world', dynamis: 'dc', 'north-america': 'region' };
  const price = { world: 8500, dc: 8000, region: 7000 };
  const where = { world: 'Maduin', dc: 'Golem', region: 'Siren' };
  server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url.startsWith('/api/webhooks/')) {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => { try { posts.push(JSON.parse(body)); } catch { posts.push({ content: body }); } res.writeHead(204); res.end(); });
      return undefined;
    }
    asked.push(req.url);
    const send = (body) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.url.startsWith('/api/v2/data-centers')) return send([{ name: 'Dynamis', region: 'North-America', worlds: [1] }]);
    if (req.url.startsWith('/api/v2/worlds')) return send([{ id: 1, name: 'Maduin' }]);
    const m = /^\/api\/v2\/([^/]+)\/([\d,]+)/.exec(req.url);
    if (!m) { res.writeHead(404); return res.end(); }
    const scope = scopeOf[decodeURIComponent(m[1]).toLowerCase()];
    const items = {};
    for (const id of m[2].split(',')) {
      items[id] = { itemID: Number(id), listings: id === '5111' && scope ? [
        { pricePerUnit: 100, quantity: 1, hq: false, retainerName: pick.retainer_name, worldName: 'Maduin' },
        { pricePerUnit: price[scope], quantity: 5, hq: false, retainerName: 'Someone', worldName: where[scope] },
      ] : [] };
    }
    return send({ itemIDs: m[2].split(',').map(Number), items });
  });
  server.listen(PORT, '127.0.0.1', resolve);
});
module.exports.teardown = () => new Promise((resolve) => (server ? server.close(() => resolve()) : resolve()));
module.exports.env = () => ({ FLEET_UNIVERSALIS_URL: `http://127.0.0.1:${PORT}`, FLEET_ALERTS_ALLOW_LOCAL_WEBHOOK: '1' });

module.exports.before = async (db) => {
  pick = (await db.query(`
    SELECT c.cid::text AS cid, c.name, c.fc_id::text AS fc_id, s.sub_name, r.retainer_id::text AS retainer_id, r.name AS retainer_name
    FROM companion_character_current c
    JOIN companion_submarine_snapshot s ON s.cid = c.cid AND s.level > 0
    JOIN companion_retainer_lookup r ON r.owner_cid = c.cid
    WHERE c.fc_id IS NOT NULL AND c.world = 'Maduin' ORDER BY c.name LIMIT 1`)).rows[0];
  await db.query(`INSERT INTO fleet_economics_settings (setting_key, setting_value) VALUES ('alert_enabled', 1)
                  ON CONFLICT (setting_key) DO UPDATE SET setting_value = 1`);
  await db.query(`INSERT INTO ffxiv_item (id, name) VALUES ('5111', 'Test Item 5111') ON CONFLICT (id) DO NOTHING`);
  await db.query(`INSERT INTO companion_voyage_loot (fc_id, sub_register, returned_at, sector, sub_name, primary_item, primary_count, primary_hq,
      additional_item, additional_count, additional_hq, valid) VALUES ($1, 1700000000, now() - interval '12 hours', 15, $2, 5111, 10, false, 0, 0, false, true)`, [pick.fc_id, pick.sub_name]);
  await db.query(`INSERT INTO companion_venture_result (owner_cid, retainer_name, received_at, item_id, hq, quantity, venture_id) VALUES ($1, $2, now() - interval '12 hours', 5111, false, 4, 395)`, [pick.cid, pick.retainer_name]);
  await db.query(`INSERT INTO companion_market_listing (retainer_id, owner_cid, slot, item_id, quantity, hq, unit_price, first_seen_at) VALUES
    ($1, $2, 0, 5111, 3, false, 9000, now() - interval '2 days'), ($1, $2, 1, 5111, 1, false, 8000, now() - interval '1 day')`, [pick.retainer_id, pick.cid]);
};

module.exports.after = async (db) => {
  await db.query('DELETE FROM companion_voyage_loot');
  await db.query('DELETE FROM companion_venture_result');
  await db.query('DELETE FROM companion_market_listing');
  await db.query(`DELETE FROM tier3_settings WHERE setting_key = 'universalis_enabled'`);
  await db.query(`DELETE FROM fleet_economics_settings WHERE setting_key LIKE 'alert\\_%'`);
  await db.query(`DELETE FROM ffxiv_item WHERE id = '5111' AND name = 'Test Item 5111'`);
};
