// Parts: spare parts on hand, parts still needed for each sub's target build, and the build rules.
const { ipcMain } = require('electron');
const { withClient, snapshotFragments } = require('../db');
const fcChestShare = require('../characters/fc-chest');
const { partLetter, parseRankBuild } = require('../subs/submarine-builds');
const { matchNeeds } = require('../subs/parts-matching');

// Item ID -> {class, slot, modified} decoding for submarine spare parts.
// Real per-class item ID offset order, confirmed against the actual game
// data (xivapi/ffxiv-datamining Item.csv), NOT the app's display order:
// base+0=Bow, base+1=Bridge, base+2=Hull, base+3=Stern.
const SPARE_PART_ITEM_ID_SLOT_ORDER = ['Bow', 'Bridge', 'Hull', 'Stern'];

const SPARE_PART_CLASS_BASE_IDS = {
  Shark: 21792, Unkiu: 21796, Whale: 22526, Coelacanth: 23903, Syldra: 24344,
};
const SPARE_PART_MODIFIED_BASE_IDS = {
  Shark: 24348, Unkiu: 24352, Whale: 24356, Coelacanth: 24360, Syldra: 24364,
};
const sparePartLookup = new Map(); // itemId -> { class, slot, modified }
for (const [cls, base] of Object.entries(SPARE_PART_CLASS_BASE_IDS)) {
  SPARE_PART_ITEM_ID_SLOT_ORDER.forEach((slot, i) => sparePartLookup.set(base + i, { class: cls, slot, modified: false }));
}
for (const [cls, base] of Object.entries(SPARE_PART_MODIFIED_BASE_IDS)) {
  SPARE_PART_ITEM_ID_SLOT_ORDER.forEach((slot, i) => sparePartLookup.set(base + i, { class: cls, slot, modified: true }));
}

// Letter -> full class name, matching the class names used by the spare
// parts lookup (Shark/Unkiu/Whale/Coelacanth/Syldra) so a sub_build_rules
// or Target Route letter can be checked directly against the spare pool.
const SPARE_LETTER_TO_CLASS = { S: 'Shark', U: 'Unkiu', W: 'Whale', C: 'Coelacanth', Y: 'Syldra' };
const SLOT_KEYS = ['Hull', 'Stern', 'Bow', 'Bridge'];
const SLOT_COLUMN = { Hull: 'hull', Stern: 'stern', Bow: 'bow', Bridge: 'bridge' };

// sub_filter formats supported:
//   '' / 'All'        - applies to every sub slot
//   'SubNOnly'         - legacy single-slot format (still supported so
//                        existing rules keep working unmigrated)
//   'Sub1,Sub3'        - new multi-select format: comma-separated list
//                        of slot numbers this rule applies to
function ruleAppliesToSlot(subFilter, slotNumber) {
  const filter = String(subFilter || '').trim();
  if (!filter || filter.toLowerCase() === 'all') return true;

  const legacyMatch = filter.match(/^Sub(\d)Only$/i);
  if (legacyMatch) return Number(legacyMatch[1]) === slotNumber;

  if (filter.includes(',') || /^Sub\d$/i.test(filter)) {
    const slots = filter.split(',').map((s) => {
      const m = s.trim().match(/^Sub(\d)$/i);
      return m ? Number(m[1]) : null;
    });
    return slots.includes(slotNumber);
  }

  return false; // unrecognized filter - don't apply rather than guess
}


// Among every Fight Club row whose Rec Build threshold this rank clears,
// picks whichever has the highest Gil/Hr - same selection rule the
// Target Route economics engine used, so the crafting queue always
// agrees with whatever Target Route is displayed elsewhere.
function computeTargetRouteParts(rank, fightClubRows) {
  if (rank < 85) return null;
  let best = null;
  for (const row of fightClubRows) {
    const recBuild = parseRankBuild(row.rec_build_notes);
    if (!recBuild) continue;
    if (rank < recBuild.rank) continue;
    const gilHr = Number(row.gil_hr) || 0;
    if (!best || gilHr > best.gilHr) best = { recBuild, gilHr };
  }
  if (!best) return null;
  return best.recBuild.parts.map((p) => (p.modified ? `${p.letter}+` : p.letter));
}

// The build a sub should have at a rank, as [hull, stern, bow, bridge] letters ('' where a rule leaves a
// slot alone), or null when nothing applies. A sub marked Craft? from rank 85 follows Fight Club's best
// route build; otherwise the highest Sub Rules rule at or below the rank for its slot (and character).
function targetBuildAt({ rank, slot, cid, craftEnabled, rules, fightClubRows }) {
  if (craftEnabled && rank >= 85) {
    const targetParts = computeTargetRouteParts(rank, fightClubRows);
    if (targetParts) return targetParts;
  }
  const applicable = rules.filter((r) => {
    if (rank < r.rank) return false;
    if (!ruleAppliesToSlot(r.sub_filter, slot)) return false;
    if (r.cid_override && String(r.cid_override) !== String(cid)) return false;
    return true;
  });
  if (applicable.length === 0) return null;
  const activeRule = applicable.reduce((best, r) => (r.rank > best.rank ? r : best));
  return SLOT_KEYS.map((slotKey) => String(activeRule[SLOT_COLUMN[slotKey]] || '').trim());
}

// Computes crafting needs for every character (used by get-parts-needed and the shopping list): current build vs target
// (Target Route if Craft?+rank85 and a valid match exists, else the
// sub_build_rules ladder), checked against each character's own spare
// pool (personal + retainer inventory, plus their FC chest) before being
// flagged as an actual craft need. Port of the old n8n Parse Parts
// Needed / Parse Spare Parts nodes, now reading real Postgres tables
// instead of Sheets tabs and n8n cross-references.
async function computePartsNeeded(client) {
  const { latestCharacter } = await snapshotFragments(client);

  const charactersResult = await client.query(`
    SELECT c.cid, c.name, c.world, c.account_label, c.fc_id, c.num_sub_slots,
           so.sort_index
    FROM ${latestCharacter} c
    LEFT JOIN character_sort_order so ON c.cid = so.cid
    ORDER BY c.cid
  `);

  // Each sub's workshop slot: the slot column (plugin 0.5.0 and database version 6; read through to_jsonb
  // so the query works before that column exists), else the slot in a default name (Submersible-2).
  const subsResult = await client.query(`
    SELECT cid, sub_name, level, part1, part2, part3, part4,
           coalesce((to_jsonb(s)->>'slot')::int, substring(sub_name FROM '^Submersible-([1-4])$')::int) AS slot
    FROM companion_submarine_snapshot s
    WHERE level > 0
  `);

  const rulesResult = await client.query(`
    SELECT rank, cid_override, sub_filter, hull, stern, bow, bridge
    FROM sub_build_rules
  `);

  const craftResult = await client.query(`
    SELECT cid, sub_name, craft_enabled FROM sub_craft_toggle
  `);

  const fightClubResult = await client.query(`
    SELECT rec_build_notes, gil_hr FROM fight_club_routes
  `);

  // Personal + retainer spares, with real retainer names resolved
  // dynamically via companion_retainer_lookup (no hardcoded data).
  const personalAndRetainer = await client.query(`
    SELECT inv.owner_cid, inv.retainer_id, inv.sorted_container, inv.item_id, inv.quantity,
           rl.name AS retainer_name
    FROM companion_inventory_snapshot inv
    LEFT JOIN companion_retainer_lookup rl ON rl.retainer_id = inv.retainer_id
    WHERE inv.sorted_container BETWEEN 0 AND 3
       OR inv.sorted_container BETWEEN 10000 AND 10004
  `);

  const fcChestResult = await client.query(`
    SELECT fc_id, sorted_container, item_id, quantity
    FROM companion_fc_inventory_snapshot
  `);

  const housingResult = await client.query(`
    SELECT cid, has_house FROM companion_character_housing WHERE has_house = true
  `);
  const housedCids = new Set(housingResult.rows.map((r) => String(r.cid)));

  // Subs by character, then by workshop slot (so a renamed sub is still found in its slot).
  const subsByCid = new Map();
  for (const row of subsResult.rows) {
    if (row.slot == null) continue;
    const key = String(row.cid);
    if (!subsByCid.has(key)) subsByCid.set(key, new Map());
    subsByCid.get(key).set(Number(row.slot), row);
  }

  const craftByCidSub = new Map();
  for (const row of craftResult.rows) {
    craftByCidSub.set(`${row.cid}|${row.sub_name}`, row.craft_enabled === true);
  }

  // Spare-parts pool, grouped per character. owner_cid == retainer_id
  // is the sentinel for "this is the character's own bag, not a
  // retainer" (confirmed against real data - NOT 0 as first assumed).
  const poolByCid = new Map();
  function addToPool(cid, part) {
    const key = String(cid);
    if (!poolByCid.has(key)) poolByCid.set(key, []);
    poolByCid.get(key).push(part);
  }

  for (const row of personalAndRetainer.rows) {
    const part = sparePartLookup.get(row.item_id);
    if (!part || row.quantity <= 0) continue;

    const isRetainer = String(row.retainer_id) !== String(row.owner_cid);
    const location = isRetainer
      ? `Retainer: ${row.retainer_name || 'Unknown'}`
      : `Inventory Box ${row.sorted_container + 1}`;

    addToPool(row.owner_cid, {
      class: part.class, slot: part.slot, modified: part.modified,
      location, qty: row.quantity
    });
  }

  // FC chest spares go into the pool of every tracked member of that FC
  // (usually just one: each character has its own FC). It is the same
  // stack object in each pool, so a part taken by one member is gone for
  // the others too, and a shared chest is never promised twice. Personal
  // stacks were added first, so a character uses its own parts first.
  const membersByFcId = fcChestShare.membersByFc(charactersResult.rows);
  for (const row of fcChestResult.rows) {
    const part = sparePartLookup.get(row.item_id);
    if (!part || row.quantity <= 0) continue;

    const stack = {
      class: part.class, slot: part.slot, modified: part.modified,
      location: `FC Tab ${row.sorted_container - 20000 + 1}`, qty: row.quantity
    };
    for (const ownerCid of membersByFcId.get(String(row.fc_id)) || []) {
      addToPool(ownerCid, stack);
    }
  }

  const fightClubRows = fightClubResult.rows;
  const results = [];

  for (const character of charactersResult.rows) {
    const cidStr = String(character.cid);
    const subs = subsByCid.get(cidStr) || new Map();
    const numSlots = character.num_sub_slots || 0;

    const characterNeeds = [];

    for (let slot = 1; slot <= 4; slot++) {
      const sub = subs.get(slot);
      const subName = sub ? sub.sub_name : `Submersible-${slot}`;

      if (!sub) {
        if (slot <= numSlots) {
          for (const slotKey of SLOT_KEYS) {
            characterNeeds.push({ subName, rank: 0, slotKey, letter: 'S' });
          }
        }
        continue;
      }

      const rank = sub.level || 0;
      const current = {
        Hull: partLetter(sub.part1),
        Stern: partLetter(sub.part2),
        Bow: partLetter(sub.part3),
        Bridge: partLetter(sub.part4),
      };

      const craftEnabled = craftByCidSub.get(`${character.cid}|${subName}`) === true;

      const target = targetBuildAt({ rank, slot, cid: character.cid, craftEnabled, rules: rulesResult.rows, fightClubRows });
      if (!target) continue;
      SLOT_KEYS.forEach((slotKey, i) => {
        const targetLetter = target[i];
        if (targetLetter && current[slotKey] !== targetLetter) {
          characterNeeds.push({ subName, rank, slotKey, letter: targetLetter, current: current[slotKey] });
        }
      });
    }

    // Housed-but-fully-unbuilt starter parts: a character with a real
    // FC house but a workshop never even unlocked (num_sub_slots = 0)
    // still needs a starting Shark-class Submersible-1 to get going -
    // matches the old Sheet-era "Inject Starter Parts" logic, scoped
    // to Submersible-1 only. Only fires here, since the normal
    // per-slot loop above already covers any character with
    // num_sub_slots > 0 (an unlocked-but-unbuilt slot within their
    // real slot count) - this is specifically the zero-slots case
    // that loop can never reach.
    if (numSlots === 0 && subs.size === 0 && housedCids.has(cidStr)) {
      for (const slotKey of SLOT_KEYS) {
        characterNeeds.push({ subName: 'Submersible-1', rank: 0, slotKey, letter: 'S' });
      }
    }

    characterNeeds.sort((a, b) => b.rank - a.rank);

    // Letter ('W', 'S+') -> { cls, modified }; null for anything that is not a known part.
    const decode = (letter) => {
      const text = String(letter || '');
      const modified = text.endsWith('+');
      const cls = SPARE_LETTER_TO_CLASS[modified ? text.slice(0, -1) : text];
      return cls ? { cls, modified } : null;
    };
    const needs = characterNeeds.map((need) => {
      const wanted = decode(need.letter);
      return {
        ...need,
        cls: wanted ? wanted.cls : need.letter.replace(/\+$/, ''),
        modified: need.letter.endsWith('+'),
        freed: decode(need.current),
      };
    });
    const matched = matchNeeds(needs, poolByCid.get(cidStr) || []);

    needs.forEach((need, i) => {
      results.push({
        cid: character.cid,
        character_name: character.name,
        world: character.world,
        account_label: character.account_label,
        sort_index: character.sort_index,
        sub_name: need.subName,
        rank: need.rank,
        slot: need.slotKey,
        needed_class: need.cls,
        needed_modified: need.modified,
        spare_location: matched[i].location,
        recycled_from: matched[i].recycledFrom
      });
    });
  }

  return results;
}

ipcMain.handle('get-parts-needed', async () => {
  return withClient(async (client) => {
    return { success: true, rows: await computePartsNeeded(client) };
  }, (err) => {
    return { success: false, error: err.message };
  });
});

// The item ID of a submarine part ('Whale', 'Bow', modified false -> 22528), or null.
function partItemId(cls, slot, modified) {
  const base = (modified ? SPARE_PART_MODIFIED_BASE_IDS : SPARE_PART_CLASS_BASE_IDS)[cls];
  const offset = SPARE_PART_ITEM_ID_SLOT_ORDER.indexOf(slot);
  return base && offset >= 0 ? base + offset : null;
}

// Sub Build Rules CRUD - full read/write access from the Parts view's
// rules panel. rank/cid_override are stored as their real types;
// cid_override is nullable (blank = general rule, applies to everyone).
ipcMain.handle('get-sub-build-rules', async () => {
  return withClient(async (client) => {
    const result = await client.query(`
      SELECT id, rank, cid_override, sub_filter, hull, stern, bow, bridge
      FROM sub_build_rules
      ORDER BY rank
    `);
    return { success: true, rows: result.rows };
  }, (err) => {
    return { success: false, error: err.message };
  });
});

ipcMain.handle('add-sub-build-rule', async (event, rule) => {
  return withClient(async (client) => {
    const result = await client.query(
      `INSERT INTO sub_build_rules (rank, cid_override, sub_filter, hull, stern, bow, bridge, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       RETURNING id`,
      [
        rule.rank,
        rule.cid_override || null,
        rule.sub_filter || '',
        rule.hull || '',
        rule.stern || '',
        rule.bow || '',
        rule.bridge || ''
      ]
    );
    return { success: true, id: result.rows[0].id };
  }, (err) => {
    return { success: false, error: err.message };
  });
});

ipcMain.handle('update-sub-build-rule', async (event, rule) => {
  return withClient(async (client) => {
    await client.query(
      `UPDATE sub_build_rules
       SET rank = $1, cid_override = $2, sub_filter = $3,
           hull = $4, stern = $5, bow = $6, bridge = $7, updated_at = now()
       WHERE id = $8`,
      [
        rule.rank,
        rule.cid_override || null,
        rule.sub_filter || '',
        rule.hull || '',
        rule.stern || '',
        rule.bow || '',
        rule.bridge || '',
        rule.id
      ]
    );
    return { success: true };
  }, (err) => {
    return { success: false, error: err.message };
  });
});

ipcMain.handle('delete-sub-build-rule', async (event, id) => {
  return withClient(async (client) => {
    await client.query(`DELETE FROM sub_build_rules WHERE id = $1`, [id]);
    return { success: true };
  }, (err) => {
    return { success: false, error: err.message };
  });
});

module.exports = { computePartsNeeded, partItemId, targetBuildAt };
