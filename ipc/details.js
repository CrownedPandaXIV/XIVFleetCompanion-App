// What plugin 0.10.0 adds with database version 8: the PCs tab (each PC's status and last "Check what I can
// see"), loot per voyage and venture income (Income tab) and gil and market listings (Market tab). Every
// handler answers { missing: true } until the database has version 8, so the app works as before.
const { ipcMain } = require('electron');
const { MIN_PLUGIN_VERSION } = require('../shared/plugin-version');
const { withClient, snapshotFragments } = require('../db');
const { readMoveNote } = require('../db/database-move');
const { WINDOW_CHOICES } = require('../subs/supply-runway');
const { DEFAULT_WINDOW_DAYS } = require('../subs/income');
const { voyagesFrom, lootSummary, ventureSummary, ventureMarketGil, marketLoot } = require('../subs/loot');
const { DEFAULT_STALE_DAYS, MAX_STALE_DAYS, gilByAccount, listingAges, compareListings, withAge } = require('../characters/market');
const { SALVAGE_PRICES } = require('./inventory');
const { loadSubmarines } = require('./subs');
const { columnsByKey } = require('./shopping');
const { liveUniversalis } = require('./universalis');
const { SCOPES, scopePrices, cheapestListing, ownRetainerKeys } = require('../characters/universalis');

// When some live prices are from an earlier check (Universalis did not answer this time): { problem, since }.
function staleOf(live) {
  const found = [...live.values()].map((w) => w.stale).filter(Boolean);
  return found.length ? { problem: found[0].problem, since: Math.min(...found.map((s) => s.since)) } : null;
}

const quoteIdent = (name) => `"${String(name).replace(/"/g, '""')}"`;

const DAY = 24 * 60 * 60 * 1000;
const STALE_KEY = 'market_stale_days';
const UNDEFINED_TABLE = '42P01';

// Runs `work`; { success: true, missing: true } when a database version 8 table is not there yet.
async function withDetails(work) {
  return withClient(async (client) => {
    try {
      return await work(client);
    } catch (err) {
      if (err.code === UNDEFINED_TABLE) return { success: true, missing: true };
      throw err;
    }
  }, (err) => ({ success: false, error: err.message }));
}

// What a vendor pays for each item (Map id -> gil): salvage at the Salvage tab's prices, everything
// else at the game data's PriceLow (after a Settings → Game Data update; 0 until then).
async function itemPrices(client, ids) {
  const prices = new Map();
  const column = (await columnsByKey(client, 'ffxiv_item')).get('pricelow');
  if (ids.length && column) {
    const { rows } = await client.query(
      `SELECT id, ${quoteIdent(column)} AS price FROM ffxiv_item WHERE id = ANY($1::text[])`, [ids.map(String)]);
    for (const r of rows) prices.set(Number(r.id), Number(r.price) || 0);
  }
  for (const [id, gil] of Object.entries(SALVAGE_PRICES)) prices.set(Number(id), gil);
  return prices;
}

function salvagePieces(voyages) {
  let n = 0;
  for (const v of voyages) for (const [id, count] of v.items) if (SALVAGE_PRICES[id] !== undefined) n += Number(count) || 0;
  return n;
}

// The 3 items worth most in a Map itemId -> count, at `prices` (the larger item id last when two are worth the same).
function topItems(items, prices) {
  return [...items.entries()].map(([id, n]) => ({ id, n, gil: n * (prices.get(id) || 0) }))
    .sort((a, b) => b.gil - a.gil || a.id - b.id).slice(0, 3);
}

async function itemNames(client, ids) {
  if (!ids.length) return new Map();
  const { rows } = await client.query('SELECT id, name FROM ffxiv_item WHERE id = ANY($1::text[])', [ids.map(String)]);
  return new Map(rows.map((r) => [Number(r.id), r.name]));
}

async function incomeWindowDays(client) {
  const { rows } = await client.query(`SELECT setting_value FROM fleet_economics_settings WHERE setting_key = 'income_window_days'`);
  const days = rows.length ? Number(rows[0].setting_value) : NaN;
  return WINDOW_CHOICES.includes(days) ? days : DEFAULT_WINDOW_DAYS;
}

// ---- PCs ----

ipcMain.handle('get-pcs', () => withDetails(async (client) => {
  const pcs = (await client.query(`
    SELECT pc_name, account_label, plugin_version, last_sync_at, autoretainer_ready, allagantools_ready,
           fctracker_found, submarinetracker_found, venture_stats_found, characters_synced, characters_left_out,
           problems, check_text, check_to_fix, check_at
    FROM companion_pc_status
    ORDER BY account_label, pc_name`)).rows;
  // Accounts whose characters sync but no PC has reported for (a plugin older than 0.10.0).
  const { latestCharacter } = await snapshotFragments(client);
  const accounts = (await client.query(`
    SELECT coalesce(account_label, '') AS account_label, count(*)::int AS characters, max(snapshot_at) AS last_synced_at
    FROM ${latestCharacter} c GROUP BY 1 ORDER BY 1`)).rows;
  const reported = new Set(pcs.map((p) => p.account_label));
  // Moved here from another PC (Settings → Database → Move the database to this PC): which PCs haven't synced since.
  const note = await readMoveNote(client);
  const moved = note && note.state === 'arrived' && note.moved_at ? {
    from: note.from_host,
    at: note.moved_at,
    waiting: pcs.filter((p) => !p.last_sync_at || new Date(p.last_sync_at) < new Date(note.moved_at)).map((p) => p.account_label ? `${p.pc_name} (${p.account_label})` : p.pc_name),
  } : null;
  return {
    success: true,
    pcs,
    minPluginVersion: MIN_PLUGIN_VERSION,
    unreported: accounts.filter((a) => !reported.has(a.account_label)),
    moved,
  };
}));

// A PC no longer used (or renamed): its row goes. If the plugin still runs there, it comes back at its next sync.
ipcMain.handle('remove-pc', (event, pcName, accountLabel) => withDetails(async (client) => {
  if (typeof pcName !== 'string' || !pcName) return { success: false, error: 'No PC given.' };
  const { rowCount } = await client.query('DELETE FROM companion_pc_status WHERE pc_name = $1 AND account_label = $2', [pcName, String(accountLabel || '')]);
  return { success: true, removed: rowCount };
}));

// ---- Loot per voyage and venture income (Income tab) ----

// Venture rewards since $1, added up by the database per character, item and quality (normal or HQ), so one row
// per item travels instead of every reward: the same totals (subs/loot.js ventureTotals does the same in
// JavaScript, for the tests).
const VENTURE_TOTALS = `
    SELECT owner_cid::text AS owner_cid, item_id, hq, sum(quantity) AS quantity,
           count(*)::int AS rewards, array_agg(DISTINCT retainer_name) AS retainers
    FROM companion_venture_result WHERE received_at > $1
    GROUP BY owner_cid, item_id, hq`;

// Each character's venture rewards since `since`, worked out by the database with vendor prices, so about one
// row per character travels instead of one per item: { ownerCid, rewards, retainers, gil, perDay, top (the 3
// items worth most: [{ id, n, gil }]) }. The prices are those itemPrices() gives: the item's price_low column
// (0 when missing or not a number) and SALVAGE_PRICES for salvage. The same as ventureSummary over every item
// (tests/db/verify-venture-totals.js). With live prices on, the items are needed one by one instead.
async function ventureValues(client, since, windowDays) {
  const column = (await columnsByKey(client, 'ffxiv_item')).get('pricelow');
  const price = column
    ? `(SELECT CASE WHEN p.${quoteIdent(column)} ~ '^\\s*-?[0-9]+(\\.[0-9]+)?\\s*$' THEN p.${quoteIdent(column)}::numeric ELSE 0 END
        FROM ffxiv_item p WHERE p.id = i.item_id::text LIMIT 1)`
    : '0';
  const salvage = Object.entries(SALVAGE_PRICES);
  const owners = (await client.query(`
    SELECT owner_cid::text AS owner_cid, count(*)::int AS rewards, count(DISTINCT retainer_name)::int AS retainers
    FROM companion_venture_result WHERE received_at > $1 GROUP BY owner_cid`, [since])).rows;
  const items = (await client.query(`
    SELECT owner_cid, item_id, n, gil, total FROM (
      SELECT owner_cid, item_id, n, gil, sum(gil) OVER (PARTITION BY owner_cid) AS total,
             row_number() OVER (PARTITION BY owner_cid ORDER BY gil DESC, item_id) AS place
      FROM (
        SELECT i.owner_cid::text AS owner_cid, i.item_id, i.n, i.n * coalesce(s.gil, ${price}, 0) AS gil
        FROM (SELECT owner_cid, item_id, sum(quantity) AS n FROM companion_venture_result
              WHERE received_at > $1 GROUP BY owner_cid, item_id) i
        LEFT JOIN unnest($2::int[], $3::numeric[]) AS s(id, gil) ON s.id = i.item_id
      ) valued
    ) ranked
    WHERE place <= 3`, [since, salvage.map(([id]) => Number(id)), salvage.map(([, gil]) => gil)])).rows;
  const byOwner = new Map(owners.map((o) => [o.owner_cid, { ownerCid: o.owner_cid, rewards: o.rewards, retainers: o.retainers, gil: 0, perDay: 0, top: [] }]));
  for (const r of items) {
    const o = byOwner.get(r.owner_cid);
    if (!o) continue;
    o.gil = Number(r.total);
    o.perDay = o.gil / windowDays;
    o.top.push({ id: Number(r.item_id), n: Number(r.n), gil: Number(r.gil) });
  }
  for (const o of byOwner.values()) o.top.sort((a, b) => b.gil - a.gil || a.id - b.id);
  return [...byOwner.values()];
}

// Loot per voyage and venture income over `windowDays` (the Income tab's choice by default), with market
// values when `universalis` (universalis.js) is given. Also used by the Discord summary (alerts/run.js).
async function loadLoot(client, { universalis = null, windowDays: days = null } = {}) {
  const windowDays = days || await incomeWindowDays(client);
  const since = new Date(Date.now() - windowDays * DAY);
  // leg: the order each voyage ran its sectors in (database version 9; read through to_jsonb so the query
  // works before it has been run).
  const lootRows = (await client.query(`
    SELECT l.fc_id::text AS fc_id, l.sub_register, l.returned_at, l.sector, l.sub_name, l.primary_item, l.primary_count,
           l.additional_item, l.additional_count, (to_jsonb(l)->>'leg')::int AS leg
    FROM companion_voyage_loot l WHERE l.returned_at > $1`, [since])).rows;
  // The rewards item by item only for live prices, which price each item on the market; otherwise the database
  // works out each character's totals (ventureValues).
  const ventureRows = universalis ? (await client.query(VENTURE_TOTALS, [since])).rows : [];

  const voyages = voyagesFrom(lootRows);
  const ids = new Set();
  for (const v of voyages) for (const id of v.items.keys()) ids.add(id);
  for (const r of ventureRows) ids.add(Number(r.item_id));
  const prices = await itemPrices(client, [...ids]);

  const letters = (await client.query('SELECT id, location FROM ffxiv_submarineexploration')).rows;
  const letterFor = new Map(letters.filter((r) => r.location).map((r) => [Number(r.id), r.location]));
  const loot = lootSummary(voyages, { prices, letterFor, windowDays });

  // Each sub's character (a tracked member of its FC with a sub of that name) and Fight Club's Current
  // Gil/Day for it, to compare.
  const { latestCharacter } = await snapshotFragments(client);
  const characters = (await client.query(`
    SELECT c.cid::text AS cid, c.name, c.world, c.account_label, c.fc_id::text AS fc_id, so.sort_index
    FROM ${latestCharacter} c LEFT JOIN character_sort_order so ON so.cid = c.cid`)).rows;
  const byCid = new Map(characters.map((c) => [c.cid, c]));
  const subs = await loadSubmarines(client);
  const subFor = new Map();
  for (const s of subs) {
    const c = byCid.get(String(s.cid));
    if (c && c.fc_id) subFor.set(`${c.fc_id}|${s.sub_name}`, { ...s, character: c });
  }
  const subRows = loot.subs.map((s) => {
    const match = subFor.get(`${s.fcId}|${s.subName}`);
    const c = match ? match.character : characters.find((x) => x.fc_id === s.fcId);
    return {
      ...s,
      character_name: c ? c.name : null,
      world: c ? c.world : null,
      account_label: c ? c.account_label : null,
      sort_index: c ? c.sort_index : null,
      expectedPerDay: match && typeof match.current_gil_day === 'number' ? match.current_gil_day : null,
    };
  });

  const ventureList = universalis
    ? ventureSummary(ventureRows, { prices, windowDays }).map((v) => ({ ...v, top: topItems(v.items, prices) }))
    : await ventureValues(client, since, windowDays);

  // Live prices (Settings → Live Market Prices): the same loot and rewards at the cheapest listing on each
  // character's world, data center and region; items not on the market board at what a vendor pays.
  let market = null;
  if (universalis) {
    try {
      const worldOf = new Map(subRows.filter((r) => r.world).map((r) => [`${r.fcId}|${r.register}`, r.world]));
      const ventureWorld = (v) => (byCid.get(v.ownerCid) || {}).world;
      const live = await universalis.marketFor([...worldOf.values(), ...ventureList.map(ventureWorld)], [...ids]);
      // The player's own retainers (name and world), whose listings are not the market.
      const own = ownRetainerKeys((await client.query(
        `SELECT r.name, c.world FROM companion_retainer_lookup r JOIN ${latestCharacter} c ON c.cid = r.owner_cid`)).rows);
      const priceMaps = new Map();
      // HQ venture rewards are priced at the cheapest HQ listing (else either quality).
      const priceFor = (world, scope, hq = false) => {
        if (!live.get(world)) return null;
        const key = `${world}|${scope}|${hq}`;
        if (!priceMaps.has(key)) priceMaps.set(key, scopePrices(live.get(world), scope, prices, own, { hq }));
        return priceMaps.get(key);
      };
      const lootMarket = marketLoot(voyages, { worldOf, priceFor, letterFor, windowDays });
      for (const r of subRows) {
        r.market = {};
        for (const scope of SCOPES) {
          const m = lootMarket[scope].subs.get(`${r.fcId}|${r.register}`);
          if (m) r.market[scope] = { perVoyage: m.perVoyage, perDay: m.perDay };
        }
      }
      for (const r of loot.routes) {
        r.market = {};
        for (const scope of SCOPES) {
          const m = lootMarket[scope].routes.get(r.route);
          if (m) r.market[scope] = { perVoyage: m.perVoyage };
        }
      }
      const ventureTotals = Object.fromEntries(SCOPES.map((scope) => [scope, { gil: 0, perDay: 0 }]));
      const rewardsOf = new Map();
      for (const r of ventureRows) {
        if (!rewardsOf.has(r.owner_cid)) rewardsOf.set(r.owner_cid, []);
        rewardsOf.get(r.owner_cid).push(r);
      }
      for (const v of ventureList) {
        v.market = {};
        for (const scope of SCOPES) {
          const p = priceFor(ventureWorld(v), scope);
          if (!p) continue;
          const pHq = priceFor(ventureWorld(v), scope, true);
          const gil = ventureMarketGil(rewardsOf.get(v.ownerCid) || [], p, pHq);
          v.market[scope] = { gil, perDay: gil / windowDays };
          ventureTotals[scope].gil += gil;
          ventureTotals[scope].perDay += gil / windowDays;
        }
      }
      market = {
        places: [...live.values()].map((w) => w.names),
        stale: staleOf(live),
        loot: Object.fromEntries(SCOPES.map((scope) => [scope, lootMarket[scope].totals])),
        ventures: ventureTotals,
      };
    } catch (err) {
      market = { error: err.message };
    }
  }

  const ventures = ventureList.map((v) => {
    const c = byCid.get(v.ownerCid);
    return { ...v, items: undefined, name: c ? c.name : v.ownerCid, world: c ? c.world : null, account_label: c ? c.account_label : null, sort_index: c ? c.sort_index : null };
  });
  const names = await itemNames(client, [...new Set(ventures.flatMap((v) => v.top.map((t) => t.id)))]);
  for (const v of ventures) for (const t of v.top) t.name = names.get(t.id) || `Item ${t.id}`;

  return {
    success: true,
    windowDays,
    subs: subRows,
    routes: loot.routes,
    // salvage: pieces of salvage brought back (the Discord summary says it).
    totals: { ...loot.totals, salvage: salvagePieces(voyages) },
    ventures,
    ventureTotals: {
      rewards: ventures.reduce((t, v) => t + v.rewards, 0),
      gil: ventures.reduce((t, v) => t + v.gil, 0),
      perDay: ventures.reduce((t, v) => t + v.perDay, 0),
    },
    market,
  };
}

ipcMain.handle('get-loot', () => withDetails(async (client) => loadLoot(client, { universalis: await liveUniversalis(client) })));

// ---- Gil and market listings (Market tab) ----

async function staleDays(client) {
  const { rows } = await client.query(`SELECT setting_value FROM fleet_economics_settings WHERE setting_key = $1`, [STALE_KEY]);
  const n = rows.length ? Number(rows[0].setting_value) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= MAX_STALE_DAYS ? n : DEFAULT_STALE_DAYS;
}

// Gil per account and the retainers' listings, compared with live prices when `universalis` (universalis.js)
// is given. Also used by the Discord undercut alert (alerts/run.js).
async function loadMarket(client, { universalis = null } = {}) {
  const { latestCharacter } = await snapshotFragments(client);
  const characters = (await client.query(`SELECT c.cid::text AS cid, c.name, c.world, c.account_label, c.gil FROM ${latestCharacter} c`)).rows;
  const retainers = (await client.query('SELECT retainer_id::text AS retainer_id, owner_cid::text AS owner_cid, name, gil FROM companion_retainer_lookup')).rows;
  const gil = gilByAccount(characters, retainers);
  const minDays = await staleDays(client);

  let listings = null;
  try {
    listings = (await client.query(`
      SELECT l.retainer_id::text AS retainer_id, l.owner_cid::text AS owner_cid, l.slot, l.item_id, l.quantity, l.hq, l.unit_price, l.first_seen_at,
             r.name AS retainer_name
      FROM companion_market_listing l LEFT JOIN companion_retainer_lookup r ON r.retainer_id = l.retainer_id`)).rows;
  } catch (err) {
    if (err.code !== UNDEFINED_TABLE) throw err;
  }
  let market = null;
  let live = null;
  if (listings) {
    const owners = new Map(characters.map((c) => [c.cid, c]));
    const itemIds = [...new Set(listings.map((l) => Number(l.item_id)))];
    const names = await itemNames(client, itemIds);
    const vendor = await itemPrices(client, itemIds);
    const described = listings.map((l) => {
      const o = owners.get(l.owner_cid);
      return {
        ...l,
        item_name: names.get(Number(l.item_id)) || `Item ${l.item_id}`,
        vendor_price: vendor.get(Number(l.item_id)) || 0,
        owner_name: o ? o.name : null,
        world: o ? o.world : null,
        account_label: o ? o.account_label : null,
      };
    });
    // Live prices (Settings → Live Market Prices): the cheapest someone else sells each item for on the
    // listing's world, data center and region, and which listings are undercut on their own world.
    let compared = null;
    if (universalis) {
      try {
        const prices = await universalis.marketFor(described.map((l) => l.world), described.map((l) => Number(l.item_id)));
        const worldOf = new Map(characters.map((c) => [c.cid, c.world]));
        const exclude = ownRetainerKeys(retainers.map((r) => ({ name: r.name, world: worldOf.get(r.owner_cid) })));
        compared = compareListings(described, { market: prices, cheapest: cheapestListing, exclude });
        live = {
          places: [...prices.values()].map((w) => w.names),
          stale: staleOf(prices),
          undercut: compared.filter((l) => l.undercut).sort((a, b) => b.undercutBy * b.quantity - a.undercutBy * a.quantity),
        };
      } catch (err) {
        live = { error: err.message };
      }
    }
    const ages = listingAges(compared || described, minDays);
    if (live && live.undercut) live.undercut = live.undercut.map((l) => withAge(l));
    market = { ...ages, live };
  }
  return { success: true, ...gil, minDays, maxStaleDays: MAX_STALE_DAYS, market };
}

ipcMain.handle('get-market', () => withClient(async (client) => loadMarket(client, { universalis: await liveUniversalis(client) }),
  (err) => ({ success: false, error: err.message })));

ipcMain.handle('save-market-settings', async (event, input = {}) => {
  const days = Number(input.minDays);
  if (!Number.isInteger(days) || days < 1 || days > MAX_STALE_DAYS) return { success: false, error: `Choose 1 to ${MAX_STALE_DAYS} days.` };
  return withClient(async (client) => {
    await client.query(
      `INSERT INTO fleet_economics_settings (setting_key, setting_value, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now()`, [STALE_KEY, days]);
    return { success: true };
  }, (err) => ({ success: false, error: err.message }));
});

module.exports = { loadLoot, loadMarket, VENTURE_TOTALS, ventureValues, topItems };
