// The crafting shopping list: turns the sub parts that need crafting into everything to craft on the
// way and the raw materials to gather or buy, less what is already held. No Electron or pg here, so it
// can be tested on its own (tests/shopping-list.test.js).

// Shards, crystals and clusters (fire to water): item IDs 2 to 19.
const isCrystal = (itemId) => itemId >= 2 && itemId <= 19;

// parts:   Map itemId -> how many to craft (the sub parts the Parts tab says to craft; spares and reused
//          old parts are already taken off, so what is held of these is not counted again).
// recipes: Map itemId -> { yield, job, ingredients: [{ itemId, amount }] } for every craftable item.
// held:    Map itemId -> quantity held across the fleet.
// buy:     Set of itemIds to buy from a vendor instead of crafting or gathering (optional).
// Returns {
//   parts:    [{ itemId, need, crafts, job, noRecipe? }]           the sub parts (noRecipe: none found),
//   craft:    [{ itemId, need, have, make, crafts, yield, job }]   things to craft on the way, in the
//                                                                  order to make them,
//   gather:   [{ itemId, need, have, short }]                      raw materials,
//   crystals: [{ itemId, need, have, short }],
//   buy:      [{ itemId, need, have, short }]                      bought from a vendor (not crafted, so
//                                                                  none of their materials are needed),
// }. An item is only expanded once everything that uses it has been counted, so the amount held is
// taken off its total need once and an item used by several recipes is counted together.
function buildShoppingList({ parts, recipes, held, buy = new Set() }) {
  // Every item reachable from the parts through recipes, and how many recipes on the list use each one.
  const users = new Map();
  const seen = new Set();
  const queue = [...parts.keys()];
  while (queue.length) {
    const itemId = queue.shift();
    if (seen.has(itemId)) continue;
    seen.add(itemId);
    if (!users.has(itemId)) users.set(itemId, 0);
    if (buy.has(itemId) && !parts.has(itemId)) continue;
    for (const ing of recipes.get(itemId)?.ingredients || []) {
      users.set(ing.itemId, (users.get(ing.itemId) || 0) + 1);
      queue.push(ing.itemId);
    }
  }

  // Items in an order where each comes after everything that uses it. A recipe loop (none in the game
  // data, but it should not hang) leaves items behind; those are treated as raw materials.
  const order = [];
  const waiting = new Map(users);
  const ready = [...seen].filter((id) => waiting.get(id) === 0);
  while (ready.length) {
    const itemId = ready.shift();
    order.push(itemId);
    if (buy.has(itemId) && !parts.has(itemId)) continue;
    for (const ing of recipes.get(itemId)?.ingredients || []) {
      waiting.set(ing.itemId, waiting.get(ing.itemId) - 1);
      if (waiting.get(ing.itemId) === 0) ready.push(ing.itemId);
    }
  }
  const looped = [...seen].filter((id) => !order.includes(id));
  order.push(...looped);

  const need = new Map(parts);
  const result = { parts: [], craft: [], gather: [], crystals: [], buy: [] };
  for (const itemId of order) {
    const total = need.get(itemId) || 0;
    if (total <= 0) continue;
    const isPart = parts.has(itemId);
    const have = isPart ? 0 : held.get(itemId) || 0;
    const short = Math.max(0, total - have);
    const recipe = looped.includes(itemId) ? null : recipes.get(itemId);
    if (buy.has(itemId) && !isPart) {
      result.buy.push({ itemId, need: total, have, short });
    } else if (recipe) {
      const crafts = Math.ceil(short / recipe.yield);
      for (const ing of recipe.ingredients) need.set(ing.itemId, (need.get(ing.itemId) || 0) + crafts * ing.amount);
      if (isPart) result.parts.push({ itemId, need: total, crafts, job: recipe.job });
      else result.craft.push({ itemId, need: total, have, make: short, crafts, yield: recipe.yield, job: recipe.job });
    } else if (isPart) {
      result.parts.push({ itemId, need: total, crafts: total, job: null, noRecipe: true });
    } else {
      result[isCrystal(itemId) ? 'crystals' : 'gather'].push({ itemId, need: total, have, short });
    }
  }
  // Crafted items in the order to make them: the deepest ingredients first.
  result.craft.reverse();
  const byShort = (a, b) => b.short - a.short || a.itemId - b.itemId;
  result.gather.sort(byShort);
  result.buy.sort(byShort);
  result.crystals.sort((a, b) => a.itemId - b.itemId);
  return result;
}

module.exports = { buildShoppingList, isCrystal };
