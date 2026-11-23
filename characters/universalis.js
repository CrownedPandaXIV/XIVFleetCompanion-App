// Live market prices from Universalis (universalis.app, the crowd-sourced market board site), when turned on
// in Settings → General → Live Market Prices (tier3_settings 'universalis_enabled'; off by default). For each
// item: its market price (marketPrice: the cheapest listing, skipping lone low listings and checked against the last
// week's sales) on a character's home world, on its data center and on its region (NA, EU, JP, OCE). Used for the market value of loot and venture rewards (Income, Summary) and to spot listings that
// someone else sells cheaper (Gil & Market). Only item numbers and world, data center and region names are
// sent. Answers are kept for 30 minutes. No Electron or pg here, so it can be tested on its own
// (tests/universalis.test.js); `fetchImpl` and the address can be swapped for tests.

const SETTING_KEY = 'universalis_enabled';
const DEFAULT_URL = 'https://universalis.app';
const USER_AGENT = 'XIVFleetCompanion';
const BATCH = 50; // item ids per request
const PARALLEL = 4; // requests at once
// Listings per item, cheapest first: enough that the Shopping List's "buying all of them" covers what a fleet needs
// (with 20, a material needed in the thousands looked short when plenty more was for sale).
const LISTINGS = 100;
const KEEP_MS = 30 * 60 * 1000;
// Recent sales asked for with the listings: up to this many, from the last week (the check on a low listing).
const SALES = 100;
const SALES_WITHIN_S = 7 * 24 * 60 * 60;
const WEEK_MS = SALES_WITHIN_S * 1000;
// A listing under this share of the typical price is an outlier: of the five cheapest listings' middle price
// (step 2), then of the last week's middle sale price (step 3). A starting guess, easy to change.
const OUTLIER_SHARE = 0.5;
const AGREEING_LISTINGS = 3; // listings near the cheapest that make it the market price, whatever the sales were
// How long one request may take, answer included, before it counts as no answer (the plugin's too).
const TIMEOUT_MS = 20 * 1000;
const SCOPES = ['world', 'dc', 'region'];

const REGION_LABELS = { 'North-America': 'NA', Europe: 'EU', Japan: 'JP', Oceania: 'OCE', 中国: 'CN', 한국: 'KR' };

// Used when Universalis's own list of data centers cannot be read.
const KNOWN_DATA_CENTERS = [
  ['Aether', 'North-America', 'Adamantoise Cactuar Faerie Gilgamesh Jenova Midgardsormr Sargatanas Siren'],
  ['Primal', 'North-America', 'Behemoth Excalibur Exodus Famfrit Hyperion Lamia Leviathan Ultros'],
  ['Crystal', 'North-America', 'Balmung Brynhildr Coeurl Diabolos Goblin Malboro Mateus Zalera'],
  ['Dynamis', 'North-America', 'Cuchulainn Golem Halicarnassus Kraken Maduin Marilith Rafflesia Seraph'],
  ['Chaos', 'Europe', 'Cerberus Louisoix Moogle Omega Phantom Ragnarok Sagittarius Spriggan'],
  ['Light', 'Europe', 'Alpha Lich Odin Phoenix Raiden Shiva Twintania Zodiark'],
  ['Shadow', 'Europe', 'Innocence Pixie Titania Tycoon'],
  ['Materia', 'Oceania', 'Bismarck Ravana Sephirot Sophia Zurvan'],
  ['Elemental', 'Japan', 'Aegis Atomos Carbuncle Garuda Gungnir Kujata Tonberry Typhon'],
  ['Gaia', 'Japan', 'Alexander Bahamut Durandal Fenrir Ifrit Ridill Tiamat Ultima'],
  ['Mana', 'Japan', 'Anima Asura Chocobo Hades Ixion Masamune Pandaemonium Titan'],
  ['Meteor', 'Japan', 'Belias Mandragora Ramuh Shinryu Unicorn Valefor Yojimbo Zeromus'],
].map(([name, region, worlds]) => ({ name, region, worlds: worlds.split(' ') }));

// Lowercase world name -> { name, dc, region } from a list of { name, region, worlds: [world names] }.
function worldPlaces(dataCenters) {
  const places = new Map();
  for (const dc of dataCenters) {
    for (const world of dc.worlds) places.set(String(world).toLowerCase(), { name: String(world), dc: dc.name, region: dc.region });
  }
  return places;
}

// One answer's recent sales: Map itemId -> sales ([{ pricePerUnit, quantity, hq, timestamp (seconds), worldName }]).
function parseHistory(json) {
  const items = new Map();
  if (!json || typeof json !== 'object') return items;
  const list = json.items ? Object.values(json.items) : json.itemID !== undefined ? [json] : [];
  for (const item of list) {
    if (item && item.itemID !== undefined) items.set(Number(item.itemID), Array.isArray(item.recentHistory) ? item.recentHistory : []);
  }
  return items;
}

// One answer from /api/v2/{scope}/{ids}: Map itemId -> listings. Several ids answer { items: { id: {...} } };
// one id answers the item itself.
function parseItems(json) {
  const items = new Map();
  if (!json || typeof json !== 'object') return items;
  const list = json.items ? Object.values(json.items) : json.itemID !== undefined ? [json] : [];
  for (const item of list) {
    if (item && item.itemID !== undefined) items.set(Number(item.itemID), Array.isArray(item.listings) ? item.listings : []);
  }
  return items;
}

// The player's own retainers, to leave their listings out: a Set of "name|world" (lowercase) from
// [{ name, world }]. Retainer names are only unique on one world, so another player's retainer of the same
// name on another world still counts.
const retainerKey = (name, world) => `${String(name).toLowerCase()}|${String(world || '').toLowerCase()}`;
function ownRetainerKeys(retainers) {
  return new Set((retainers || []).filter((r) => r && r.name).map((r) => retainerKey(r.name, r.world)));
}

// The cheapest listing: { price, world } or null. `hq`: true or false for that quality only, undefined for
// either. `exclude`: the player's own retainers (ownRetainerKeys). `world`: the world of listings that do not
// name one (Universalis leaves it out when asked for one world).
function cheapestListing(listings, { hq, exclude, world } = {}) {
  let best = null;
  for (const l of listings || []) {
    const price = Number(l.pricePerUnit);
    if (!(price > 0)) continue;
    if (hq !== undefined && !!l.hq !== !!hq) continue;
    if (exclude && l.retainerName && exclude.has(retainerKey(l.retainerName, l.worldName || world))) continue;
    if (!best || price < best.price) best = { price, world: l.worldName || null };
  }
  return best;
}

// Listings someone else is selling, cheapest first: [{ price, quantity, world }], by the same rules as
// cheapestListing (either quality). For working out what buying several costs (the Shopping List's totals).
function sellingListings(listings, { exclude, world } = {}) {
  return (listings || [])
    .filter((l) => Number(l.pricePerUnit) > 0)
    .filter((l) => !(exclude && l.retainerName && exclude.has(retainerKey(l.retainerName, l.worldName || world))))
    .map((l) => ({ price: Number(l.pricePerUnit), quantity: Math.max(1, Number(l.quantity) || 1), world: l.worldName || world || null }))
    .sort((a, b) => a.price - b.price);
}

const middle = (values) => {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

// The market price of an item, the same on every page (Planner, Income, Gil & Market):
//   1. the cheapest listing someone else sells (not the player's own retainers; `hq` true or false for that
//      quality only);
//   2. skipping lone low listings: with three or more listings, any under half the middle price of the five
//      cheapest is left out, and the cheapest of the rest is used;
//   3. checked against recent sales: if that is still under half the middle price of the last week's sales (three
//      or more of them), and fewer than three listings back it up (at most twice its price), the sales' middle price
//      is used instead; when three or more listings agree, the market has moved and they're kept. No listings at
//      all: the sales' middle price.
// { price, world, adjusted, skipped: [{ price, world }], salesMiddle, sales, note } or null when there is neither.
// `note` says, in plain words, what was changed and why (for a hover).
function marketPrice(listings, history, { hq, exclude, world, now = Date.now() } = {}) {
  const selling = (listings || [])
    .filter((l) => Number(l.pricePerUnit) > 0)
    .filter((l) => hq === undefined || !!l.hq === !!hq)
    .filter((l) => !(exclude && l.retainerName && exclude.has(retainerKey(l.retainerName, l.worldName || world))))
    .map((l) => ({ price: Number(l.pricePerUnit), world: l.worldName || null }))
    .sort((a, b) => a.price - b.price);
  const sales = (history || [])
    .filter((h) => Number(h.pricePerUnit) > 0 && (!h.timestamp || Number(h.timestamp) * 1000 >= now - WEEK_MS))
    .filter((h) => hq === undefined || !!h.hq === !!hq)
    .map((h) => Number(h.pricePerUnit));
  const salesMiddle = sales.length >= 3 ? middle(sales) : null;
  const gil = (n) => Math.round(n).toLocaleString('en-US');
  if (!selling.length) {
    if (salesMiddle === null) return null;
    return { price: salesMiddle, world: null, adjusted: true, skipped: [], salesMiddle, sales: sales.length,
      note: `No listings: using the middle price of the last week's ${sales.length} sales (${gil(salesMiddle)} gil).` };
  }
  let skipped = [];
  let pick = selling[0];
  if (selling.length >= 3) {
    const typical = middle(selling.slice(0, 5).map((l) => l.price));
    const at = selling.findIndex((l) => l.price >= typical * OUTLIER_SHARE);
    if (at > 0) { skipped = selling.slice(0, at); pick = selling[at]; }
  }
  const notes = [];
  if (skipped.length) {
    notes.push(`Ignored ${skipped.length} listing${skipped.length === 1 ? '' : 's'} at ${skipped.map((l) => `${gil(l.price)} gil`).join(', ')} `
      + `(well below the others, around ${gil(middle(selling.slice(0, 5).map((l) => l.price)))}).`);
  }
  let price = pick.price;
  let usedWorld = pick.world;
  // Listings at the price picked or close to it (at most twice it): three or more agreeing are a real market drop.
  const agreeing = selling.filter((l) => l.price >= price && l.price <= price / OUTLIER_SHARE).length;
  if (salesMiddle !== null && price < salesMiddle * OUTLIER_SHARE && agreeing < AGREEING_LISTINGS) {
    notes.push(`The cheapest listing (${gil(price)} gil) is well below the last week's ${sales.length} sales, around ${gil(salesMiddle)}.`);
    price = salesMiddle;
    usedWorld = null;
  }
  const adjusted = notes.length > 0;
  return { price, world: usedWorld, adjusted, skipped, salesMiddle, sales: sales.length,
    note: adjusted ? `${notes.join(' ')} Using ${gil(price)} gil.` : null };
}

// marketPrice for compareListings' `cheapest` (its options carry the sales as `history`).
const rivalPrice = (listings, options = {}) => marketPrice(listings, options.history, options);

function createUniversalis({ fetchImpl = (...a) => fetch(...a), baseUrl = process.env.FLEET_UNIVERSALIS_URL || DEFAULT_URL, now = () => Date.now(), timeoutMs = TIMEOUT_MS } = {}) {
  const cache = new Map(); // `${scope}|${id}` -> { at, listings, history }
  let places = null;

  // `missingOk`: a 404 answers null. Universalis answers 404 when no item asked for is on the market board
  // (one untradeable item, such as salvage, asked for on its own).
  // A request that gets no answer in timeoutMs is given up, so a page doesn't wait on it for minutes.
  async function getJson(path, { missingOk = false } = {}) {
    const signal = AbortSignal.timeout(timeoutMs);
    const unreachable = (err) => new Error(`Universalis could not be reached (${signal.aborted ? `no answer in ${Math.round(timeoutMs / 1000)} seconds` : err.message}).`);
    let res;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal });
    } catch (err) {
      throw unreachable(err);
    }
    if (res.status === 404 && missingOk) return null;
    if (res.status === 429) throw new Error('Universalis is busy (too many requests). Try again in a minute.');
    if (!res.ok) throw new Error(`Universalis answered ${res.status}.`);
    try {
      return await res.json();
    } catch (err) {
      if (signal.aborted) throw unreachable(err);
      throw err;
    }
  }

  // World name -> { dc, region, regionLabel }: Universalis's list of data centers, or the built-in one.
  // The built-in list is used for an answer while Universalis's can't be read, but not kept: it's asked again after a
  // while (a network blip at the start shouldn't leave newer data centers out until the app restarts).
  let placesAskAgainAt = 0;
  async function placesOf() {
    if (places) return places;
    if (Date.now() < placesAskAgainAt) return worldPlaces(KNOWN_DATA_CENTERS);
    try {
      const [dcs, worlds] = await Promise.all([getJson('/api/v2/data-centers'), getJson('/api/v2/worlds')]);
      const names = new Map(worlds.map((w) => [Number(w.id), w.name]));
      const list = dcs.map((dc) => ({ name: dc.name, region: dc.region, worlds: (dc.worlds || []).map((id) => names.get(Number(id))).filter(Boolean) }));
      if (list.some((dc) => dc.worlds.length)) places = worldPlaces(list);
    } catch { /* the built-in list below */ }
    if (places) return places;
    placesAskAgainAt = Date.now() + 30 * 60 * 1000;
    return worldPlaces(KNOWN_DATA_CENTERS);
  }

  // Requests to Universalis at once (it allows several): the rest wait their turn.
  let running = 0;
  const waiting = [];
  async function limited(task) {
    if (running >= PARALLEL) await new Promise((resolve) => waiting.push(resolve));
    running++;
    try { return await task(); } finally {
      running--;
      const next = waiting.shift();
      if (next) next();
    }
  }

  // Map itemId -> listings for one world, data center or region, from the cache or Universalis, a few batches at
  // a time. When Universalis does not answer (busy, unreachable, a server error), items already asked for before
  // keep their last listings and `stale` (an object) gets the time they are from and why; an item never asked for
  // before makes it fail.
  // historyOut (a Map, optional) gets each item's recent sales.
  async function listingsFor(scope, ids, stale, historyOut = new Map()) {
    const out = new Map();
    const missing = [];
    for (const id of ids) {
      const hit = cache.get(`${scope}|${id}`);
      if (hit && now() - hit.at < KEEP_MS) { out.set(id, hit.listings); historyOut.set(id, hit.history || []); }
      else missing.push(id);
    }
    const batches = [];
    for (let i = 0; i < missing.length; i += BATCH) batches.push(missing.slice(i, i + BATCH));
    await Promise.all(batches.map(async (batch) => {
      let items;
      let sold;
      try {
        const json = await limited(() => getJson(`/api/v2/${encodeURIComponent(scope)}/${batch.join(',')}?listings=${LISTINGS}&entries=${SALES}&entriesWithin=${SALES_WITHIN_S}`, { missingOk: true }));
        items = parseItems(json);
        sold = parseHistory(json);
      } catch (err) {
        const old = batch.map((id) => cache.get(`${scope}|${id}`));
        if (old.some((o) => !o)) throw err;
        batch.forEach((id, k) => { out.set(id, old[k].listings); historyOut.set(id, old[k].history || []); });
        stale.problem = err.message;
        stale.since = Math.min(stale.since || Infinity, ...old.map((o) => o.at));
        return;
      }
      for (const id of batch) {
        const listings = items.get(id) || [];
        const history = sold.get(id) || [];
        cache.set(`${scope}|${id}`, { at: now(), listings, history });
        out.set(id, listings);
        historyOut.set(id, history);
      }
    }));
    // In the order asked, whichever batch answered first.
    return new Map(ids.filter((id) => out.has(id)).map((id) => [id, out.get(id)]));
  }

  // For each world: its data center and region, and Map itemId -> { world, dc, region } listings. Each world, data
  // center and region is asked once (worlds on the same data center share its answer), a few requests at a time.
  async function marketFor(worlds, ids) {
    const where = await placesOf();
    const itemIds = [...new Set(ids.map(Number).filter((id) => id > 0))];
    const scopesOf = new Map();
    for (const world of new Set(worlds.filter(Boolean))) {
      const place = where.get(String(world).toLowerCase()) || null;
      scopesOf.set(world, { world, dc: place ? place.dc : null, region: place ? place.region : null });
    }
    const names = [...new Set([...scopesOf.values()].flatMap((scopes) => SCOPES.map((s) => scopes[s]).filter(Boolean)))];
    const answers = new Map(await Promise.all(names.map(async (name) => {
      const stale = {};
      const history = new Map();
      const listings = itemIds.length ? await listingsFor(name, itemIds, stale, history) : new Map();
      return [name, { listings, history, stale }];
    })));
    const result = new Map();
    for (const [world, scopes] of scopesOf) {
      const byScope = {};
      const historyByScope = {};
      const stale = {};
      for (const s of SCOPES) {
        const answer = scopes[s] ? answers.get(scopes[s]) : null;
        byScope[s] = answer ? answer.listings : new Map();
        historyByScope[s] = answer ? answer.history : new Map();
        if (answer && answer.stale.problem) {
          stale.problem = answer.stale.problem;
          stale.since = Math.min(stale.since || Infinity, answer.stale.since);
        }
      }
      result.set(world, {
        names: { world, dc: scopes.dc, region: scopes.region ? (REGION_LABELS[scopes.region] || scopes.region) : null },
        listings: byScope,
        history: historyByScope,
        stale: stale.problem ? { problem: stale.problem, since: stale.since } : null,
      });
    }
    return result;
  }

  // One world, data center or region (the Shopping List's and the Planner's "Prices from"): { listings: Map itemId ->
  // listings, history, stale: { problem, since } | null }.
  // With history: Map itemId -> the last week's sales (for marketPrice).
  async function listingsIn(scope, ids) {
    const stale = {};
    const history = new Map();
    const itemIds = [...new Set(ids.map(Number).filter((id) => id > 0))];
    const listings = scope && itemIds.length ? await listingsFor(scope, itemIds, stale, history) : new Map();
    return { listings, history, stale: stale.problem ? { problem: stale.problem, since: stale.since } : null };
  }

  return { marketFor, placesOf, listingsIn };
}

// Gil for each item at its market price in one scope (marketPrice), falling back to `vendor` (Map) for items
// neither listed nor sold (salvage, for one). `exclude`: the player's own retainers (ownRetainerKeys), whose
// listings are not the market. `hq`: prices for HQ items: the HQ market price, else that of either quality.
// `notes` (a Map, optional) gets itemId -> note for each price the outlier checks changed.
function scopePrices(market, scope, vendor, exclude, { hq = false, notes = null, now = Date.now() } = {}) {
  const prices = new Map(vendor);
  if (!market) return prices;
  for (const [id, listings] of market.listings[scope]) {
    const world = scope === 'world' && market.names ? market.names.world : undefined;
    const history = market.history && market.history[scope] ? market.history[scope].get(id) || [] : [];
    const best = (hq && marketPrice(listings, history, { exclude, world, hq: true, now })) || marketPrice(listings, history, { exclude, world, now });
    if (best) {
      prices.set(id, best.price);
      if (notes && best.adjusted) notes.set(id, best.note);
    }
  }
  return prices;
}

module.exports = { SETTING_KEY, SCOPES, REGION_LABELS, KNOWN_DATA_CENTERS, OUTLIER_SHARE, worldPlaces, parseItems, parseHistory, ownRetainerKeys, cheapestListing,
  sellingListings, marketPrice, rivalPrice, createUniversalis, scopePrices };
