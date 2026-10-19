// Market tab: gil held per account (characters and their retainers) and the retainers' market listings
// that have sat unsold a long time (plugin 0.10.0 records when it first saw each listing). No Electron
// or pg here, so it can be tested on its own (tests/market.test.js).

const DAY = 24 * 60 * 60 * 1000;
const DEFAULT_STALE_DAYS = 7;
const MAX_STALE_DAYS = 90;

// characters: [{ cid, account_label, gil }]; retainers: [{ owner_cid, gil }].
// Returns { accounts: [{ label, characters, retainers, characterGil, retainerGil, total }], fleet }.
function gilByAccount(characters, retainers) {
  const accountOf = new Map(characters.map((c) => [String(c.cid), c.account_label || 'Ungrouped']));
  const accounts = new Map();
  const get = (label) => {
    if (!accounts.has(label)) accounts.set(label, { label, characters: 0, retainers: 0, characterGil: 0, retainerGil: 0 });
    return accounts.get(label);
  };
  for (const c of characters) {
    const a = get(c.account_label || 'Ungrouped');
    a.characters += 1;
    a.characterGil += Number(c.gil) || 0;
  }
  for (const r of retainers) {
    const label = accountOf.get(String(r.owner_cid));
    if (!label) continue; // a retainer of a character no longer tracked
    const a = get(label);
    a.retainers += 1;
    a.retainerGil += Number(r.gil) || 0;
  }
  const list = [...accounts.values()].map((a) => ({ ...a, total: a.characterGil + a.retainerGil }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const sum = (field) => list.reduce((t, a) => t + a[field], 0);
  return {
    accounts: list,
    fleet: { characters: sum('characters'), retainers: sum('retainers'), characterGil: sum('characterGil'), retainerGil: sum('retainerGil'), total: sum('total') },
  };
}

// A listing with its age in days and total value.
function withAge(l, now = Date.now()) {
  return {
    ...l,
    ageDays: Math.max(0, (now - new Date(l.first_seen_at).getTime()) / DAY),
    value: (Number(l.unit_price) || 0) * (Number(l.quantity) || 0),
  };
}

// Listings ([{ first_seen_at, unit_price, quantity, ... }]) with their age in days and total value, the
// ones up for at least `minDays` first (oldest first), and totals for all listings.
function listingAges(listings, minDays, now = Date.now()) {
  const aged = listings.map((l) => withAge(l, now));
  const stale = aged.filter((l) => l.ageDays >= minDays).sort((a, b) => b.ageDays - a.ageDays);
  return {
    stale,
    totals: {
      listings: aged.length,
      value: aged.reduce((t, l) => t + l.value, 0),
      stale: stale.length,
      staleValue: stale.reduce((t, l) => t + l.value, 0),
    },
  };
}

// With live prices (universalis.js): for each listing, the cheapest someone else sells the same item and
// quality for on the listing's world, its data center and its region, and whether it is undercut (someone
// sells it cheaper on its own world, where it sells). listings: [{ item_id, hq, unit_price, world, ... }];
// market: Map world -> marketFor()'s answer; cheapest(listings, { hq, exclude, world }) from universalis.js;
// exclude: the player's own retainers (universalis.js ownRetainerKeys: their own listings are not competition).
function compareListings(listings, { market, cheapest, exclude }) {
  return listings.map((l) => {
    const m = market.get(l.world);
    const others = {};
    for (const scope of ['world', 'dc', 'region']) {
      const found = m ? cheapest(m.listings[scope].get(Number(l.item_id)) || [], { hq: !!l.hq, exclude, world: scope === 'world' ? l.world : undefined }) : null;
      others[scope] = found;
    }
    const price = Number(l.unit_price);
    return { ...l, others, undercut: !!(others.world && others.world.price < price), undercutBy: others.world ? price - others.world.price : null };
  });
}

module.exports = { DEFAULT_STALE_DAYS, MAX_STALE_DAYS, gilByAccount, listingAges, compareListings, withAge };
