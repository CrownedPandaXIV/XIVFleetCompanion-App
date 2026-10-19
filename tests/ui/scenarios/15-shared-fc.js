// Two tracked characters in the same Free Company: its chest is counted once in Salvage's fleet total
// (on one member's row), not once per member. Character 2 joins character 1's FC for this scenario.
let expected = null;

module.exports = async (t) => {
  const { ev, waitFor, check, nav } = t;
  await nav('Salvage');
  await waitFor(`document.querySelector('.main-pane').innerText.includes('Fleet Total')`, 'the Salvage tab');
  const text = await ev(`document.querySelector('.main-pane h2').innerText`);
  const shown = Number(text.replace(/[^0-9]/g, ''));
  check(shown === expected, `Fleet Total counts the shared chest once: shows ${shown.toLocaleString()}, expected ${expected.toLocaleString()}`);
};

const ONE = '18014498578000001';
const TWO = '18014498578000002';
const PRICES = `(VALUES (22500, 8000), (22501, 9000), (22502, 10000), (22503, 13000),
                        (22504, 27000), (22505, 28500), (22506, 30000), (22507, 34500)) AS p(item_id, price)`;

module.exports.before = async (db) => {
  for (const table of ['companion_character_current', 'companion_character_snapshot']) {
    if ((await db.query(`select to_regclass('public.${table}') is not null as ok`)).rows[0].ok) {
      await db.query(`update ${table} set fc_id = (select fc_id from ${table} where cid = $1 limit 1) where cid = $2`, [ONE, TWO]);
    }
  }
  await db.query(`update companion_character_housing set fc_id = (select fc_id from companion_character_housing where cid = $1) where cid = $2`, [ONE, TWO]);
  // Every character's own salvage, plus each chest of an FC that has a tracked member, once.
  const r = await db.query(`
    SELECT (SELECT coalesce(sum(i.quantity * p.price), 0) FROM companion_inventory_snapshot i JOIN ${PRICES} USING (item_id))
         + (SELECT coalesce(sum(f.quantity * p.price), 0) FROM companion_fc_inventory_snapshot f JOIN ${PRICES} USING (item_id)
            WHERE f.fc_id IN (SELECT fc_id FROM companion_character_current)) AS total`);
  expected = Number(r.rows[0].total);
};

module.exports.after = async (db) => {
  for (const table of ['companion_character_current', 'companion_character_snapshot']) {
    if ((await db.query(`select to_regclass('public.${table}') is not null as ok`)).rows[0].ok) {
      await db.query(`update ${table} set fc_id = 9000002 where cid = $1`, [TWO]);
    }
  }
  await db.query(`update companion_character_housing set fc_id = 9000002 where cid = $1`, [TWO]);
};
