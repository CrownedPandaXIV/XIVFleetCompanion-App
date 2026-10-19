// The crafting shopping list on the Parts tab: the sub parts that need crafting, everything to craft on
// the way, and the raw materials and crystals to gather or buy, less what is held across every
// character's bags, saddlebags and crystals, their retainers, and the Free Company chests. The working
// out is in shopping-list.js. From the game tables loaded in Settings → Data:
//   - sub parts are built at the FC workshop in phases: CompanyCraftSequence (the part) -> its
//     CompanyCraftPart(s) -> their CompanyCraftProcess(es) (the phases), each asking for items
//     (CompanyCraftSupplyItem) in sets: SetQuantity per set x SetsRequired,
//   - everything else is made from a normal recipe (Recipe),
//   - with "buy from vendors" on, anything a gil shop sells (GilShopItem) is bought at its vendor price
//     (Item.PriceMid) instead of being crafted or gathered.
const { ipcMain } = require('electron');
const { reconcileProgress, setProgress, parseProgress } = require('../subs/shopping-progress');
const { withClient, snapshotFragments } = require('../db');
const { normalizeKey } = require('../db/game-data');
const { buildShoppingList } = require('../subs/shopping-list');
const { computePartsNeeded, partItemId } = require('./parts');

// Recipe.CraftType: which crafter makes it.
const CRAFTERS = ['Carpenter', 'Blacksmith', 'Armorer', 'Goldsmith', 'Leatherworker', 'Weaver', 'Alchemist', 'Culinarian'];

// Where held items count: bags, crystals and saddlebags; retainer bags and crystals; FC chests and
// crystals. Not equipped gear, the armoury, mail, items on the market board or housing.
const CHARACTER_CONTAINERS = { 0: 'Bags', 1: 'Bags', 2: 'Bags', 3: 'Bags', 2001: 'Crystals', 4000: 'Saddlebag', 4001: 'Saddlebag', 4100: 'Saddlebag', 4101: 'Saddlebag' };
const RETAINER_CONTAINERS = [10000, 10001, 10002, 10003, 10004, 10005, 10006, 12001];
const FC_CONTAINERS = [20000, 20001, 20002, 20003, 20004, 20005, 20006, 20007, 20008, 20009, 20010, 22001];

// The recipe table's columns, found by their normalised names (the game data update names them from
// the game's own headers, which can change between patches): item_result, amount_result, craft_type,
// ingredient_0..7 and amount_ingredient_0..7.
async function recipeColumns(client) {
  const { rows } = await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ffxiv_recipe'`);
  const byKey = new Map(rows.map((r) => [normalizeKey(r.column_name), r.column_name]));
  const columns = { result: byKey.get('itemresult'), yield: byKey.get('amountresult'), craftType: byKey.get('crafttype'), ingredients: [] };
  for (let i = 0; i < 10; i++) {
    const item = byKey.get(`ingredient${i}`) || byKey.get(`itemingredient${i}`);
    const amount = byKey.get(`amountingredient${i}`);
    if (item && amount) columns.ingredients.push({ item, amount });
  }
  return columns.result && columns.ingredients.length ? columns : null;
}

// A game table's columns, by normalised name (the game data update names them from the game's own
// headers, so the spelling depends on how the table was first loaded). Empty when the table is missing.
async function columnsByKey(client, table) {
  const { rows } = await client.query(
    'SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2', ['public', table]);
  return new Map(rows.map((r) => [normalizeKey(r.column_name), r.column_name]));
}

// Numbered columns ("supplyitem0", "supplyitem1", ...) in order.
function numbered(byKey, prefix) {
  const out = [];
  for (let i = 0; byKey.has(`${prefix}${i}`); i++) out.push(byKey.get(`${prefix}${i}`));
  return out;
}

const quote = (name) => `"${name.replace(/"/g, '""')}"`;
const toInt = (value) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : 0;
};

// Map itemId -> { yield: 1, job: 'FC workshop', ingredients } for the sub parts, from the FC workshop
// tables; null when they are not loaded yet.
async function loadWorkshopRecipes(client, partIds) {
  const seq = await columnsByKey(client, 'ffxiv_companycraftsequence');
  const part = await columnsByKey(client, 'ffxiv_companycraftpart');
  const proc = await columnsByKey(client, 'ffxiv_companycraftprocess');
  const supply = await columnsByKey(client, 'ffxiv_companycraftsupplyitem');
  const seqParts = numbered(seq, 'companycraftpart');
  const partProcs = numbered(part, 'companycraftprocess');
  const items = numbered(proc, 'supplyitem');
  const perSet = numbered(proc, 'setquantity');
  const sets = numbered(proc, 'setsrequired');
  if (!seq.has('resultitem') || !seqParts.length || !partProcs.length || !items.length || items.length !== perSet.length
      || items.length !== sets.length || !supply.has('item')) return null;

  const sequences = await client.query(
    `SELECT ${quote(seq.get('resultitem'))} AS result, ${seqParts.map((c, i) => `${quote(c)} AS p${i}`).join(', ')}
     FROM ffxiv_companycraftsequence WHERE ${quote(seq.get('resultitem'))} = ANY($1::text[])`, [partIds.map(String)]);
  if (!sequences.rows.length) return null;
  const partRows = await client.query(
    `SELECT id, ${partProcs.map((c, i) => `${quote(c)} AS q${i}`).join(', ')} FROM ffxiv_companycraftpart`);
  const procRows = await client.query(
    `SELECT id, ${items.map((c, i) => `${quote(c)} AS s${i}, ${quote(perSet[i])} AS n${i}, ${quote(sets[i])} AS r${i}`).join(', ')}
     FROM ffxiv_companycraftprocess`);
  const supplyRows = await client.query(`SELECT id, ${quote(supply.get('item'))} AS item FROM ffxiv_companycraftsupplyitem`);
  const procsOfPart = new Map(partRows.rows.map((r) => [toInt(r.id), partProcs.map((_, i) => toInt(r[`q${i}`])).filter((id) => id > 0)]));
  const procById = new Map(procRows.rows.map((r) => [toInt(r.id), r]));
  const itemOfSupply = new Map(supplyRows.rows.map((r) => [toInt(r.id), toInt(r.item)]));

  const recipes = new Map();
  for (const row of sequences.rows) {
    const itemId = toInt(row.result);
    if (recipes.has(itemId)) continue;
    const amounts = new Map();
    for (const partId of seqParts.map((_, i) => toInt(row[`p${i}`])).filter((id) => id > 0)) {
      for (const procId of procsOfPart.get(partId) || []) {
        const p = procById.get(procId);
        if (!p) continue;
        items.forEach((_, i) => {
          const ingredient = itemOfSupply.get(toInt(p[`s${i}`]));
          const amount = toInt(p[`n${i}`]) * toInt(p[`r${i}`]);
          if (ingredient > 0 && amount > 0) amounts.set(ingredient, (amounts.get(ingredient) || 0) + amount);
        });
      }
    }
    if (amounts.size) {
      recipes.set(itemId, { yield: 1, job: 'FC workshop', ingredients: [...amounts].map(([id, amount]) => ({ itemId: id, amount })) });
    }
  }
  return recipes;
}

// Map itemId -> { yield, job, ingredients } for the given items and everything under them. An item with
// several recipes (more than one crafter can make it) uses the one with the lowest recipe id.
async function loadRecipes(client, columns, startIds) {
  const select = [
    'id', `${quote(columns.result)} AS result`,
    columns.yield ? `${quote(columns.yield)} AS yield` : '1 AS yield',
    columns.craftType ? `${quote(columns.craftType)} AS craft_type` : 'NULL AS craft_type',
    ...columns.ingredients.flatMap((c, i) => [`${quote(c.item)} AS i${i}`, `${quote(c.amount)} AS a${i}`]),
  ].join(', ');
  const recipes = new Map();
  const looked = new Set();
  let next = [...new Set(startIds)];
  while (next.length) {
    next.forEach((id) => looked.add(id));
    const { rows } = await client.query(
      `SELECT ${select} FROM ffxiv_recipe WHERE ${quote(columns.result)} = ANY($1::text[])`, [next.map(String)]);
    rows.sort((a, b) => toInt(a.id) - toInt(b.id));
    const found = [];
    for (const row of rows) {
      const itemId = toInt(row.result);
      if (recipes.has(itemId)) continue;
      const ingredients = columns.ingredients
        .map((c, i) => ({ itemId: toInt(row[`i${i}`]), amount: toInt(row[`a${i}`]) }))
        .filter((ing) => ing.itemId > 0 && ing.amount > 0);
      if (!ingredients.length) continue;
      recipes.set(itemId, { yield: Math.max(1, toInt(row.yield)), job: CRAFTERS[toInt(row.craft_type)] || null, ingredients });
      found.push(...ingredients.map((ing) => ing.itemId));
    }
    next = [...new Set(found)].filter((id) => !looked.has(id));
  }
  return recipes;
}

// Map itemId -> { total, places: [{ who, where, qty }] } for the given items.
async function loadHeld(client, itemIds) {
  const { latestCharacter } = await snapshotFragments(client);
  const held = new Map();
  const add = (itemId, who, where, qty) => {
    if (!(qty > 0)) return;
    if (!held.has(itemId)) held.set(itemId, { total: 0, places: [] });
    const entry = held.get(itemId);
    entry.total += qty;
    const place = entry.places.find((p) => p.who === who && p.where === where);
    if (place) place.qty += qty;
    else entry.places.push({ who, where, qty });
  };
  // HQ items may be stored as itemId + 1,000,000; they count the same.
  const baseId = 'CASE WHEN item_id >= 1000000 AND item_id < 2000000 THEN item_id - 1000000 ELSE item_id END';
  const ids = itemIds.map(Number);

  const own = await client.query(`
    SELECT inv.base_id, inv.owner_cid, inv.retainer_id, inv.sorted_container, inv.qty, c.name, c.world, rl.name AS retainer_name
    FROM (SELECT ${baseId} AS base_id, owner_cid, retainer_id, sorted_container, SUM(quantity)::int AS qty
          FROM companion_inventory_snapshot
          WHERE ${baseId} = ANY($1::int[]) AND (sorted_container = ANY($2::int[]) OR sorted_container = ANY($3::int[]))
          GROUP BY 1, 2, 3, 4) inv
    LEFT JOIN ${latestCharacter} c ON c.cid = inv.owner_cid
    LEFT JOIN companion_retainer_lookup rl ON rl.retainer_id = inv.retainer_id`,
  [ids, Object.keys(CHARACTER_CONTAINERS).map(Number), RETAINER_CONTAINERS]);
  for (const row of own.rows) {
    const who = row.name ? `${row.name}${row.world ? ` (${row.world})` : ''}` : `Character ${row.owner_cid}`;
    const isRetainer = String(row.retainer_id) !== String(row.owner_cid);
    if (isRetainer !== RETAINER_CONTAINERS.includes(row.sorted_container)) continue;
    const where = isRetainer ? `Retainer ${row.retainer_name || 'unknown'}` : CHARACTER_CONTAINERS[row.sorted_container];
    add(row.base_id, who, where, row.qty);
  }

  // A Free Company chest is one chest however many tracked members the FC has, so it is counted once.
  const fc = await client.query(`
    SELECT inv.base_id, inv.qty, inv.fc_id, h.fc_name
    FROM (SELECT ${baseId} AS base_id, fc_id, SUM(quantity)::int AS qty
          FROM companion_fc_inventory_snapshot
          WHERE ${baseId} = ANY($1::int[]) AND sorted_container = ANY($2::int[])
          GROUP BY 1, 2) inv
    LEFT JOIN (SELECT DISTINCT ON (fc_id) fc_id, fc_name FROM companion_character_housing
               WHERE fc_id IS NOT NULL ORDER BY fc_id, updated_at DESC) h ON h.fc_id = inv.fc_id`,
  [ids, FC_CONTAINERS]);
  for (const row of fc.rows) add(row.base_id, row.fc_name || `Free Company ${row.fc_id}`, 'FC chest', row.qty);

  for (const entry of held.values()) entry.places.sort((a, b) => b.qty - a.qty || a.who.localeCompare(b.who));
  return held;
}

// Map itemId -> vendor price in gil for the items a gil shop (GilShopItem) sells; null when that table
// is not loaded yet. The price is the item's own PriceMid, what an NPC vendor charges.
async function loadVendorPrices(client, itemIds) {
  const shop = await columnsByKey(client, 'ffxiv_gilshopitem');
  const item = await columnsByKey(client, 'ffxiv_item');
  if (!shop.has('item') || !item.has('pricemid')) return null;
  const { rows } = await client.query(
    `SELECT i.id, i.${quote(item.get('pricemid'))} AS price FROM ffxiv_item i
     WHERE i.id = ANY($1::text[]) AND EXISTS (SELECT 1 FROM ffxiv_gilshopitem g WHERE g.${quote(shop.get('item'))} = i.id)`,
    [itemIds.map(String)]);
  const prices = new Map();
  for (const row of rows) {
    const price = toInt(row.price);
    if (price > 0) prices.set(toInt(row.id), price);
  }
  return prices;
}

const PROGRESS_KEY = 'shopping_progress';

async function readProgress(client) {
  const { rows } = await client.query('SELECT setting_value FROM tier3_settings WHERE setting_key = $1', [PROGRESS_KEY]);
  return parseProgress(rows.length ? rows[0].setting_value : null);
}

async function writeProgress(client, progress) {
  await client.query(
    `INSERT INTO tier3_settings (setting_key, setting_value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now()`,
    [PROGRESS_KEY, JSON.stringify(progress)]);
}

// options: { buyFromVendors } - buy whatever a vendor sells instead of crafting or gathering it.
ipcMain.handle('get-shopping-list', async (event, options = {}) => {
  return withClient(async (client) => {
    // The sub parts the Parts tab says to craft (no spare, no old part to reuse).
    const parts = new Map();
    for (const need of await computePartsNeeded(client)) {
      if (need.spare_location) continue;
      const itemId = partItemId(need.needed_class, need.slot, need.needed_modified);
      if (itemId) parts.set(itemId, (parts.get(itemId) || 0) + 1);
    }
    if (!parts.size) {
      if (Object.keys(await readProgress(client)).length) await writeProgress(client, {});
      return { success: true, empty: true };
    }

    const columns = await recipeColumns(client);
    const workshop = await loadWorkshopRecipes(client, [...parts.keys()]);
    if (!columns || !workshop) {
      return {
        success: false,
        error: 'The game data for crafting is not loaded yet. In Settings → Data, check for game data updates and apply them (this adds the FC workshop tables), then try again.',
      };
    }
    const materials = new Set();
    for (const recipe of workshop.values()) recipe.ingredients.forEach((ing) => materials.add(ing.itemId));
    const recipes = new Map([...(await loadRecipes(client, columns, [...materials])), ...workshop]);
    const allIds = new Set(parts.keys());
    for (const recipe of recipes.values()) recipe.ingredients.forEach((ing) => allIds.add(ing.itemId));
    const heldDetail = await loadHeld(client, [...allIds]);
    const held = new Map([...heldDetail].map(([id, entry]) => [id, entry.total]));
    const vendorPrices = await loadVendorPrices(client, [...allIds]);
    const buyFromVendors = !!(options && options.buyFromVendors) && !!vendorPrices;
    const buy = new Set(buyFromVendors ? vendorPrices.keys() : []);
    const list = buildShoppingList({ parts, recipes, held, buy });

    const names = await client.query('SELECT id, name FROM ffxiv_item WHERE id = ANY($1::text[])', [[...allIds].map(String)]);
    const nameById = new Map(names.rows.map((r) => [toInt(r.id), r.name]));
    const describe = (entry) => ({
      ...entry,
      name: nameById.get(entry.itemId) || `Item ${entry.itemId}`,
      places: entry.have ? heldDetail.get(entry.itemId).places : [],
      vendorPrice: (vendorPrices && vendorPrices.get(entry.itemId)) || null,
    });
    const bought = list.buy.map((entry) => ({ ...describe(entry), cost: entry.short * vendorPrices.get(entry.itemId) }));

    // Ticks for parts already crafted (shopping-progress.js), with any the plugin now sees taken back off.
    const stored = await readProgress(client);
    const progress = reconcileProgress(stored, list.parts);
    if (JSON.stringify(progress) !== JSON.stringify(stored)) await writeProgress(client, progress);
    return {
      success: true,
      vendorsLoaded: !!vendorPrices,
      buyFromVendors,
      parts: list.parts.map((entry) => ({ ...describe(entry), made: progress[entry.itemId] ? progress[entry.itemId].made : 0 })),
      craft: list.craft.map(describe),
      gather: list.gather.map(describe),
      crystals: list.crystals.map(describe),
      buy: bought,
      buyCost: bought.reduce((sum, entry) => sum + entry.cost, 0),
    };
  }, (err) => {
    return { success: false, error: err.message };
  });
});

// { itemId, made, crafts }: how many of a part on the list have been crafted.
ipcMain.handle('save-shopping-progress', async (event, input = {}) => {
  const itemId = Number(input.itemId);
  const crafts = Number(input.crafts);
  const made = Number(input.made);
  if (!Number.isInteger(itemId) || itemId <= 0 || !Number.isInteger(crafts) || crafts < 0 || !Number.isFinite(made)) {
    return { success: false, error: 'Not a part on the list.' };
  }
  return withClient(async (client) => {
    await writeProgress(client, setProgress(await readProgress(client), itemId, made, crafts));
    return { success: true };
  }, (err) => ({ success: false, error: err.message }));
});

module.exports = { columnsByKey };
