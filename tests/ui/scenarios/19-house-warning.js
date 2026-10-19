// FC houses nobody has entered for a while: the game demolishes an FC house after 45 days without a member
// entering. The sample houses were entered a few hours ago except four (tests/ui/fixtures.sql): 9 days, 33 days,
// 50 days, and one FCTracker has no date for. The Free Companies tab shows how long ago each house was entered,
// and the Summary lists the ones past the warning setting (7 days unless changed in Settings → General).
module.exports = async (t) => {
  const { ev, sleep, waitFor, check, nav, clickText } = t;

  await ev(`window.localStorage.clear()`);
  await nav('Free Companies');
  await waitFor(`document.querySelectorAll('tbody tr').length > 0`, 'fc rows');
  await sleep(500);
  const ages = await ev(`(() => {
    const ths = [...document.querySelector('thead').querySelectorAll('th')];
    const i = ths.findIndex((th) => th.innerText.toLowerCase().startsWith('last entered'));
    return [...document.querySelectorAll('tbody tr')].map((tr) => { const cell = tr.children[i]; const span = cell.querySelector('.house-age');
      return { text: cell.innerText.trim(), level: span ? span.className.replace('house-age', '').trim() : '' }; });
  })()`);
  const count = (text) => ages.filter((a) => a.text === text).length;
  check(ages.length === 80, 'the Free Companies tab has a Last Entered column: ' + ages.length + ' rows');
  check(count('Today') === 22, 'houses entered a few hours ago show "Today": ' + count('Today'));
  check(count('—') === 54, 'FCs without a house show a dash: ' + count('—'));
  const find = (text) => ages.find((a) => a.text === text) || {};
  check(find('9 days ago').level === 'warn', 'a house 9 days out shows in amber');
  check(find('33 days ago').level === 'danger' && find('50 days ago').level === 'danger', 'houses 30 days or more out show in red');
  check(find('Unknown').level === 'unknown', 'a house with no date says "Unknown", in red');
  check(ages.filter((a) => a.text === 'Today').every((a) => a.level === 'ok'), 'recent houses are not coloured');

  // Sorting by the column puts the houses to check first.
  await ev(`[...document.querySelector('thead').querySelectorAll('th')].find((th) => th.innerText.trim().toLowerCase().startsWith('last entered')).querySelector('span').click()`);
  await sleep(300);
  await ev(`[...document.querySelector('thead').querySelectorAll('th')].find((th) => th.innerText.trim().toLowerCase().startsWith('last entered')).querySelector('span').click()`);
  await sleep(300);
  const sorted = await ev(`(() => { const ths = [...document.querySelector('thead').querySelectorAll('th')];
    const i = ths.findIndex((th) => th.innerText.trim().toLowerCase().startsWith('last entered'));
    return [...document.querySelectorAll('tbody tr')].slice(0, 4).map((tr) => tr.children[i].innerText.trim()); })()`);
  check(JSON.stringify(sorted) === JSON.stringify(['Unknown', '50 days ago', '33 days ago', '9 days ago']),
    'sorting oldest first puts the houses to check at the top: ' + sorted.join(', '));

  // The Summary lists the four houses, most at risk first.
  await nav('Summary');
  await waitFor(`!!document.querySelector('table.house-warnings')`, 'the house warning table', 15000);
  const rows = async () => ev(`[...document.querySelectorAll('table.house-warnings tbody tr')].map((tr) => [...tr.children].map((td) => td.innerText.trim()))`);
  let list = await rows();
  check(list.length === 4, 'the Summary lists 4 houses not entered in 7 days: ' + list.length);
  check(JSON.stringify(list.map((r) => r[4])) === JSON.stringify(['Unknown', '50 days ago', '33 days ago', '9 days ago']), 'most at risk first: ' + list.map((r) => r[4]).join(', '));
  check(JSON.stringify(list.map((r) => r[5])) === JSON.stringify(['Unknown, check in game', 'Any time now', 'about 12 days', 'about 36 days']),
    'with how long until demolition is possible: ' + list.map((r) => r[5]).join(', '));
  check(list.every((r) => /W\d+ P\d+/.test(r[3]) && r[1] !== '—'), 'each shows the house address and world');
  await ev(`document.querySelector('table.house-warnings').scrollIntoView({ block: 'center' })`);
  await t.shot('house-warning-summary');

  // The three warning settings are in Settings → General; "Change in Settings" on the Summary opens it there.
  check(await ev(`document.querySelector('.summary-thresholds').innerText.includes('FC house not entered for 7 days')`), 'the Summary says which warnings are set');
  await ev(`localStorage.setItem('settingsTab', 'data')`);
  await clickText('.summary-thresholds button', 'Change in Settings');
  await waitFor(`!!document.querySelector('.settings-warnings input')`, 'Settings on the General tab');
  check(await ev(`document.querySelector('.settings-tab.active').innerText`) === 'General', '"Change in Settings" opens the General tab (not the last one used)');
  await waitFor(`document.querySelectorAll('.credits-list li').length === 4`, 'the Credits list', 10000);
  check((await ev(`document.querySelector('.credits-list').innerText`)).includes('Allagan Tools by Critical_Impact'), 'General also thanks the plugins\' makers (Credits)');
  const input = `[...document.querySelectorAll('.settings-warnings label')].find((l) => l.innerText.includes('FC house not entered for')).querySelector('input')`;
  const setValue = (v) => ev(`(() => { const el = ${input}; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const saveStatus = `(document.querySelector('.settings-warnings .save-status') || {}).innerText`;
  const save = async () => {
    await ev(`document.querySelector('.settings-warnings button').click()`);
    await waitFor(`/^Failed|^Saved/.test(${saveStatus} || '')`, 'the save to finish');
    return ev(saveStatus);
  };
  check(await ev(`${input}.value`) === '7', 'the warning setting starts at 7 days');
  await t.shot('settings-general');

  // A setting outside 1 to 44 days is refused with a plain message.
  await setValue('60');
  const refused = await save();
  check(/1 to 44/.test(refused), 'a warning of 60 days is refused: ' + refused);

  // Raising the warning to 10 days drops the 9-day house once Settings is closed.
  await setValue('10');
  check(await save() === 'Saved.', 'a warning of 10 days is saved');
  await clickText('.settings-modal .modal-actions button', 'Close');
  await waitFor(`document.querySelectorAll('table.house-warnings tbody tr').length === 3`, 'three houses after raising the warning', 10000);
  list = await rows();
  check(!list.some((r) => r[4] === '9 days ago'), 'at 10 days the 9-day house is no longer listed (the Summary reloads when Settings closes)');
  check(await ev(`document.querySelector('.summary-thresholds').innerText.includes('10 days')`), 'and the Summary shows the new setting');
  await nav('Free Companies');
  await waitFor(`document.querySelectorAll('tbody tr').length > 0`, 'fc rows again');
  await sleep(500);
  check(await ev(`[...document.querySelectorAll('.house-age')].find((s) => s.innerText === '9 days ago').className.includes('ok')`),
    'the Free Companies tab uses the new setting too');
};

module.exports.after = async (db) => {
  await db.query(`DELETE FROM fleet_economics_settings WHERE setting_key = 'house_warn_days'`);
};
