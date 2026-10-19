// Subs: Next Build from Fight Club when the Sub Rules have nothing ahead. The test data's Sub Rules stop at
// rank 80 (all Whale), and Fight Club has O-J-Z (all Whale, 300,000 a day) and O-J (all Shark, 250,000) from
// rank 85, with free repair kits. Bex Kitteh 1's subs are Shark-Whale-Coelacanth-Syldra on O-J:
//   Sub4 (rank 85, making O-J's 250,000): O-J-Z's all-Whale build pays 50,000 more and is unlocked now
//   Sub3 (rank 84, its own gil a day not known yet): the same build once it reaches 85
// Target Route picks the most gil a day after repair kits: O-J-Z.
const BEX_NAME = 'Bex Kitteh 1';

module.exports = async (t) => {
  const { ev, waitFor, check, nav } = t;
  await ev(`window.localStorage.clear()`);
  await nav('Subs');
  await waitFor(`document.querySelectorAll('tbody tr').length > 0`, 'the subs table', 20000);

  const heads = await ev(`[...document.querySelector('thead').querySelectorAll('th')].map(th => th.innerText.trim().toLowerCase().replace(/[\\u25B2\\u25BC]/g, '').trim())`);
  const col = (name) => heads.indexOf(name);
  const subRow = (sub) => ev(`(() => {
    const group = [...document.querySelectorAll('.account-group')].find(g => {
      const h = g.querySelector('h2');
      return h && new RegExp('^' + ${JSON.stringify(BEX_NAME)} + '(\\\\D|$)').test(h.innerText.trim());
    });
    const tr = group && [...group.querySelectorAll('tbody tr')].find(r => r.children[0].innerText.trim() === ${JSON.stringify(sub)});
    return tr ? [...tr.children].map(td => ({ text: td.innerText.trim(), title: (td.querySelector('.next-build') || td).title })) : null;
  })()`);

  const sub4 = await subRow('Sub4');
  check(sub4 && sub4[col('next build')].text === 'WWWW at 85 · now', 'a better build already unlocked shows as now: ' + (sub4 && sub4[col('next build')].text));
  check(sub4 && sub4[col('next build')].title === 'From Fight Club (your Sub Rules have no change ahead): on O-J-Z, 300,000 gil a day after repair kits, 50,000 more than now.',
    'and why on hover: ' + (sub4 && sub4[col('next build')].title));
  check(sub4 && sub4[col('target route')].text === 'O-J-Z', 'Target Route is the most gil a day after repair kits: ' + (sub4 && sub4[col('target route')].text));

  const sub3 = await subRow('Sub3');
  check(sub3 && /^WWWW at 85 · (≈ )?in /.test(sub3[col('next build')].text), 'a sub below 85 gets it at 85, with when: ' + (sub3 && sub3[col('next build')].text));
};
