// Retainers tab: retainers none of whose items are stored (AllaganTools has not seen them) are listed in
// one collapsed line above the table. In the test data most retainers have no items; Retainer 1-1 has
// some (the shopping list fixtures). Giving Retainer 2-1 an item takes it off the list.
const UNSEEN = `SELECT count(*)::int AS n FROM companion_retainer_lookup rl
                WHERE NOT EXISTS (SELECT 1 FROM companion_inventory_snapshot i WHERE i.owner_cid = rl.owner_cid AND i.retainer_id = rl.retainer_id)`;
const RET21 = 50000021;
const CAL = '18014498578000002';

module.exports = async (t) => {
  const { ev, waitFor, check, nav, sleep, shot } = t;
  const box = `document.querySelector('details.unseen-retainers')`;
  const before = (await t.query(UNSEEN))[0].n;

  await nav('Retainers');
  await waitFor(`!!${box}`, 'the unseen retainers line', 20000);
  const summary = await ev(`${box}.querySelector('summary').innerText`);
  check(summary.startsWith(`${before} retainers' items haven't been seen yet`) && summary.includes('summoning bell'),
    'one line says how many and what to do: ' + summary);
  check(await ev(`!${box}.open`), 'it starts collapsed');
  await ev(`${box}.querySelector('summary').click()`);
  await sleep(200);
  await shot('unseen-retainers');
  const names = await ev(`[...${box}.querySelectorAll('li')].map(li => li.innerText)`);
  check(names.length === before && names.some((n) => /^Retainer 2-1 \(.+ @ .+\)$/.test(n)) && !names.some((n) => n.startsWith('Retainer 1-1 ')),
    'opened, it names each one with its character; one with stored items is not listed: ' + names.slice(0, 3).join(' | '));

  await t.query(`INSERT INTO companion_inventory_snapshot (owner_cid, retainer_id, sorted_container, sorted_slot_index, item_id, quantity)
                 VALUES (${CAL}, ${RET21}, 10000, 0, 22500, 1)`);
  await nav('Summary');
  await nav('Retainers');
  await waitFor(`!!${box} && ${box}.querySelector('summary').innerText.startsWith('${before - 1} ')`, 'one fewer', 20000);
  check(true, 'once its items are stored, it leaves the list');
};

module.exports.after = async (db) => {
  await db.query(`DELETE FROM companion_inventory_snapshot WHERE retainer_id = ${RET21}`);
};
