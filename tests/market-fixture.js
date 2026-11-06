// Live market prices for made-up fleets, for the plugin's own Universalis code to be checked against (plugin 2.0's
// Gil & Market page asks Universalis itself, as the app does, when Live Market Prices is on). Universalis is stood in
// for by canned listings; the app's own code (characters/universalis.js, characters/market.js compareListings,
// subs/loot.js ventureMarketGil) works out each listing's cheapest rivals and whether it's undercut, and each
// character's venture rewards at market prices. The canned listings, the inputs and the answers go to one file:
//
//   node tests/market-fixture.js ../XIVFleetCompanion/tests/FleetWriterTests/market-fixture.json
//
// Without a file it only checks that every case works out. No database needed.
const fs = require('fs');
const { createUniversalis, cheapestListing, ownRetainerKeys, scopePrices, SCOPES } = require('../characters/universalis');
const { compareListings } = require('../characters/market');
const { ventureMarketGil } = require('../subs/loot');

// Data centers as Universalis lists them (two of them), so worlds outside them have no data center or region.
const DATA_CENTERS = [
  { name: 'Dynamis', region: 'North-America', worlds: [4001, 4002, 4003] },
  { name: 'Primal', region: 'North-America', worlds: [4004, 4005] },
];
const WORLDS = [{ id: 4001, name: 'Maduin' }, { id: 4002, name: 'Golem' }, { id: 4003, name: 'Cuchulainn' }, { id: 4004, name: 'Behemoth' }, { id: 4005, name: 'Exodus' }];

// A stand-in for Universalis answering from `canned` (scope -> itemId -> listings): several items answer
// { items: {...} }, one answers the item itself, none on the market board a 404.
function fakeFetch(canned) {
  return async (url) => {
    const path = new URL(url).pathname;
    const reply = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
    if (path === '/api/v2/data-centers') return reply(200, DATA_CENTERS);
    if (path === '/api/v2/worlds') return reply(200, WORLDS);
    const m = /^\/api\/v2\/([^/]+)\/([\d,]+)$/.exec(path);
    if (!m) return reply(404, {});
    const scope = decodeURIComponent(m[1]);
    const ids = m[2].split(',').map(Number);
    const found = ids.filter((id) => canned[scope] && canned[scope][id]);
    if (found.length === 0) return reply(404, {});
    const item = (id) => ({ itemID: id, listings: canned[scope][id] });
    return reply(200, ids.length === 1 ? item(ids[0]) : { items: Object.fromEntries(found.map((id) => [id, item(id)])) });
  };
}

function fleet(seed) {
  const random = () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const pick = (list) => list[Math.floor(random() * list.length)];
  const chance = (p) => random() < p;
  const ITEMS = [5111, 6000, 22500, 27800, 40001, 40002, 40003, 40004];
  const worlds = ['Maduin', 'Golem', 'Behemoth', 'Faraway'];
  const characters = worlds.flatMap((world, w) => [1, 2].map((k) => ({ cid: String(1000 + w * 10 + k), world })));
  const retainers = characters.flatMap((c, i) => [0, 1].map((r) => ({ name: `Ret${i}${r}`, world: c.world, owner: c.cid })));
  const canned = {};
  const scopes = ['Maduin', 'Golem', 'Cuchulainn', 'Behemoth', 'Exodus', 'Faraway', 'Dynamis', 'Primal', 'North-America'];
  for (const scope of scopes) {
    canned[scope] = {};
    for (const id of ITEMS) {
      if (id === 22500 || chance(0.2)) continue; // salvage is never on the market board; others now and then not
      const listings = [];
      for (let n = Math.floor(random() * 6); n > 0; n--) {
        const own = chance(0.15) ? pick(retainers) : null;
        const isWorld = !['Dynamis', 'Primal', 'North-America'].includes(scope);
        listings.push({
          pricePerUnit: chance(0.05) ? 0 : 50 + Math.floor(random() * 5000), quantity: pick([1, 5, 99]), hq: chance(0.4),
          retainerName: own ? own.name : `Other${Math.floor(random() * 50)}`,
          // Universalis leaves out the world when asked for one world; a data center or region names it.
          worldName: isWorld ? (chance(0.5) ? undefined : scope) : (own && chance(0.7) ? own.world : pick(['Maduin', 'Golem', 'Cuchulainn', 'Behemoth', 'Exodus'])),
        });
      }
      canned[scope][id] = listings;
    }
  }
  const listings = [];
  for (let i = 0; i < 25; i++) {
    const r = pick(retainers);
    listings.push({ retainer_id: String(5000 + i), slot: i, item_id: pick(ITEMS), hq: chance(0.4), quantity: pick([1, 3, 99]), unit_price: 40 + Math.floor(random() * 6000),
      world: r.world, retainer_name: r.name });
  }
  const ventures = characters.filter(() => chance(0.8)).map((c) => ({
    cid: c.cid, world: c.world,
    items: ITEMS.filter(() => chance(0.5)).map((id) => { const quantity = 1 + Math.floor(random() * 30); return { item_id: id, quantity, hq_quantity: Math.floor(random() * (quantity + 1)) }; }),
  }));
  const vendor = Object.fromEntries(ITEMS.map((id) => [id, id === 22500 ? 8000 : Math.floor(random() * 300)]));
  return { canned, retainers, listings, ventures, vendor };
}

(async () => {
  const out = process.argv[2];
  const cases = [];
  for (const seed of [3, 77, 2026]) {
    const f = fleet(seed);
    const universalis = createUniversalis({ fetchImpl: fakeFetch(f.canned), baseUrl: 'https://universalis.test' });
    const exclude = ownRetainerKeys(f.retainers);
    const worlds = [...f.listings.map((l) => l.world), ...f.ventures.map((v) => v.world)];
    const ids = [...f.listings.map((l) => l.item_id), ...f.ventures.flatMap((v) => v.items.map((i) => i.item_id))];
    const market = await universalis.marketFor(worlds, ids);
    const compared = compareListings(f.listings, { market, cheapest: cheapestListing, exclude }).map((l) => ({
      retainer_id: l.retainer_id, slot: l.slot, undercut: l.undercut, undercut_by: l.undercutBy,
      others: Object.fromEntries(SCOPES.map((s) => [s, l.others[s]])),
    }));
    const vendor = new Map(Object.entries(f.vendor).map(([k, v]) => [Number(k), v]));
    const ventures = f.ventures.map((v) => {
      const rows = v.items.flatMap((i) => [{ item_id: i.item_id, hq: false, quantity: i.quantity - i.hq_quantity }, { item_id: i.item_id, hq: true, quantity: i.hq_quantity }]);
      const gil = Object.fromEntries(SCOPES.map((scope) => {
        const m = market.get(v.world);
        return [scope, ventureMarketGil(rows, scopePrices(m, scope, vendor, exclude), scopePrices(m, scope, vendor, exclude, { hq: true }))];
      }));
      return { cid: v.cid, gil };
    });
    const names = [...market.entries()].map(([world, m]) => ({ world, names: m.names }));
    console.log(`seed ${seed}: ${compared.length} listings, ${compared.filter((l) => l.undercut).length} undercut, ${ventures.length} characters' ventures`);
    cases.push({ name: `seed ${seed}`, dataCenters: DATA_CENTERS, worlds: WORLDS, canned: f.canned, retainers: f.retainers, listings: f.listings,
      ventures: f.ventures, vendor: f.vendor, expected: { names, listings: compared, ventures } });
  }
  if (out) {
    fs.writeFileSync(out, `${JSON.stringify({ about: 'Written by XIVFleetCompanion-App tests/market-fixture.js: canned Universalis listings and the app\'s live market answers.', cases })}\n`);
    console.log(`written to ${out}`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
