// Salvage, inventories (character, Free Company, whole fleet) and the Free Company directory.
const { ipcMain } = require('electron');
const { withClient, snapshotFragments } = require('../db');
const fcChestShare = require('../characters/fc-chest');
const { loadFcDirectory } = require('../characters/fc-directory');
const { MONEY_CONTAINERS, groupByItem, likePattern } = require('../characters/item-locations');

// Salvage piece vendor prices (fixed, not market price) and category
// split - ported directly from the old n8n Parse Salvage node. Items
// 22500-22503 are Standard, 22504-22507 are Extravagant.
const SALVAGE_PRICES = {
  22500: 8000, 22501: 9000, 22502: 10000, 22503: 13000,
  22504: 27000, 22505: 28500, 22506: 30000, 22507: 34500,
};

// Salvage counts everywhere a character's items can sit - personal
// bags, retainers, saddlebags (all in companion_inventory_snapshot,
// no container-range filtering, unlike spare parts) plus their FC
// chest (companion_fc_inventory_snapshot, matched via fc_id). A chest
// shared by several tracked characters is counted once, on one member's
// row (the FC leader if tracked, else the first in roster order), so the
// fleet total does not count it per member.
ipcMain.handle('get-salvage', async () => {
  return withClient(async (client) => {
    const { latestCharacter } = await snapshotFragments(client);

    const charactersResult = await client.query(`
      SELECT c.cid, c.name, c.world, c.account_label, c.fc_id,
             so.sort_index, h.fc_master
      FROM ${latestCharacter} c
      LEFT JOIN character_sort_order so ON c.cid = so.cid
      LEFT JOIN companion_character_housing h ON h.cid = c.cid AND h.fc_id = c.fc_id
      ORDER BY c.cid
    `);

    const personalResult = await client.query(`
      SELECT owner_cid, item_id, quantity
      FROM companion_inventory_snapshot
      WHERE item_id = ANY($1::int[])
    `, [Object.keys(SALVAGE_PRICES).map(Number)]);

    const fcResult = await client.query(`
      SELECT fc_id, item_id, quantity
      FROM companion_fc_inventory_snapshot
      WHERE item_id = ANY($1::int[])
    `, [Object.keys(SALVAGE_PRICES).map(Number)]);

    const itemNamesResult = await client.query(
      `SELECT id, name FROM ffxiv_item WHERE id = ANY($1::text[])`,
      [Object.keys(SALVAGE_PRICES)]
    );
    const itemNameById = new Map(itemNamesResult.rows.map((r) => [Number(r.id), r.name]));

    const totalsByCid = new Map();
    function addQty(cid, itemId, qty) {
      if (qty <= 0) return;
      const key = String(cid);
      if (!totalsByCid.has(key)) {
        totalsByCid.set(key, { standard: 0, extravagant: 0, gil: 0, itemQty: new Map() });
      }
      const t = totalsByCid.get(key);
      const price = SALVAGE_PRICES[itemId] || 0;
      t.gil += qty * price;
      if (itemId <= 22503) t.standard += qty; else t.extravagant += qty;
      t.itemQty.set(itemId, (t.itemQty.get(itemId) || 0) + qty);
    }

    for (const row of personalResult.rows) {
      addQty(row.owner_cid, row.item_id, row.quantity);
    }

    const holderByFcId = fcChestShare.chestHolders(charactersResult.rows);
    for (const row of fcResult.rows) {
      const holder = holderByFcId.get(String(row.fc_id));
      if (holder) addQty(holder, row.item_id, row.quantity);
    }

    // Per-item breakdown, split by category, for the hover popup - only
    // items with real qty>0 included, sorted by item_id within each
    // category so the popup order is stable.
    function buildBreakdown(itemQtyMap, isStandard) {
      const items = [];
      for (const [itemId, qty] of itemQtyMap.entries()) {
        const matchesCategory = isStandard ? itemId <= 22503 : itemId > 22503;
        if (!matchesCategory || qty <= 0) continue;
        const price = SALVAGE_PRICES[itemId] || 0;
        items.push({
          item_id: itemId,
          name: itemNameById.get(itemId) || `Item ${itemId}`,
          qty,
          price,
          subtotal: qty * price
        });
      }
      return items.sort((a, b) => a.item_id - b.item_id);
    }

    const rows = charactersResult.rows
      .map((c) => {
        const t = totalsByCid.get(String(c.cid)) || { standard: 0, extravagant: 0, gil: 0, itemQty: new Map() };
        return {
          cid: c.cid,
          character_name: c.name,
          world: c.world,
          account_label: c.account_label,
          sort_index: c.sort_index,
          standard_total: t.standard,
          extravagant_total: t.extravagant,
          calculated_gil: t.gil,
          standard_breakdown: buildBreakdown(t.itemQty, true),
          extravagant_breakdown: buildBreakdown(t.itemQty, false)
        };
      })
      .filter((r) => r.standard_total > 0 || r.extravagant_total > 0);

    return { success: true, rows };
  }, (err) => {
    return { success: false, error: err.message };
  });
});

// Full personal + retainer inventory for one or more characters (no
// item filtering, unlike Salvage/Spare Parts - this is a general
// browser). Real item names via ffxiv_item, container labels via
// companion_inventory_type_lookup, retainer names via
// companion_retainer_lookup. owner_cid == retainer_id is the
// sentinel for "this is the character's own bag, not a retainer"
// (confirmed against real data earlier).
ipcMain.handle('get-character-inventory', async (event, cids) => {
  if (!Array.isArray(cids)) {
    return { success: false, error: 'Invalid request.' };
  }
  return withClient(async (client) => {
    const { latestCharacter } = await snapshotFragments(client);

    const result = await client.query(`
      SELECT inv.owner_cid, inv.retainer_id, inv.sorted_container, inv.item_id, inv.quantity,
             c.name AS owner_name, c.world AS owner_world,
             til.display_name AS container_name,
             rl.name AS retainer_name,
             it.name AS item_name
      FROM companion_inventory_snapshot inv
      LEFT JOIN ${latestCharacter} c ON c.cid = inv.owner_cid
      LEFT JOIN companion_inventory_type_lookup til ON til.sorted_container = inv.sorted_container
      LEFT JOIN companion_retainer_lookup rl ON rl.retainer_id = inv.retainer_id
      LEFT JOIN ffxiv_item it ON it.id::text = inv.item_id::text
      WHERE inv.owner_cid = ANY($1::numeric[])
        AND inv.quantity > 0
        AND inv.sorted_container != 2000
    `, [cids]);

    const rows = result.rows.map((row) => {
      const isRetainer = String(row.retainer_id) !== String(row.owner_cid);
      const location = isRetainer
        ? `Retainer: ${row.retainer_name || 'Unknown'}`
        : (row.container_name || `Container ${row.sorted_container}`);

      return {
        owner_cid: row.owner_cid,
        owner_name: row.owner_name,
        owner_world: row.owner_world,
        location,
        item_id: row.item_id,
        item_name: row.item_name || `Item ${row.item_id}`,
        quantity: row.quantity
      };
    });

    return { success: true, rows };
  }, (err) => {
    return { success: false, error: err.message };
  });
});

// Every distinct FC, with the character(s) who own/share it - shown as
// "FC Name (Character1, Character2 — World)" in the picker, since FC
// names are NOT unique (confirmed against real data: multiple distinct
// FCs can share the same display name). Works for both the common
// one-character-per-FC setup and genuine multi-character FCs.
ipcMain.handle('get-fc-list', async () => {
  return withClient(async (client) => {
    const { latestFcMember } = await snapshotFragments(client);

    const result = await client.query(`
      SELECT h.fc_id, h.fc_name,
             array_agg(DISTINCT c.name) AS member_names,
             (array_agg(DISTINCT c.world))[1] AS world,
             MIN(so.sort_index) AS sort_index
      FROM companion_character_housing h
      LEFT JOIN ${latestFcMember} c ON c.fc_id = h.fc_id
      LEFT JOIN character_sort_order so ON so.cid = c.cid
      WHERE h.fc_id IS NOT NULL
      GROUP BY h.fc_id, h.fc_name
      ORDER BY sort_index NULLS LAST, h.fc_name
    `);

    return { success: true, rows: result.rows };
  }, (err) => {
    return { success: false, error: err.message };
  });
});

// Standalone FC tab data - completely independent of get-fc-list above
// (which the Inventory tab's FC picker depends on and must stay untouched).
ipcMain.handle('get-fc-directory', async () => {
  return withClient(async (client) => {
    const { rows, warnDays } = await loadFcDirectory(client);
    return { success: true, rows, warnDays };
  }, (err) => {
    return { success: false, error: err.message };
  });
});

// FC houses nobody has entered for the warning setting's days or more (or with no date at all), most
// at risk first. The game demolishes a house after 45 days without a member entering.
ipcMain.handle('get-house-warnings', async () => {
  return withClient(async (client) => {
    const { rows, warnDays } = await loadFcDirectory(client);
    const atRisk = rows
      .filter((fc) => fc.has_house && fc.house_level !== 'ok')
      .sort((a, b) => (b.house_days ?? Infinity) - (a.house_days ?? Infinity));
    return { success: true, rows: atRisk, warnDays };
  }, (err) => {
    return { success: false, error: err.message };
  });
});

// One FC's full chest contents, real item names, grouped by tab via
// sorted_container (20000-20004 -> Tab 1-5).
ipcMain.handle('get-fc-inventory', async (event, fcIds) => {
  if (!Array.isArray(fcIds)) {
    return { success: false, error: 'Invalid request.' };
  }
  return withClient(async (client) => {

    const result = await client.query(`
      SELECT fc.fc_id, fc.sorted_container, fc.item_id, fc.quantity, it.name AS item_name,
             h.fc_name
      FROM companion_fc_inventory_snapshot fc
      LEFT JOIN ffxiv_item it ON it.id::text = fc.item_id::text
      LEFT JOIN LATERAL (
        SELECT fc_name FROM companion_character_housing ch
        WHERE ch.fc_id = fc.fc_id ORDER BY ch.updated_at DESC LIMIT 1
      ) h ON true
      WHERE fc.fc_id = ANY($1::numeric[]) AND fc.quantity > 0
        AND fc.sorted_container BETWEEN 20000 AND 20004
    `, [fcIds]);

    const rows = result.rows.map((row) => ({
      fc_id: row.fc_id,
      fc_name: row.fc_name || `FC ${row.fc_id}`,
      tab: `Tab ${row.sorted_container - 20000 + 1}`,
      item_id: row.item_id,
      item_name: row.item_name || `Item ${row.item_id}`,
      quantity: row.quantity
    }));

    return { success: true, rows };
  }, (err) => {
    return { success: false, error: err.message };
  });
});

// Fleet-wide aggregated totals per item - personal + retainer bags
// across every character, plus every FC's chest, combined. One row
// per item, real names via ffxiv_item.
ipcMain.handle('get-fleet-inventory-summary', async () => {
  return withClient(async (client) => {

    const personalResult = await client.query(`
      SELECT item_id, SUM(quantity) AS total_quantity
      FROM companion_inventory_snapshot
      WHERE quantity > 0 AND sorted_container != 2000
      GROUP BY item_id
    `);

    const fcResult = await client.query(`
      SELECT item_id, SUM(quantity) AS total_quantity
      FROM companion_fc_inventory_snapshot
      WHERE quantity > 0
      GROUP BY item_id
    `);

    const totalsByItemId = new Map();
    for (const row of [...personalResult.rows, ...fcResult.rows]) {
      const itemId = row.item_id;
      totalsByItemId.set(itemId, (totalsByItemId.get(itemId) || 0) + Number(row.total_quantity));
    }

    const itemIds = Array.from(totalsByItemId.keys());
    const nameResult = await client.query(
      `SELECT id, name FROM ffxiv_item WHERE id = ANY($1::text[])`,
      [itemIds.map(String)]
    );
    const nameById = new Map(nameResult.rows.map((r) => [Number(r.id), r.name]));

    const rows = itemIds
      .map((itemId) => ({
        item_id: itemId,
        item_name: nameById.get(itemId) || `Item ${itemId}`,
        total_quantity: totalsByItemId.get(itemId)
      }))
      .sort((a, b) => b.total_quantity - a.total_quantity);

    return { success: true, rows };
  }, (err) => {
    return { success: false, error: err.message };
  });
});

// "Where is it?" (Inventory tab): every held item whose name contains the search, with each place it
// sits - every character's bags, saddlebags, crystals, equipped gear, armoury and so on, their
// retainers (including what they have up for sale), and the Free Company chests. HQ copies (stored as
// itemId + 1,000,000) count with the normal ones. Places come in Roster order with each character's
// account, an FC chest with the member Salvage counts it on. At most FIND_LIMIT items are returned.
const FIND_LIMIT = 50;
ipcMain.handle('find-items', async (event, term) => {
  const text = String(term || '').trim();
  if (text.length < 2) return { success: true, items: [], more: false };
  return withClient(async (client) => {
    const { latestCharacter } = await snapshotFragments(client);
    const baseId = 'CASE WHEN item_id >= 1000000 AND item_id < 2000000 THEN item_id - 1000000 ELSE item_id END';

    // Which held items match: the items held first (a few thousand), then their names.
    const heldIds = await client.query(`
      SELECT DISTINCT ${baseId} AS id FROM companion_inventory_snapshot
      WHERE quantity > 0 AND NOT (sorted_container = ANY($1::int[]))
      UNION
      SELECT DISTINCT ${baseId} FROM companion_fc_inventory_snapshot
      WHERE quantity > 0 AND NOT (sorted_container = ANY($1::int[]))`, [MONEY_CONTAINERS]);
    const matched = await client.query(
      `SELECT id, name FROM ffxiv_item WHERE id = ANY($1::text[]) AND name ILIKE $2 ORDER BY name LIMIT $3`,
      [heldIds.rows.map((r) => String(r.id)), likePattern(text), FIND_LIMIT + 1]);
    const more = matched.rows.length > FIND_LIMIT;
    const nameById = new Map(matched.rows.slice(0, FIND_LIMIT).map((r) => [Number(r.id), r.name]));
    const ids = [...nameById.keys()];
    if (!ids.length) return { success: true, items: [], more: false };

    // Characters in Roster order and by account; each FC chest goes with the member Salvage counts it on.
    const characters = (await client.query(`
      SELECT c.cid, c.name, c.world, c.account_label, c.fc_id, so.sort_index, h.fc_master
      FROM ${latestCharacter} c
      LEFT JOIN character_sort_order so ON so.cid = c.cid
      LEFT JOIN companion_character_housing h ON h.cid = c.cid AND h.fc_id = c.fc_id`)).rows;
    const byCid = new Map(characters.map((c) => [String(c.cid), c]));
    const holderOfFc = fcChestShare.chestHolders(characters);
    const ownerFields = (character, fallback) => ({
      owner: character ? character.name : fallback,
      ownerKey: character ? String(character.cid) : null,
      sortIndex: character ? character.sort_index : null,
      account: character ? character.account_label : null,
    });

    const own = await client.query(`
      SELECT ${baseId} AS item_id, inv.owner_cid, inv.retainer_id, inv.sorted_container, inv.quantity,
             rl.name AS retainer_name, rl.hire_order_index, til.display_name AS container_name
      FROM companion_inventory_snapshot inv
      LEFT JOIN companion_retainer_lookup rl ON rl.retainer_id = inv.retainer_id
      LEFT JOIN companion_inventory_type_lookup til ON til.sorted_container = inv.sorted_container
      WHERE ${baseId} = ANY($1::int[]) AND inv.quantity > 0 AND NOT (inv.sorted_container = ANY($2::int[]))`,
    [ids, MONEY_CONTAINERS]);
    const fc = await client.query(`
      SELECT ${baseId} AS item_id, inv.fc_id, inv.sorted_container, inv.quantity, h.fc_name, til.display_name AS container_name
      FROM companion_fc_inventory_snapshot inv
      LEFT JOIN (SELECT DISTINCT ON (fc_id) fc_id, fc_name FROM companion_character_housing
                 WHERE fc_id IS NOT NULL ORDER BY fc_id, updated_at DESC) h ON h.fc_id = inv.fc_id
      LEFT JOIN companion_inventory_type_lookup til ON til.sorted_container = inv.sorted_container
      WHERE ${baseId} = ANY($1::int[]) AND inv.quantity > 0 AND NOT (inv.sorted_container = ANY($2::int[]))`,
    [ids, MONEY_CONTAINERS]);

    const stacks = [
      ...own.rows.map((r) => {
        const character = byCid.get(String(r.owner_cid));
        const who = character ? character.name : `Character ${r.owner_cid}`;
        return {
          itemId: Number(r.item_id),
          who,
          world: character ? character.world : null,
          ...ownerFields(character, who),
          ...(character ? {} : { ownerKey: String(r.owner_cid) }),
          kind: String(r.retainer_id) !== String(r.owner_cid) ? 'retainer' : 'character',
          container: r.sorted_container,
          containerName: r.container_name,
          retainerName: r.retainer_name,
          hireOrder: r.hire_order_index,
          qty: Number(r.quantity),
        };
      }),
      ...fc.rows.map((r) => {
        const who = r.fc_name || `Free Company ${r.fc_id}`;
        return {
          itemId: Number(r.item_id),
          who,
          ...ownerFields(byCid.get(holderOfFc.get(String(r.fc_id))), who),
          kind: 'fc',
          container: r.sorted_container,
          containerName: r.container_name,
          qty: Number(r.quantity),
        };
      }),
    ].map((s) => ({ ...s, name: nameById.get(s.itemId) }));
    return { success: true, items: groupByItem(stacks), more };
  }, (err) => {
    return { success: false, error: err.message };
  });
});

module.exports = { SALVAGE_PRICES };
