// Retainers: venture statuses as the plugin's (FleetReader.VentureStatus/Countdown). Three of Retainer 1-x's
// retainers are sent out: one done an hour ago (Venture Complete), one done in 30 minutes ("30:00", then when it's
// done), one done in two days ("2d 0:00:00"). Put back after.
module.exports = async (t) => {
  const { ev, waitFor, check, nav } = t;
  const ids = [50000011, 50000012, 50000013];
  const was = await t.query(`SELECT retainer_id, has_venture, venture_ends_at FROM companion_retainer_lookup WHERE retainer_id IN (${ids.join(',')})`);
  await t.query(`UPDATE companion_retainer_lookup SET has_venture = true, venture_ends_at = CASE retainer_id
      WHEN ${ids[0]} THEN floor(extract(epoch FROM now() - interval '1 hour'))
      WHEN ${ids[1]} THEN floor(extract(epoch FROM now() + interval '30 minutes'))
      ELSE floor(extract(epoch FROM now() + interval '2 days')) END
    WHERE retainer_id IN (${ids.join(',')})`);
  try {
    await nav('Retainers');
    await waitFor(`[...document.querySelectorAll('tbody tr')].some(r => /Retainer 1-1\\b/.test(r.innerText))`, 'the retainers', 20000);
    const status = (name) => ev(`(() => {
      const i = [...document.querySelector('thead').querySelectorAll('th')].findIndex(th => th.innerText.trim().toLowerCase().startsWith('status'));
      const tr = [...document.querySelectorAll('tbody tr')].find(r => [...r.children].some(td => td.innerText.trim() === ${JSON.stringify(name)}));
      if (!tr) return null;
      const td = tr.children[i];
      const done = td.querySelector('.dim');
      return [...td.childNodes].filter((n) => n !== done).map((n) => n.textContent).join('').trim() + (done ? ' | ' + done.textContent.trim() : '');
    })()`);
    const [done, soon, later] = [await status('Retainer 1-1'), await status('Retainer 1-2'), await status('Retainer 1-3')];
    check(done === 'Venture Complete', `a finished venture: "${done}"`);
    check(/^(29|30):\d\d \| \S/.test(soon || ''), `under an hour as minutes, then when it's done: "${soon}"`);
    check(/^(1d 23|2d 0):\d\d:\d\d \| \S/.test(later || ''), `over a day with the days: "${later}"`);
  } finally {
    for (const r of was) {
      await t.query(`UPDATE companion_retainer_lookup SET has_venture = ${r.has_venture ? 'true' : 'false'},
        venture_ends_at = ${r.venture_ends_at === null ? 'NULL' : Number(r.venture_ends_at)} WHERE retainer_id = ${Number(r.retainer_id)}`);
    }
  }
};
