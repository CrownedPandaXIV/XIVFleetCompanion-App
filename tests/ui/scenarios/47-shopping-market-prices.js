// Parts → Shopping List with Live Market Prices on, against a stand-in Universalis on this machine. Most test
// characters are on Maduin (Dynamis, NA). Every item is listed at 100 gil, except:
//   Whale-class Hull (22528): 650,000 on Maduin, 600,000 on Dynamis (cheapest on Halicarnassus), 550,000 in NA
//   Whale-class Bridge (22526): 1 gil everywhere, so buying it is cheaper than making it
// Making a Whale part from materials at 100 gil each costs a few hundred gil, so the Hull is cheaper to make.
const http = require('http');

const PORT = 9412;
let server = null;
const asked = [];

module.exports = async (t) => {
  const { ev, waitFor, check, nav, clickText, shot } = t;
  await ev(`window.localStorage.clear()`);
  await nav('Parts');
  await waitFor(`[...document.querySelectorAll('.controls button')].some(b => b.innerText.trim() === 'Shopping List')`, 'the Parts tab', 20000);
  await clickText('.controls button', 'Shopping List');
  await waitFor(`!!document.querySelector('.shopping-list select')`, 'Prices from', 30000);

  const select = () => ev(`(() => { const s = document.querySelector('.shopping-list select');
    return { value: s.value, groups: [...s.querySelectorAll('optgroup')].map(g => [g.label, [...g.querySelectorAll('option')].map(o => o.innerText)]) }; })()`);
  const first = await select();
  check(first.value === 'dc:Dynamis', 'starts on the data center with the most characters: ' + first.value);
  // The test characters are on Behemoth, Cuchulainn and Maduin; the stand-in Universalis only knows Dynamis.
  check(JSON.stringify(first.groups) === JSON.stringify([['World', ['Behemoth', 'Cuchulainn', 'Maduin']], ['Data center', ['Dynamis']], ['Region', ['NA']]]),
    'worlds, data centers and regions to pick from: ' + JSON.stringify(first.groups));

  const part = (name) => ev(`(() => {
    const table = document.querySelector('.shopping-parts table');
    const heads = [...table.querySelectorAll('thead th')].map(th => th.innerText.trim().replace(/[\\u25B2\\u25BC]/g, '').trim().toLowerCase());
    const tr = [...table.querySelectorAll('tbody tr')].find(r => r.children[0].innerText.trim() === ${JSON.stringify(name)});
    return tr ? Object.fromEntries([...tr.children].map((td, i) => [heads[i], td.innerText.trim()])) : null;
  })()`);
  const hull = await part('Whale-class Hull');
  check(hull && hull['market board'] === '600,000 gil (Halicarnassus)', 'the cheapest on the data center, and its world: ' + JSON.stringify(hull));
  check(hull && /^[\d,]+ gil$/.test(hull['to make']) && hull.cheaper === 'Make', 'cheaper to make: ' + JSON.stringify(hull));
  const bridge = await part('Whale-class Bridge');
  check(bridge && bridge['market board'] === '1 gil (Maduin)' && bridge.cheaper === 'Buy', 'cheaper to buy: ' + JSON.stringify(bridge));
  const note = await ev(`[...document.querySelectorAll('.shopping-list .shopping-note')].map(e => e.innerText).find(t => t.startsWith('Market board prices')) || ''`);
  check(/^Market board prices from Dynamis/.test(note) && /Buying the parts not made yet: [\d,]+ gil/.test(note) && /Buying every material still short: [\d,]+ gil/.test(note),
    'where the prices are from and the totals: ' + note);
  const gatherHeads = await ev(`[...document.querySelectorAll('.shopping-gather thead th')].map(th => th.innerText.trim().toLowerCase())`);
  check(gatherHeads.some((h) => h.startsWith('market board')), 'materials have a market board column too: ' + JSON.stringify(gatherHeads));
  check(asked.some((u) => u.startsWith('/api/v2/Dynamis/')), 'asked Universalis for Dynamis');
  await shot('shopping-market-dc');

  // One world: no world named after each price; remembered on this PC.
  await ev(`(() => { const s = document.querySelector('.shopping-list select');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'world:Maduin');
    s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await waitFor(`(() => { const s = document.querySelector('.shopping-list select'); return s && s.value === 'world:Maduin'; })()`, 'Maduin chosen', 30000);
  await waitFor(`[...document.querySelectorAll('.shopping-parts tbody td')].some(td => td.innerText.trim() === '650,000 gil')`, "Maduin's price", 30000);
  check(await ev(`localStorage.getItem('shoppingPriceScope')`) === 'world:Maduin', 'remembered');
  check(asked.some((u) => u.startsWith('/api/v2/Maduin/')), 'asked Universalis for Maduin');

  // A region.
  await ev(`(() => { const s = document.querySelector('.shopping-list select');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'region:North-America');
    s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await waitFor(`[...document.querySelectorAll('.shopping-parts tbody td')].some(td => td.innerText.trim() === '550,000 gil (Siren)')`, 'the NA price', 30000);
  check(asked.some((u) => u.startsWith('/api/v2/North-America/')), 'asked Universalis for North America');
  await shot('shopping-market-region');
};

module.exports.setup = () => new Promise((resolve) => {
  const hull = { maduin: ['Maduin', 650000], dynamis: ['Halicarnassus', 600000], 'north-america': ['Siren', 550000] };
  server = http.createServer((req, res) => {
    asked.push(req.url);
    const send = (body) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.url.startsWith('/api/v2/data-centers')) return send([{ name: 'Dynamis', region: 'North-America', worlds: [1, 2] }]);
    if (req.url.startsWith('/api/v2/worlds')) return send([{ id: 1, name: 'Maduin' }, { id: 2, name: 'Halicarnassus' }]);
    const m = /^\/api\/v2\/([^/]+)\/([\d,]+)/.exec(req.url);
    if (!m) { res.writeHead(404); return res.end(); }
    const scope = decodeURIComponent(m[1]).toLowerCase();
    const items = {};
    for (const id of m[2].split(',')) {
      let listings = [{ pricePerUnit: 100, quantity: 99, hq: false, retainerName: 'Someone', worldName: 'Maduin' }];
      if (id === '22528' && hull[scope]) listings = [{ pricePerUnit: hull[scope][1], quantity: 1, hq: false, retainerName: 'Someone', worldName: hull[scope][0] }];
      if (id === '22526') listings = [{ pricePerUnit: 1, quantity: 1, hq: false, retainerName: 'Someone', worldName: 'Maduin' }];
      if (scope === 'maduin') listings = listings.map(({ worldName, ...rest }) => rest);
      items[id] = { itemID: Number(id), listings };
    }
    return send({ itemIDs: m[2].split(',').map(Number), items });
  });
  server.listen(PORT, '127.0.0.1', resolve);
});

module.exports.teardown = () => new Promise((resolve) => (server ? server.close(() => resolve()) : resolve()));
module.exports.env = () => ({ FLEET_UNIVERSALIS_URL: `http://127.0.0.1:${PORT}` });

module.exports.before = async (db) => {
  await db.query(`INSERT INTO tier3_settings (setting_key, setting_value) VALUES ('universalis_enabled', 'true')
                  ON CONFLICT (setting_key) DO UPDATE SET setting_value = 'true'`);
};

module.exports.after = async (db) => {
  await db.query(`DELETE FROM tier3_settings WHERE setting_key = 'universalis_enabled'`);
};
