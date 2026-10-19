// Old parts are reused: when a sub is upgraded, the part that comes off can go onto another of the
// character's subs. Bex Kitteh 1's fourth sub is removed for this run, so its empty slot needs a whole
// Shark-class sub, while Sub1-Sub3 (rank 80+) each swap their Shark hull for a Whale hull. One of those
// old Shark hulls covers the new sub's hull, so Parts asks for three Shark parts to be crafted, not four.
const columnTools = require('../columns-helpers');

const CID = '18014498578000001';
let removed = null; // kept as JSON text: character ids are too large for JavaScript numbers

module.exports = async (t) => {
  const { ev, sleep, waitFor, check, nav } = t;
  const c = columnTools(t);
  await ev(`window.localStorage.clear()`);
  await nav('Parts');
  await waitFor(`[...document.querySelectorAll('button')].some(b => b.innerText.trim() === 'Detail')`, 'the Detail button', 20000);
  await ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === 'Detail'); if (!b.disabled) b.click(); })()`);
  await waitFor(`document.querySelectorAll('tbody tr').length>0`, 'Parts detail rows', 20000);
  await sleep(400);
  const subs = await c.column('sub');
  const slots = await c.column('slot');
  const statuses = await c.column('status');
  const newSub = subs.map((s, i) => ({ sub: s, slot: slots[i], status: statuses[i] })).filter((r) => r.sub === 'Submersible-4');
  check(newSub.length === 4, `the empty slot needs a whole sub (${newSub.length} parts)`);
  const hull = newSub.find((r) => r.slot === 'Hull') || {};
  check(/^Reuse: Sub[1-3]'s old Hull \(once it is upgraded\)$/.test(hull.status), `its hull is an old one from an upgrade: ${hull.status}`);
  const others = newSub.filter((r) => r.slot !== 'Hull');
  check(others.every((r) => r.status === 'Needs Crafting'), 'its other three parts need crafting: ' + others.map((r) => r.status).join(', '));
  check(statuses.filter((s) => s.startsWith('Reuse:')).length === 1, 'only the one old part is reused');
};

module.exports.before = async (db) => {
  const { rows } = await db.query(
    `DELETE FROM companion_submarine_snapshot WHERE cid = ${CID} AND sub_name = 'Sub4' RETURNING to_jsonb(companion_submarine_snapshot)::text AS row`);
  removed = rows.map((r) => r.row);
};

module.exports.after = async (db) => {
  for (const row of removed || []) {
    await db.query(`INSERT INTO companion_submarine_snapshot SELECT * FROM jsonb_populate_record(NULL::companion_submarine_snapshot, $1::jsonb)`, [row]);
  }
};
