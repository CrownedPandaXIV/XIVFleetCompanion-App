// A high-quality stack (stored at its item id + 1,000,000, as the game numbers it) shows the item's name with "(HQ)" on
// Inventory's Character and Fleet tabs, not "Item 1005003".
module.exports = async (t) => {
  const { ev, waitFor, check, nav, query } = t;
  const CID = '18014498578000001';
  await query(`INSERT INTO companion_inventory_snapshot (owner_cid, retainer_id, sorted_container, sorted_slot_index, item_id, quantity)
               VALUES (${CID}, ${CID}, 1, 7, 1005003, 3)`);
  try {
    await nav('Summary');
    await nav('Inventory');
    await ev(`[...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Fleet').click()`);
    await waitFor(`document.body.innerText.includes('(HQ)')`, 'the HQ stack on Fleet', 20000);
    const text = await ev('document.body.innerText');
    check(/Test Ore \(HQ\)/.test(text) && !/Item 1005003/.test(text), 'Fleet names the HQ stack "Test Ore (HQ)"');
  } finally {
    await query(`DELETE FROM companion_inventory_snapshot WHERE item_id = 1005003`);
  }
};
