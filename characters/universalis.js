// Live market prices from Universalis (universalis.app, the crowd-sourced market board site), when turned on
// in Settings → General → Live Market Prices (tier3_settings 'universalis_enabled'; off by default). For each
// item: the cheapest listing on a character's home world, on its data center and on its region (NA, EU, JP,
// OCE). Used for the market value of loot and venture rewards (Income, Summary) and to spot listings that
// someone else sells cheaper (Gil & Market). Only item numbers and world, data center and region names are
// sent. Answers are kept for 30 minutes. No Electron or pg here, so it can be tested on its own
// (tests/universalis.test.js); `fetchImpl` and the address can be swapped for tests.

const SETTING_KEY = 'universalis_enabled';
const DEFAULT_URL = 'https://universalis.app';
const USER_AGENT = 'XIVFleetCompanion';
const BATCH = 50; // item ids per request
const LISTINGS = 20; // listings per item, cheapest first
const KEEP_MS = 30 * 60 * 1000;
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

function createUniversalis({ fetchImpl = (...a) => fetch(...a), baseUrl = process.env.FLEET_UNIVERSALIS_URL || DEFAULT_URL, now = () => Date.now() } = {}) {
  const cache = new Map(); // `${scope}|${id}` -> { at, listings }
  let places = null;

  // `missingOk`: a 404 answers null. Universalis answers 404 when no item asked for is on the market board
  // (one untradeable item, such as salvage, asked for on its own).
  async function getJson(path, { missingOk = false } = {}) {
    let res;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
    } catch (err) {
      throw new Error(`Universalis could not be reached (${err.message}).`);
    }
    if (res.status === 404 && missingOk) return null;
    if (res.status === 429) throw new Error('Universalis is busy (too many requests). Try again in a minute.');
    if (!res.ok) throw new Error(`Universalis answered ${res.status}.`);
    return res.json();
  }

  // World name -> { dc, region, regionLabel }: Universalis's list of data centers, or the built-in one.
  async function placesOf() {
    if (places) return places;
    try {
      const [dcs, worlds] = await Promise.all([getJson('/api/v2/data-centers'), getJson('/api/v2/worlds')]);
      const names = new Map(worlds.map((w) => [Number(w.id), w.name]));
      const list = dcs.map((dc) => ({ name: dc.name, region: dc.region, worlds: (dc.worlds || []).map((id) => names.get(Number(id))).filter(Boolean) }));
      if (list.some((dc) => dc.worlds.length)) places = worldPlaces(list);
    } catch { /* the built-in list below */ }
    if (!places) places = worldPlaces(KNOWN_DATA_CENTERS);
    return places;
  }

  // Map itemId -> listings for one world, data center or region, from the cache or Universalis. When
  // Universalis does not answer (busy, unreachable, a server error), items already asked for before keep their
  // last listings and `stale` (an object) gets the time they are from and why; an item never asked for before
  // makes it fail.
  async function listingsFor(scope, ids, stale) {
    const out = new Map();
    const missing = [];
    for (const id of ids) {
      const hit = cache.get(`${scope}|${id}`);
      if (hit && now() - hit.at < KEEP_MS) out.set(id, hit.listings);
      else missing.push(id);
    }
    for (let i = 0; i < missing.length; i += BATCH) {
      const batch = missing.slice(i, i + BATCH);
      let items;
      try {
        items = parseItems(await getJson(`/api/v2/${encodeURIComponent(scope)}/${batch.join(',')}?listings=${LISTINGS}&entries=0`, { missingOk: true }));
      } catch (err) {
        const old = batch.map((id) => cache.get(`${scope}|${id}`));
        if (old.some((o) => !o)) throw err;
        batch.forEach((id, k) => out.set(id, old[k].listings));
        stale.problem = err.message;
        stale.since = Math.min(stale.since || Infinity, ...old.map((o) => o.at));
        continue;
      }
      for (const id of batch) {
        const listings = items.get(id) || [];
        cache.set(`${scope}|${id}`, { at: now(), listings });
        out.set(id, listings);
      }
    }
    return out;
  }

  // For each world: its data center and region, and Map itemId -> { world, dc, region } listings.
  async function marketFor(worlds, ids) {
    const where = await placesOf();
    const itemIds = [...new Set(ids.map(Number).filter((id) => id > 0))];
    const result = new Map();
    for (const world of new Set(worlds.filter(Boolean))) {
      const place = where.get(String(world).toLowerCase()) || null;
      const scopes = { world, dc: place ? place.dc : null, region: place ? place.region : null };
      const byScope = {};
      const stale = {};
      for (const s of SCOPES) byScope[s] = scopes[s] && itemIds.length ? await listingsFor(scopes[s], itemIds, stale) : new Map();
      result.set(world, {
        names: { world, dc: scopes.dc, region: scopes.region ? (REGION_LABELS[scopes.region] || scopes.region) : null },
        listings: byScope,
        stale: stale.problem ? { problem: stale.problem, since: stale.since } : null,
      });
    }
    return result;
  }

  // One world, data center or region (the Shopping List's "Prices from"): { listings: Map itemId -> listings,
  // stale: { problem, since } | null }.
  async function listingsIn(scope, ids) {
    const stale = {};
    const itemIds = [...new Set(ids.map(Number).filter((id) => id > 0))];
    const listings = scope && itemIds.length ? await listingsFor(scope, itemIds, stale) : new Map();
    return { listings, stale: stale.problem ? { problem: stale.problem, since: stale.since } : null };
  }

  return { marketFor, placesOf, listingsIn };
}

// Gil for each item at the cheapest listing in one scope, falling back to `vendor` (Map) for items not on the
// market board (salvage, for one). `exclude`: the player's own retainers (ownRetainerKeys), whose listings are
// not the market. `hq`: prices for HQ items: the cheapest HQ listing, else the cheapest of either quality.
function scopePrices(market, scope, vendor, exclude, { hq = false } = {}) {
  const prices = new Map(vendor);
  if (!market) return prices;
  for (const [id, listings] of market.listings[scope]) {
    const world = scope === 'world' && market.names ? market.names.world : undefined;
    const best = (hq && cheapestListing(listings, { exclude, world, hq: true })) || cheapestListing(listings, { exclude, world });
    if (best) prices.set(id, best.price);
  }
  return prices;
}

module.exports = { SETTING_KEY, SCOPES, REGION_LABELS, KNOWN_DATA_CENTERS, worldPlaces, parseItems, ownRetainerKeys, cheapestListing, sellingListings, createUniversalis, scopePrices };
