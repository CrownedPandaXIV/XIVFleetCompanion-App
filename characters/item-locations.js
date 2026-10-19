// "Where is it?": names the place each stack of an item sits (bags, a retainer, an FC chest...) and
// gathers the stacks found into one entry per item. No Electron or pg here, so it can be tested on its
// own (tests/item-locations.test.js).

// Containers that hold money, not items: never searched.
const MONEY_CONTAINERS = [2000, 2502, 12000, 22000];

const CHARACTER_PLACES = [
  [[0, 3], 'Bags'],
  [[1000, 1001], 'Equipped'],
  [[2001, 2001], 'Crystals'],
  [[2003, 2003], 'Mail'],
  [[2004, 2004], 'Key items'],
  [[2500, 2500], 'Armoire'],
  [[2501, 2501], 'Glamour dresser'],
  [[3200, 3500], 'Armoury chest'],
  [[4000, 4001], 'Saddlebag'],
  [[4100, 4101], 'Premium saddlebag'],
];
const RETAINER_PLACES = [
  [[10000, 10006], ''],
  [[11000, 11000], ' (equipped)'],
  [[12001, 12001], ' (crystals)'],
  [[12002, 12002], ' (for sale)'],
];

const inRange = (container, [from, to]) => container >= from && container <= to;

// Where one stack sits, in plain words.
//   stack: { kind: 'character' | 'retainer' | 'fc', container, containerName, retainerName }
function placeLabel(stack) {
  const c = Number(stack.container);
  if (stack.kind === 'fc') {
    if (inRange(c, [20000, 20010])) return `FC chest tab ${c - 20000 + 1}`;
    if (c === 22001) return 'FC crystals';
    return stack.containerName || `FC container ${c}`;
  }
  if (stack.kind === 'retainer') {
    const place = RETAINER_PLACES.find(([range]) => inRange(c, range));
    return `Retainer ${stack.retainerName || 'unknown'}${place ? place[1] : ` (${stack.containerName || c})`}`;
  }
  const place = CHARACTER_PLACES.find(([range]) => inRange(c, range));
  if (place) return place[1];
  if (c >= 25000 && c < 28000) return `House: ${stack.containerName || c}`;
  return stack.containerName || `Container ${c}`;
}

// Roster order for places, the same as the Retainers tab: the character's saved Roster position (none
// last), then its name, then which character it is (several characters can share a name on different
// worlds; their places are never mixed). Within a character: its own places (biggest first), then its
// retainers in hiring order (then by name), then the FC chest it holds (the same member the Salvage tab
// counts the chest on).
function compareRoster(a, b) {
  const aHas = a.sortIndex !== null && a.sortIndex !== undefined;
  const bHas = b.sortIndex !== null && b.sortIndex !== undefined;
  if (aHas && bHas && a.sortIndex !== b.sortIndex) return a.sortIndex - b.sortIndex;
  if (aHas !== bHas) return aHas ? -1 : 1;
  const owner = (a.owner || '').localeCompare(b.owner || '');
  if (owner !== 0) return owner;
  const ownerKey = String(a.ownerKey ?? '').localeCompare(String(b.ownerKey ?? ''));
  if (ownerKey !== 0) return ownerKey;
  const rank = { character: 0, retainer: 1, fc: 2 };
  if (rank[a.kind] !== rank[b.kind]) return rank[a.kind] - rank[b.kind];
  if (a.kind === 'retainer') {
    const aHire = a.hireOrder ?? Infinity;
    const bHire = b.hireOrder ?? Infinity;
    if (aHire !== bHire) return aHire - bHire;
    const name = (a.retainerName || '').localeCompare(b.retainerName || '');
    if (name !== 0) return name;
  }
  return b.qty - a.qty || a.who.localeCompare(b.who) || a.where.localeCompare(b.where);
}

// Stacks -> one entry per item, places in Roster order:
//   [{ itemId, name, total, places: [{ who, world, account, kind, where, qty }] }]
// stacks: [{ itemId, name, who, world, account, kind, container, containerName, retainerName, qty,
//            owner (name of the character it belongs to, or of the FC chest's holder), ownerKey (that
//            character's id), sortIndex, hireOrder }].
// Stacks in the same place (several bag slots) are added together.
function groupByItem(stacks) {
  const items = new Map();
  for (const s of stacks) {
    if (!(s.qty > 0)) continue;
    if (!items.has(s.itemId)) items.set(s.itemId, { itemId: s.itemId, name: s.name, total: 0, places: [] });
    const item = items.get(s.itemId);
    const where = placeLabel(s);
    item.total += s.qty;
    const ownerKey = s.ownerKey ?? null;
    const place = item.places.find((p) => p.ownerKey === ownerKey && p.who === s.who && p.world === (s.world || null) && p.where === where);
    if (place) place.qty += s.qty;
    else {
      item.places.push({
        who: s.who, world: s.world || null, account: s.account || null, kind: s.kind, where, qty: s.qty,
        owner: s.owner || s.who, ownerKey, sortIndex: s.sortIndex ?? null, hireOrder: s.hireOrder ?? null,
        retainerName: s.retainerName || null,
      });
    }
  }
  const list = [...items.values()];
  for (const item of list) item.places.sort(compareRoster);
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

// A search term for SQL ILIKE: % and _ match themselves, and the term can appear anywhere in the name.
function likePattern(term) {
  return `%${String(term).trim().replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

module.exports = { MONEY_CONTAINERS, placeLabel, groupByItem, likePattern };
