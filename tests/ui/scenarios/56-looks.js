// Settings → General → Look: every look the plugin has (bar Dalamud's own), the window's colours changing at once and
// kept after a restart of the page, and colour-blind friendly status colours. A screenshot of the Summary in each.
module.exports = async (t) => {
  const { ev, waitFor, check, nav, shot } = t;
  const css = (name) => ev(`getComputedStyle(document.documentElement).getPropertyValue('${name}').trim()`);
  const body = () => ev(`getComputedStyle(document.body).backgroundColor`);
  const pick = async (key) => {
    await ev(`(() => { const s = document.querySelector('.look-choice'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, ${JSON.stringify(key)}); s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  };
  const openSettings = async () => {
    await ev(`document.querySelector('.gear-button').click()`);
    await waitFor(`!!document.querySelector('.look-choice')`, 'the Look section', 20000);
  };
  const close = () => ev(`[...document.querySelectorAll('.modal-actions button')].find((b) => b.innerText === 'Close').click()`);

  await waitFor(`document.querySelectorAll('.sidebar-button').length>0`, 'the app to load', 60000);
  // The sidebar in groups, as the plugin's.
  const groups = await ev(`[...document.querySelectorAll('.sidebar-group')].map((g) => g.querySelector('.sidebar-group-title').innerText + ': ' + [...g.querySelectorAll('.sidebar-button')].map((b) => b.innerText).join(', '))`);
  check(groups.join(' | ').toLowerCase() === 'overview: summary, trends | submarines: subs, route optimization, parts, supplies, salvage | characters: character roster, retainers, free companies, inventory | gil: income, gil & market | system: pcs',
    'the sidebar in groups: ' + groups.join(' | '));
  await openSettings();
  const options = await ev(`[...document.querySelectorAll('.look-choice option')].map((o) => o.innerText)`);
  check(JSON.stringify(options) === JSON.stringify(['XIV Fleet Companion', 'High contrast', 'Princess', 'Deep Sea', 'Sunset Harbor', 'Parchment', 'Evergreen']),
    'a dropdown with every look: ' + options.join(', '));
  check(await ev(`document.querySelectorAll('.look-swatches > span').length`) === 8, 'with a strip of its colours');

  const looks = await ev(`window.Themes.appThemes().map((x) => [x.key, x.tokens.bg, x.tokens.good, x.tokens.cb.good])`);
  for (const [key, bg] of looks) {
    await pick(key);
    await waitFor(`getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() === ${JSON.stringify(bg)}`, `the ${key} look`);
    check(true, `${key}: the page changes at once (${await body()})`);
    await close();
    await nav('Summary');
    await waitFor(`!document.querySelector('.modal-overlay') && document.querySelector('h1').innerText === 'Summary'`, 'the Summary', 20000);
    await t.sleep(1500);
    await shot(`look-${key}`);
    await openSettings();
  }

  await pick('princess');
  await ev(`document.querySelector('.look-colour-blind').click()`);
  const [, , , cbGood] = looks.find((l) => l[0] === 'princess');
  await waitFor(`getComputedStyle(document.documentElement).getPropertyValue('--good').trim() === ${JSON.stringify(cbGood)}`, 'colour-blind colours');
  check(await css('--gil') === await css('--text'), 'colour-blind friendly: gil in plain text, as in the plugin');
  await close();
  await shot('look-princess-colour-blind');

  await ev('location.reload()');
  await waitFor(`document.querySelectorAll('.sidebar-button').length>0`, 'the app to load again', 60000);
  check(await css('--bg') === looks.find((l) => l[0] === 'princess')[1] && await css('--good') === cbGood, 'the look and colour-blind colours are kept on this PC');

  // Back to the default, for the other scenarios.
  await openSettings();
  await ev(`document.querySelector('.look-colour-blind').click()`);
  await pick('fleet');
  await waitFor(`getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() === '#12141a'`, 'the default look');
  await close();
};
