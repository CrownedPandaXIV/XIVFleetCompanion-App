const test = require('node:test');
const assert = require('node:assert');
const { parseItems, ownRetainerKeys, cheapestListing, createUniversalis, scopePrices, KNOWN_DATA_CENTERS, worldPlaces } = require('../characters/universalis');
const { compareListings } = require('../characters/market');
const { marketLoot, voyagesFrom } = require('../subs/loot');

const listing = (pricePerUnit, extra = {}) => ({ pricePerUnit, quantity: 1, hq: false, retainerName: 'Seller', ...extra });

test('answers for several items and for one item are both read', () => {
  const many = parseItems({ itemIDs: [5111, 4], items: { 5111: { itemID: 5111, listings: [listing(10)] }, 4: { itemID: 4, listings: [] } } });
  assert.deepStrictEqual([...many.keys()].sort(), [4, 5111]);
  const one = parseItems({ itemID: 5111, listings: [listing(7)] });
  assert.strictEqual(one.get(5111)[0].pricePerUnit, 7);
  assert.strictEqual(parseItems(null).size, 0);
});

test('the cheapest listing: by quality, leaving out your own retainers', () => {
  const listings = [listing(500, { hq: true, worldName: 'Golem' }), listing(300, { retainerName: 'MyRet' }), listing(400, { worldName: 'Maduin' })];
  assert.deepStrictEqual(cheapestListing(listings), { price: 300, world: null });
  const mine = ownRetainerKeys([{ name: 'MyRet', world: 'Maduin' }]);
  assert.deepStrictEqual(cheapestListing(listings, { exclude: mine, world: 'Maduin' }), { price: 400, world: 'Maduin' },
    'on its own world (the listing names none when one world is asked for), your retainer is left out');
  assert.deepStrictEqual(cheapestListing([listing(300, { retainerName: 'MyRet', worldName: 'Maduin' }), listing(400)], { exclude: mine }), { price: 400, world: null },
    'and when the listing names the world');
  assert.deepStrictEqual(cheapestListing([listing(300, { retainerName: 'myret', worldName: 'Golem' }), listing(400)], { exclude: mine }), { price: 300, world: 'Golem' },
    'another player\'s retainer of the same name on another world still counts');
  assert.deepStrictEqual(cheapestListing(listings, { hq: true }), { price: 500, world: 'Golem' });
  assert.strictEqual(cheapestListing([], {}), null);
});

test('worlds belong to their data center and region (built-in list)', () => {
  const places = worldPlaces(KNOWN_DATA_CENTERS);
  assert.deepStrictEqual(places.get('maduin'), { dc: 'Dynamis', region: 'North-America' });
  assert.deepStrictEqual(places.get('ragnarok'), { dc: 'Chaos', region: 'Europe' });
});

function fakeFetch(answers, calls) {
  return async (url) => {
    calls.push(url);
    for (const [part, body] of answers) {
      if (url.includes(part)) {
        if (typeof body === 'number') return { ok: false, status: body, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => body };
      }
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

test('prices for a world, its data center and its region, asked once and kept for 30 minutes', async () => {
  const calls = [];
  let now = 0;
  const u = createUniversalis({
    baseUrl: 'http://stub',
    now: () => now,
    fetchImpl: fakeFetch([
      ['/data-centers', [{ name: 'Dynamis', region: 'North-America', worlds: [1] }]],
      ['/worlds', [{ id: 1, name: 'Maduin' }]],
      ['/Maduin/', { items: { 5111: { itemID: 5111, listings: [listing(30)] }, 4: { itemID: 4, listings: [] } } }],
      ['/Dynamis/', { items: { 5111: { itemID: 5111, listings: [listing(20, { worldName: 'Golem' })] } } }],
      ['/North-America/', { items: { 5111: { itemID: 5111, listings: [listing(10, { worldName: 'Siren' })] } } }],
    ], calls),
  });
  const m = await u.marketFor(['Maduin'], [5111, 4]);
  const maduin = m.get('Maduin');
  assert.deepStrictEqual(maduin.names, { world: 'Maduin', dc: 'Dynamis', region: 'NA' });
  assert.strictEqual(cheapestListing(maduin.listings.world.get(5111)).price, 30);
  assert.deepStrictEqual(cheapestListing(maduin.listings.dc.get(5111)), { price: 20, world: 'Golem' });
  assert.deepStrictEqual(cheapestListing(maduin.listings.region.get(5111)), { price: 10, world: 'Siren' });
  assert.ok(calls.some((c) => c.includes('/api/v2/Maduin/5111,4?listings=20&entries=0')), calls.join(' '));
  const asked = calls.length;
  await u.marketFor(['Maduin'], [5111]);
  assert.strictEqual(calls.length, asked, 'kept: not asked again');
  now = 31 * 60 * 1000;
  await u.marketFor(['Maduin'], [5111]);
  assert.strictEqual(calls.length, asked + 3, 'asked again after 30 minutes');
  const prices = scopePrices(maduin, 'region', new Map([[5111, 1], [22500, 8000]]));
  assert.deepStrictEqual([prices.get(5111), prices.get(22500)], [10, 8000], 'not on the market board: the vendor price');
});

test('many items are asked for 50 at a time; a busy or unreachable Universalis says so', async () => {
  const calls = [];
  const ids = Array.from({ length: 120 }, (_, i) => i + 1);
  const u = createUniversalis({ baseUrl: 'http://stub', fetchImpl: fakeFetch([['/data-centers', []], ['/worlds', []], ['/api/v2/', { items: {} }]], calls) });
  await u.marketFor(['Maduin'], ids);
  assert.strictEqual(calls.filter((c) => c.includes('/api/v2/Maduin/')).length, 3);
  const busy = createUniversalis({ baseUrl: 'http://stub', fetchImpl: fakeFetch([['/data-centers', 429], ['/api/v2/', 429]], []) });
  await assert.rejects(busy.marketFor(['Maduin'], [1]), /busy/);
  const down = createUniversalis({ baseUrl: 'http://stub', fetchImpl: async () => { throw new Error('ENOTFOUND'); } });
  await assert.rejects(down.marketFor(['Maduin'], [1]), /could not be reached \(ENOTFOUND\)/);
});

test('a listing someone sells cheaper on its world is undercut; your own retainers do not count', () => {
  const market = new Map([['Maduin', { listings: {
    world: new Map([[5111, [listing(80, { retainerName: 'MyRet' }), listing(90), listing(70, { hq: true })]]]),
    dc: new Map([[5111, [listing(60, { worldName: 'Golem' })]]]),
    region: new Map(),
  } }]]);
  const [mine, fine] = compareListings([
    { item_id: 5111, hq: false, unit_price: 100, quantity: 2, world: 'Maduin' },
    { item_id: 5111, hq: false, unit_price: 85, quantity: 1, world: 'Maduin' },
  ], { market, cheapest: cheapestListing, exclude: ownRetainerKeys([{ name: 'MyRet', world: 'Maduin' }]) });
  assert.deepStrictEqual([mine.undercut, mine.undercutBy, mine.others.world.price, mine.others.dc.price, mine.others.region], [true, 10, 90, 60, null]);
  assert.strictEqual(fine.undercut, false);
});

test('loot at market prices: per sub, per route and in total, per scope', () => {
  const rows = [
    { fc_id: '9', sub_register: 1, returned_at: '2026-10-05T10:00:00Z', sector: 10, primary_item: 5111, primary_count: 2, additional_item: 22500, additional_count: 1 },
    { fc_id: '9', sub_register: 2, returned_at: '2026-10-05T10:00:00Z', sector: 10, primary_item: 5111, primary_count: 1, additional_item: 0, additional_count: 0 },
  ];
  const prices = { world: new Map([[5111, 100], [22500, 8000]]), dc: new Map([[5111, 50], [22500, 8000]]), region: new Map([[5111, 10], [22500, 8000]]) };
  const out = marketLoot(voyagesFrom(rows), { worldOf: new Map([['9|1', 'Maduin']]), priceFor: (w, scope) => prices[scope], windowDays: 2 });
  assert.deepStrictEqual(out.world.subs.get('9|1'), { gil: 8200, voyages: 1, perVoyage: 8200, perDay: 4100 });
  assert.strictEqual(out.region.subs.get('9|1').gil, 8020);
  assert.strictEqual(out.world.subs.has('9|2'), false, 'a sub with no known world is left out');
  assert.deepStrictEqual([out.dc.totals.gil, out.dc.routes.get('J') === undefined], [8100, true]);
});

test('a 404 (nothing asked for is on the market board, such as one salvage item) is no listings, not an error', async () => {
  const calls = [];
  const u = createUniversalis({ baseUrl: 'http://stub', fetchImpl: fakeFetch([['/data-centers', []], ['/worlds', []], ['/api/v2/', 404]], calls) });
  const m = await u.marketFor(['Maduin'], [22500]);
  assert.deepStrictEqual(m.get('Maduin').listings.world.get(22500), []);
  assert.strictEqual(m.get('Maduin').stale, null);
});

test('when Universalis does not answer later, the last prices are kept and said to be from earlier', async () => {
  let now = 0;
  let down = false;
  const listings = { items: { 5111: { itemID: 5111, listings: [{ pricePerUnit: 30, hq: false, retainerName: 'X' }] } } };
  const u = createUniversalis({
    baseUrl: 'http://stub',
    now: () => now,
    fetchImpl: async (url) => {
      if (url.includes('/data-centers') || url.includes('/worlds')) return { ok: true, status: 200, json: async () => [] };
      if (down) return { ok: false, status: 503, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => listings };
    },
  });
  await u.marketFor(['Maduin'], [5111]);
  now = 31 * 60 * 1000;
  down = true;
  const later = (await u.marketFor(['Maduin'], [5111])).get('Maduin');
  assert.strictEqual(cheapestListing(later.listings.world.get(5111)).price, 30, 'the last price is kept');
  assert.deepStrictEqual(later.stale, { problem: 'Universalis answered 503.', since: 0 });
  await assert.rejects(u.marketFor(['Maduin'], [5111, 4]), /answered 503/, 'an item never priced before still fails');
  down = false;
  assert.strictEqual((await u.marketFor(['Maduin'], [5111])).get('Maduin').stale, null, 'back to normal at the next answer');
});

test('HQ items are priced at the cheapest HQ listing, else either quality', () => {
  const market = { listings: { world: new Map([[1, [listing(100), listing(400, { hq: true })]], [2, [listing(50)]]]) } };
  const nq = scopePrices(market, 'world', new Map());
  const hq = scopePrices(market, 'world', new Map(), undefined, { hq: true });
  assert.deepStrictEqual([nq.get(1), hq.get(1), hq.get(2)], [100, 400, 50]);
});

test('the Shopping List asks for one world, data center or region at a time, kept for 30 minutes', async () => {
  const calls = [];
  let at = 0;
  const u = createUniversalis({
    baseUrl: 'http://stub', now: () => at,
    fetchImpl: fakeFetch([['/data-centers', []], ['/worlds', []], ['/api/v2/', { items: { 22528: { itemID: 22528, listings: [listing(600, { worldName: 'Halicarnassus' })] } } }]], calls),
  });
  const first = await u.listingsIn('Dynamis', [22528, 22528, 0]);
  assert.deepStrictEqual([...first.listings.keys()], [22528]);
  assert.strictEqual(first.stale, null);
  assert.ok(calls[0].includes('/api/v2/Dynamis/22528'), calls[0]);
  at = 29 * 60 * 1000;
  await u.listingsIn('Dynamis', [22528]);
  assert.strictEqual(calls.length, 1, 'kept');
  await u.listingsIn('North-America', [22528]);
  assert.strictEqual(calls.length, 2, 'another scope is asked for');
  assert.deepStrictEqual((await u.listingsIn('Dynamis', [])).listings.size, 0);
});
