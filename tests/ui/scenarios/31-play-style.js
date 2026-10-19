// Settings → General → "What do you run?": subs, retainers or both (play-style.js). Worked out from the
// characters by default (the test fleet has both); choosing subs or retainers only leaves out the tabs,
// Summary sections and Income and Gil & Market parts for the other.

module.exports = async (t) => {
  const { ev, sleep, waitFor, check, nav, shot } = t;
  const tabs = () => ev(`[...document.querySelectorAll('.sidebar-button')].map(b => b.innerText.trim())`);

  async function choose(value) {
    await ev(`localStorage.setItem('settingsTab', 'general')`);
    await ev(`document.querySelector('.gear-button').click()`);
    await waitFor(`!!document.querySelector('.play-style select')`, 'What do you run?');
    await ev(`(() => { const s = document.querySelector('.play-style select');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, ${JSON.stringify(value)});
      s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await ev(`[...document.querySelectorAll('.play-style button')].find(b => b.innerText === 'Save').click()`);
    await waitFor(`/Saved/.test(document.querySelector('.play-style').innerText)`, 'the choice saved');
    const now = await ev(`document.querySelector('.play-style-now').innerText`);
    await ev(`document.querySelector('.settings-modal .modal-actions button').click()`);
    await sleep(800);
    return now;
  }

  // Worked out: the test fleet has subs and retainers, so everything shows.
  await nav('Summary');
  await waitFor(`!!document.querySelector('.summary-retainers .retainers-idle-tile')`, 'the Summary retainers section', 20000);
  check((await tabs()).includes('Salvage') && (await tabs()).includes('Retainers'), 'with subs and retainers, every tab shows');
  check(await ev(`document.body.innerText.includes('Fleet-Wide Salvage Total') && document.body.innerText.includes('Low Repair Kits / Ceruleum')`),
    'the Summary shows the subs sections');
  await waitFor(`!document.querySelector('.retainers-idle-tile').innerText.includes('—')`, 'the retainer counts');
  const idle = await ev(`document.querySelector('.retainers-idle-tile').innerText`);
  check(/Without a Venture\n\d+\nof \d+ retainers with a class/.test(idle), 'the Summary shows retainers without a venture: ' + JSON.stringify(idle));
  await shot('summary-both');

  // Retainers only.
  check(await choose('retainers') === 'retainers only', 'Settings saves "Retainers only" and says what is shown');
  const r = await tabs();
  check(!['Salvage', 'Subs', 'Supplies', 'Parts', 'Route Optimization'].some((x) => r.includes(x)) && r.includes('Retainers') && r.includes('Income'),
    'retainers only: the sub tabs are left out: ' + JSON.stringify(r));
  await nav('Summary');
  await waitFor(`!!document.querySelector('.summary-retainers')`, 'the Summary');
  check(await ev(`!document.body.innerText.includes('Fleet-Wide Salvage Total') && !document.body.innerText.includes('Low Repair Kits') && !document.querySelector('.ready-subs')`),
    'the Summary leaves out the subs sections');
  await shot('summary-retainers');
  await nav('Income');
  await waitFor(`!!document.querySelector('.income-loot')`, 'the Income tab');
  check(await ev(`document.body.innerText.includes('Retainer Ventures') && !document.body.innerText.includes('Loot per Voyage') && !document.querySelector('.supplies-summary')`),
    'Income shows only venture income');

  // Subs only.
  check(await choose('subs') === 'subs only', 'Settings saves "Subs only"');
  const s = await tabs();
  check(!s.includes('Retainers') && s.includes('Salvage') && s.includes('Subs'), 'subs only: the Retainers tab is left out: ' + JSON.stringify(s));
  await nav('Summary');
  await waitFor(`document.body.innerText.includes('Fleet-Wide Salvage Total')`, 'the Summary');
  check(await ev(`!document.querySelector('.summary-retainers')`), 'the Summary leaves out the retainers section');
  await nav('Gil & Market');
  await waitFor(`!!document.querySelector('.market-accounts')`, 'Gil & Market');
  check(await ev(`!document.body.innerText.includes('Listings Unsold for a While')`), 'Gil & Market leaves out the listings');
  await nav('Income');
  await waitFor(`!!document.querySelector('.income-table')`, 'the Income tab');
  check(await ev(`!document.body.innerText.includes('Retainer Ventures')`), 'Income leaves out venture income');

  // A tab that is left out while open goes back to the Summary.
  await choose('both');
  await nav('Retainers');
  await choose('subs');
  await waitFor(`document.querySelector('h1').innerText === 'Summary'`, 'back to the Summary');
  check(true, 'a tab left out while it was open goes back to the Summary');
  await choose('auto');
  check((await tabs()).includes('Retainers') && (await tabs()).includes('Salvage'), '"Work it out" shows everything again for this fleet');
};

module.exports.after = async (db) => {
  await db.query(`DELETE FROM tier3_settings WHERE setting_key = 'play_style'`);
};
