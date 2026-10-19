// Loot per voyage (Income tab): what each voyage really brought back, from the loot SubmarineTracker
// records (copied by plugin 0.10.0 into companion_voyage_loot, one row per sector), and venture rewards
// from AutoRetainer's statistics (companion_venture_result). Items are valued at what a vendor pays
// (salvage at the Salvage tab's prices). No Electron or pg here, so it can be tested on its own
// (tests/loot.test.js).

const DAY = 24 * 60 * 60 * 1000;

// Sector rows -> voyages: [{ fcId, register, at (ms), subName, sectors: [sector ids in the order they
// were run], items: Map itemId -> count }], oldest first. The order is each row's leg (plugin 0.10.1 and
// database version 9); a voyage stored without it has its sectors by number.
function voyagesFrom(rows) {
  const voyages = new Map();
  for (const r of rows) {
    const at = new Date(r.returned_at).getTime();
    const key = `${r.fc_id}|${r.sub_register}|${at}`;
    if (!voyages.has(key)) {
      voyages.set(key, { fcId: String(r.fc_id), register: String(r.sub_register), at, subName: r.sub_name || null, sectors: [], legs: [], items: new Map() });
    }
    const v = voyages.get(key);
    if (r.sub_name) v.subName = r.sub_name;
    v.sectors.push(Number(r.sector));
    v.legs.push(r.leg == null ? null : Number(r.leg));
    for (const [item, count] of [[r.primary_item, r.primary_count], [r.additional_item, r.additional_count]]) {
      const id = Number(item);
      const n = Number(count) || 0;
      if (!id || !n) continue;
      v.items.set(id, (v.items.get(id) || 0) + n);
    }
  }
  for (const v of voyages.values()) {
    const ordered = v.legs.every((leg) => leg !== null);
    const order = v.sectors.map((sector, i) => ({ sector, by: ordered ? v.legs[i] : sector }));
    v.sectors = order.sort((a, b) => a.by - b.by).map((o) => o.sector);
    delete v.legs;
  }
  return [...voyages.values()].sort((a, b) => a.at - b.at);
}

// Gil for a bag of items (Map itemId -> count) at prices (Map itemId -> gil; missing: 0).
function itemsValue(items, prices) {
  let gil = 0;
  for (const [id, n] of items) gil += n * (Number(prices.get(id)) || 0);
  return gil;
}

// The route a voyage took, as the letters of its sectors in the order run ("J-O-V-X-Y"); a sector with no
// letter shows its number.
function routeText(sectors, letterFor) {
  return sectors.map((s) => letterFor.get(s) || String(s)).join('-');
}

// Per sub (FC and SubmarineTracker's sub id) over `windowDays`: voyages, gil per voyage, gil per day,
// the route taken most often, and the newest name. And per route: voyages and gil per voyage.
function lootSummary(voyages, { prices, letterFor = new Map(), windowDays }) {
  const subs = new Map();
  const routes = new Map();
  for (const v of voyages) {
    const gil = itemsValue(v.items, prices);
    const route = routeText(v.sectors, letterFor);
    const key = `${v.fcId}|${v.register}`;
    if (!subs.has(key)) subs.set(key, { fcId: v.fcId, register: v.register, subName: v.subName, voyages: 0, gil: 0, routes: new Map(), lastAt: 0 });
    const s = subs.get(key);
    s.voyages += 1;
    s.gil += gil;
    s.routes.set(route, (s.routes.get(route) || 0) + 1);
    if (v.at >= s.lastAt) { s.lastAt = v.at; if (v.subName) s.subName = v.subName; }
    if (!routes.has(route)) routes.set(route, { route, voyages: 0, gil: 0, subs: new Set() });
    const r = routes.get(route);
    r.voyages += 1;
    r.gil += gil;
    r.subs.add(key);
  }
  const subRows = [...subs.values()].map((s) => ({
    fcId: s.fcId,
    register: s.register,
    subName: s.subName,
    voyages: s.voyages,
    gil: s.gil,
    perVoyage: s.gil / s.voyages,
    perDay: s.gil / windowDays,
    route: [...s.routes.entries()].sort((a, b) => b[1] - a[1])[0][0],
    lastAt: s.lastAt,
  }));
  const routeRows = [...routes.values()]
    .map((r) => ({ route: r.route, voyages: r.voyages, subs: r.subs.size, gil: r.gil, perVoyage: r.gil / r.voyages }))
    .sort((a, b) => b.perVoyage - a.perVoyage);
  const totalGil = subRows.reduce((t, s) => t + s.gil, 0);
  return {
    subs: subRows,
    routes: routeRows,
    totals: { voyages: voyages.length, gil: totalGil, perDay: totalGil / windowDays },
  };
}

// Venture rewards per character over `windowDays`: [{ ownerCid, rewards, items (Map), gil, perDay,
// retainers }] from rows { owner_cid, item_id, hq, quantity, rewards, retainers }, the rewards already added up
// per character, item and quality by the database (or by ventureTotals).
function ventureSummary(rows, { prices, windowDays }) {
  const byOwner = new Map();
  for (const r of rows) {
    const key = String(r.owner_cid);
    if (!byOwner.has(key)) byOwner.set(key, { ownerCid: key, rewards: 0, items: new Map(), retainers: new Set() });
    const o = byOwner.get(key);
    o.rewards += Number(r.rewards);
    for (const name of r.retainers) o.retainers.add(name);
    const id = Number(r.item_id);
    o.items.set(id, (o.items.get(id) || 0) + (Number(r.quantity) || 0));
  }
  return [...byOwner.values()].map((o) => {
    const gil = itemsValue(o.items, prices);
    return { ownerCid: o.ownerCid, rewards: o.rewards, retainers: o.retainers.size, items: o.items, gil, perDay: gil / windowDays };
  });
}

// Single venture rewards ({ owner_cid, retainer_name, item_id, quantity, hq }) added up per character, item and
// quality, as the database does in ipc/details.js (VENTURE_TOTALS): { owner_cid, item_id, hq, quantity, rewards,
// retainers (names) }. For the tests.
function ventureTotals(rewards) {
  const groups = new Map();
  for (const r of rewards) {
    const key = `${r.owner_cid}|${r.item_id}|${!!r.hq}`;
    if (!groups.has(key)) groups.set(key, { owner_cid: String(r.owner_cid), item_id: r.item_id, hq: !!r.hq, quantity: 0, rewards: 0, retainers: new Set() });
    const g = groups.get(key);
    g.quantity += Number(r.quantity) || 0;
    g.rewards += 1;
    g.retainers.add(r.retainer_name);
  }
  return [...groups.values()].map((g) => ({ ...g, retainers: [...g.retainers] }));
}

// One character's venture rewards (ventureSummary's rows for it) at market prices: `prices` and `hqPrices`,
// Map itemId -> gil.
function ventureMarketGil(rows, prices, hqPrices) {
  return rows.reduce((t, r) => t + (Number(r.quantity) || 0) * ((r.hq ? hqPrices : prices).get(Number(r.item_id)) || 0), 0);
}

// Market value with live prices (universalis.js): each voyage's loot at the cheapest listing on its sub's world,
// data center and region (items not on the market board at the vendor price). `worldOf`: sub key
// (`${fcId}|${register}`) -> world; `market`: Map world -> marketFor()'s answer; `priceFor(world, scope)`: Map
// itemId -> gil. Returns per scope: subs (Map key -> { gil, perVoyage, perDay }), routes (Map route ->
// { gil, perVoyage }) and totals { gil, perDay }; voyages whose world has no prices are left out (`priced`).
function marketLoot(voyages, { worldOf, priceFor, letterFor = new Map(), windowDays, scopes = ['world', 'dc', 'region'] }) {
  const out = {};
  for (const scope of scopes) out[scope] = { subs: new Map(), routes: new Map(), totals: { gil: 0, perDay: 0, voyages: 0 } };
  for (const v of voyages) {
    const key = `${v.fcId}|${v.register}`;
    const world = worldOf.get(key);
    const route = routeText(v.sectors, letterFor);
    for (const scope of scopes) {
      const prices = world ? priceFor(world, scope) : null;
      if (!prices) continue;
      const gil = itemsValue(v.items, prices);
      const o = out[scope];
      const sub = o.subs.get(key) || { gil: 0, voyages: 0 };
      sub.gil += gil;
      sub.voyages += 1;
      o.subs.set(key, sub);
      const r = o.routes.get(route) || { gil: 0, voyages: 0 };
      r.gil += gil;
      r.voyages += 1;
      o.routes.set(route, r);
      o.totals.gil += gil;
      o.totals.voyages += 1;
    }
  }
  for (const scope of scopes) {
    const o = out[scope];
    for (const sub of o.subs.values()) { sub.perVoyage = sub.gil / sub.voyages; sub.perDay = sub.gil / windowDays; }
    for (const r of o.routes.values()) r.perVoyage = r.gil / r.voyages;
    o.totals.perDay = o.totals.gil / windowDays;
  }
  return out;
}

module.exports = { DAY, voyagesFrom, itemsValue, routeText, lootSummary, ventureSummary, ventureTotals, ventureMarketGil, marketLoot };
