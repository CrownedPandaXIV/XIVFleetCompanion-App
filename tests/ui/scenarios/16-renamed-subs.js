// Subs that do not have the default Submersible-N names (the test subs are named Sub1-Sub4, with their
// workshop slots stored): Parts finds each slot's sub by its slot, so it lists their real upgrade needs
// instead of treating every slot as empty and asking for a whole new Shark-class sub.
const columnTools = require('../columns-helpers');

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
  const ranks = await c.column('rank');
  check(subs.length > 0, `Parts lists needs (${subs.length} rows)`);
  check(subs.every((s) => /^Sub[1-4]$/.test(s)), 'every need is for one of the real subs (Sub1-Sub4), none for an "empty" Submersible-N slot: ' + [...new Set(subs)].join(', '));
  check(ranks.every((r) => r !== '0' && r !== ''), 'no need is for a rank-0 (unbuilt) sub: ' + [...new Set(ranks)].join(', '));
};
