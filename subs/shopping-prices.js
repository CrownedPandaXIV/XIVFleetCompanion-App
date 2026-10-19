// Market board prices on the Shopping List (Live Market Prices on): for each sub part, the cheapest listing
// against what it costs to make, and the cheapest listing of each material, in the world, data center or
// region chosen. No Electron or pg here, so it can be tested on its own (tests/shopping-prices.test.js).

const { REGION_LABELS } = require('../characters/universalis');

// The choices for "Prices from": every world, data center and region Universalis knows (places: Map
// lowercase world -> { name, dc, region }, universalis.js), plus any world a character is on that it doesn't.
// Worlds are listed region by region (yours first) and data center by data center, each with its data center
// ("Maduin (Dynamis)"). worlds: [{ world, characters }] the characters' worlds, for the starting choice. Returns
// { choices: [{ value, label, kind, scope }], fallback } where `scope` is the name Universalis takes and
// `fallback` the data center with the most characters (else a character's world, else the first choice).
function priceChoices(worlds, places) {
  // Regions with the most of your characters first, then the rest alphabetically.
  const regionCount = new Map();
  for (const { world, characters } of worlds) {
    const place = world ? places.get(String(world).toLowerCase()) : null;
    if (place && place.region) regionCount.set(place.region, (regionCount.get(place.region) || 0) + (Number(characters) || 0));
  }
  const byRegion = (a, b) => (regionCount.get(b) || 0) - (regionCount.get(a) || 0) || String(a).localeCompare(String(b));
  const known = [...places.values()].filter((p) => p && p.name)
    .sort((a, b) => byRegion(a.region, b.region) || String(a.dc).localeCompare(String(b.dc)) || a.name.localeCompare(b.name));
  const worldChoices = known.map((p) => ({ value: `world:${p.name}`, label: p.dc ? `${p.name} (${p.dc})` : p.name, kind: 'world', scope: p.name }));
  const unknown = worlds.map((w) => w.world).filter((w) => w && !places.has(String(w).toLowerCase())).sort();
  for (const world of new Set(unknown)) worldChoices.push({ value: `world:${world}`, label: world, kind: 'world', scope: world });

  const dcs = [...new Set(known.map((p) => p.dc).filter(Boolean))];
  const regions = [...new Set(known.map((p) => p.region).filter(Boolean))];
  const dcChoices = dcs.map((dc) => ({ value: `dc:${dc}`, label: dc, kind: 'dc', scope: dc }));
  const regionChoices = regions.map((region) => ({ value: `region:${region}`, label: REGION_LABELS[region] || region, kind: 'region', scope: region }));
  const choices = [...worldChoices, ...dcChoices, ...regionChoices];

  const dcCount = new Map();
  for (const { world, characters } of worlds) {
    const place = world ? places.get(String(world).toLowerCase()) : null;
    if (place && place.dc) dcCount.set(place.dc, (dcCount.get(place.dc) || 0) + (Number(characters) || 0));
  }
  const busiest = [...dcCount].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const ownWorld = unknown[0] ? `world:${unknown[0]}` : null;
  return { choices, fallback: busiest ? `dc:${busiest[0]}` : (ownWorld || (choices[0] ? choices[0].value : null)) };
}

// Gil for one of each item, the cheapest way: a market board listing, a vendor, or making it from its recipe
// (each ingredient its own cheapest way, divided by how many one craft makes). market: Map itemId ->
// { price, world } | null; vendor: Map itemId -> gil; recipes: Map itemId -> { yield, ingredients }.
// Returns { cheapest(id) -> gil | null, makeCost(id) -> gil | null } (null: something in it has no price).
function costs({ market, vendor, recipes }) {
  const memo = new Map();
  const visiting = new Set();
  function makeCost(id) {
    const recipe = recipes.get(id);
    if (!recipe || !recipe.ingredients || !recipe.ingredients.length) return null;
    let total = 0;
    for (const ing of recipe.ingredients) {
      const each = cheapest(ing.itemId);
      if (each === null) return null;
      total += each * ing.amount;
    }
    return total / (recipe.yield || 1);
  }
  function cheapest(id) {
    if (memo.has(id)) return memo.get(id);
    if (visiting.has(id)) return null;
    visiting.add(id);
    const listed = market.get(id);
    const options = [listed ? listed.price : null, vendor.get(id) || null, makeCost(id)].filter((n) => n !== null && n > 0);
    visiting.delete(id);
    const best = options.length ? Math.min(...options) : null;
    memo.set(id, best);
    return best;
  }
  return { cheapest, makeCost };
}

// What buying `wanted` costs, going up the listings cheapest first (listings: [{ price, quantity }], cheapest
// first): { gil, got } where `got` is how many the listings cover (less than wanted when not enough are listed).
function buyingCost(listings, wanted) {
  let gil = 0;
  let got = 0;
  for (const l of listings || []) {
    if (got >= wanted) break;
    const take = Math.min(l.quantity, wanted - got);
    gil += take * l.price;
    got += take;
  }
  return { gil, got };
}

// Adds the prices to a shopping list (as get-shopping-list sends it): each part gets `market` ({ price,
// world, listings } or null), `makeCost`, `cheaper` ('buy', 'make' or null) and `buying` (what buying the ones
// not made yet costs, from buyingCost, with `wanted`); each material `market` and `buying` for what is short.
// Totals: those parts, and every material short, bought on the market board going up the listings, with how
// many of each have no listing and how many have too few listed (those count only what is listed).
function priceList(list, { market, vendor, recipes }) {
  const { makeCost } = costs({ market, vendor, recipes });
  const round = (n) => (n === null ? null : Math.round(n));
  const parts = list.parts.map((p) => {
    const listed = market.get(p.itemId) || null;
    const make = round(makeCost(p.itemId));
    const cheaper = listed && make !== null ? (listed.price < make ? 'buy' : 'make') : null;
    const wanted = Math.max(0, p.crafts - (p.made || 0));
    const buying = listed && wanted > 0 ? { ...buyingCost(listed.listings, wanted), wanted } : null;
    return { ...p, market: listed, makeCost: make, cheaper, buying };
  });
  const withMarket = (rows) => rows.map((r) => {
    const listed = market.get(r.itemId) || null;
    const wanted = r.short || 0;
    return { ...r, market: listed, buying: listed && wanted > 0 ? { ...buyingCost(listed.listings, wanted), wanted } : null };
  });
  const craft = withMarket(list.craft);
  const gather = withMarket(list.gather);
  const crystals = withMarket(list.crystals);

  const partsLeft = parts.filter((p) => p.crafts - (p.made || 0) > 0);
  const materialsShort = [...gather, ...crystals].filter((r) => r.short > 0);
  const total = (rows) => rows.reduce((sum, r) => sum + (r.buying ? r.buying.gil : 0), 0);
  const tooFew = (rows) => rows.filter((r) => r.buying && r.buying.got < r.buying.wanted).length;
  return {
    ...list,
    parts,
    craft,
    gather,
    crystals,
    marketTotals: {
      parts: total(partsLeft),
      partsUnlisted: partsLeft.filter((p) => !p.market).length,
      partsTooFew: tooFew(partsLeft),
      materials: total(materialsShort),
      materialsUnlisted: materialsShort.filter((r) => !r.market).length,
      materialsTooFew: tooFew(materialsShort),
    },
  };
}

module.exports = { priceChoices, costs, buyingCost, priceList };
