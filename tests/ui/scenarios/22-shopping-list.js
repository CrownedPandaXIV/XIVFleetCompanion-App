// Parts → Shopping List: the sub parts the Parts tab says to craft, turned into what to craft on the way
// and the raw materials and crystals to gather or buy, less what is held. The sample recipes and held
// items are in tests/ui/fixtures.sql: each Whale-class part is an FC workshop project needing, over its
// two phases, 2 Test Ingot + 1 Test Lumber + 2 Fire Shard; Test Ingot = 3 Test Ore + 1 Fire Shard; Test
// Lumber = 2 Test Log, makes 2. Held: 7 Test Ingot
// (FC chest), 15 Test Ore (a retainer and the bags; 99 more listed on the market do not count) and 40
// Fire Shards. Vendors sell Test Ingot (100 gil) and Test Log (5 gil); "Buy from vendors" buys those
// instead, so no Test Ore or the ingots' shards are needed.
module.exports = async (t) => {
  const { ev, sleep, waitFor, check, nav, clickText, shot } = t;
  await ev(`window.localStorage.clear()`);
  await nav('Parts');
  await waitFor(`[...document.querySelectorAll('button')].some(b => b.innerText.trim() === 'Shopping List')`, 'the Shopping List button', 20000);

  // How many parts the Parts summary says to craft.
  await waitFor(`document.querySelectorAll('tbody tr').length > 0`, 'the Parts summary', 20000);
  const summaryTotal = await ev(`(() => {
    const heads = [...document.querySelector('thead').querySelectorAll('th')].map(th => th.innerText.trim().toLowerCase());
    const i = heads.findIndex(h => h.startsWith('qty'));
    return [...document.querySelector('table').querySelectorAll('tbody tr')].reduce((sum, tr) => sum + Number(tr.children[i].innerText), 0);
  })()`);

  await clickText('button', 'Shopping List');
  await waitFor(`!!document.querySelector('.shopping-list')`, 'the shopping list', 20000);
  await sleep(300);
  await shot('shopping-list');
  // section -> { item name: [cells] }
  const read = (section) => ev(`(() => {
    const rows = [...document.querySelectorAll(${JSON.stringify(`.${section} tbody tr`)})].map(tr => [...tr.children].map(td => td.innerText.trim()));
    return Object.fromEntries(rows.map(r => [r[0], r]));
  })()`);
  const parts = await read('shopping-parts');
  const craft = await read('shopping-craft');
  const gather = await read('shopping-gather');
  const crystals = await read('shopping-crystals');

  const partCount = Object.values(parts).reduce((sum, r) => sum + Number(r[1]), 0);
  check(partCount > 0 && partCount === summaryTotal, `the sub parts to craft match the Parts summary (${partCount} vs ${summaryTotal})`);
  check(Object.values(parts).every((r) => r[2] === 'FC workshop'), 'sub parts are built at the FC workshop');

  const P = partCount;
  const ingot = craft['Test Ingot'] || [];
  check(ingot[1] === String(2 * P) && ingot[2] === '7' && ingot[3] === String(2 * P - 7), `Test Ingot: need ${2 * P}, have 7, make ${2 * P - 7}: ${ingot.join(' | ')}`);
  check(/FC chest \(7\)/.test(ingot[6] || ''), 'the held ingots are shown in the FC chest: ' + ingot[6]);
  const lumber = craft['Test Lumber'] || [];
  check(lumber[3] && lumber[3].startsWith(String(P)) && lumber[3].includes(`${Math.ceil(P / 2)} crafts of 2`), `Test Lumber: make ${P} in ${Math.ceil(P / 2)} crafts: ${lumber[3]}`);
  check(lumber[4] === 'Carpenter' && ingot[4] === 'Blacksmith', 'crafters come from the recipe');

  const ore = gather['Test Ore'] || [];
  const oreNeed = 3 * (2 * P - 7);
  check(ore[1] === String(oreNeed) && ore[2] === '15' && ore[3] === String(oreNeed - 15), `Test Ore: need ${oreNeed}, have 15 (market listings not counted), short ${oreNeed - 15}: ${ore.join(' | ')}`);
  check(/Retainer .*\(10\)/.test(ore[5] || '') && /Bags \(5\)/.test(ore[5] || ''), 'where the ore is held: ' + ore[5]);
  const log = gather['Test Log'] || [];
  check(log[1] === String(2 * Math.ceil(P / 2)), `Test Log: two per lumber craft (${log[1]})`);
  const shard = crystals['Fire Shard'] || [];
  const shardNeed = 2 * P + (2 * P - 7);
  check(shard[1] === String(shardNeed) && shard[2] === '40', `Fire Shards, in their own list: need ${shardNeed}, have 40: ${shard.join(' | ')}`);
  check(!craft['Fire Shard'] && !gather['Fire Shard'], 'crystals are not in the other lists');
  check(ingot[5] === '100 gil' && log[4] === '5 gil' && ore[4] !== '50 gil', 'vendor prices show for what vendors sell (not for ore, which none sells)');

  // Buy from vendors.
  await ev(`[...document.querySelectorAll('.shopping-list label')].find(l => l.innerText.includes('Buy from vendors')).querySelector('input').click()`);
  await waitFor(`!!document.querySelector('.shopping-buy')`, 'the vendor list', 20000);
  await sleep(300);
  await shot('shopping-list-vendors');
  const buy = await read('shopping-buy');
  const craft2 = await read('shopping-craft');
  const gather2 = await read('shopping-gather');
  const crystals2 = await read('shopping-crystals');
  const ingotBuy = buy['Test Ingot'] || [];
  check(ingotBuy[1] === String(2 * P) && ingotBuy[2] === '7' && ingotBuy[3] === String(2 * P - 7)
    && ingotBuy[4] === '100 gil' && ingotBuy[5] === `${((2 * P - 7) * 100).toLocaleString()} gil`, 'Test Ingot is bought, less the 7 held: ' + ingotBuy.join(' | '));
  const logs = 2 * Math.ceil(P / 2);
  const logBuy = buy['Test Log'] || [];
  check(logBuy[3] === String(logs) && logBuy[5] === `${(logs * 5).toLocaleString()} gil`, 'Test Log is bought: ' + logBuy.join(' | '));
  check(!craft2['Test Ingot'] && !!craft2['Test Lumber'], 'bought ingots are not crafted; lumber still is');
  check(!gather2['Test Ore'] && !gather2['Test Log'], 'no ore is needed any more, and logs are bought, not gathered');
  check((crystals2['Fire Shard'] || [])[1] === String(2 * P), 'only the parts\' own shards are needed: ' + (crystals2['Fire Shard'] || [])[1]);
  const total = await ev(`document.querySelector('.shopping-buy .shopping-total').innerText`);
  check(total === `${((2 * P - 7) * 100 + logs * 5).toLocaleString()} gil`, 'the total vendor cost is shown: ' + total);
};
