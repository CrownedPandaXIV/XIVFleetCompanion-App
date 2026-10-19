// Settings → Setup Help: the details to type on another PC (never the password), the plugin's install
// steps with its repository address, and the Tailscale page's connection test, which says what's wrong.
module.exports = async (t) => {
  const { ev, waitFor, check } = t;
  const section = `document.querySelector('.setup-help')`;
  const page = (label) => ev(`[...${section}.querySelectorAll('.setup-page')].find((b) => b.innerText === ${JSON.stringify(label)}).click()`);
  const text = () => ev(`${section}.innerText`);

  await waitFor(`document.querySelectorAll('.sidebar-button').length>0`, 'the app to load', 60000);
  await ev(`document.querySelector('.gear-button').click()`);
  await waitFor(`!!document.querySelector('.settings-tab')`, 'Settings');
  await ev(`[...document.querySelectorAll('.settings-tab')].find((b) => b.innerText === 'Database').click()`);
  await waitFor(`[...document.querySelectorAll('.link-button')].some((b) => b.innerText === 'Setup Help')`, 'the Database tab links to Setup Help', 10000);
  await ev(`[...document.querySelectorAll('.link-button')].find((b) => b.innerText === 'Setup Help').click()`);
  await waitFor(`!!${section} && !!${section}.querySelector('.setup-details')`, 'Setup Help opens on Connect another PC', 10000);

  const db = process.env.PGDATABASE || 'postgres';
  const user = process.env.PGUSER || 'postgres';
  const details = await ev(`[...${section}.querySelectorAll('.setup-details tr')].map((r) => r.innerText.replace(/\\s+/g, ' ').trim())`);
  const lower = details.map((d) => d.toLowerCase());
  check(lower.includes(`database ${db}`.toLowerCase()) && lower.includes(`username ${user}`.toLowerCase()), `the database name and username are shown: ${JSON.stringify(details)}`);
  check(lower.some((d) => d.startsWith('password the same one')), 'the password is described, not shown');
  // The test database's password can be the same word as its username, so only the Password row is checked.
  const pw = (process.env.PGPASSWORD || '').toLowerCase();
  check(!pw || !lower.find((d) => d.startsWith('password')).includes(pw), 'the saved password is not shown');
  check(await ev(`[...${section}.querySelectorAll('button')].some((b) => b.innerText === 'Copy these details')`), 'the details can be copied');

  await page('The plugin');
  await waitFor(`${section}.innerText.includes('Custom Plugin Repositories')`, 'the plugin page', 5000);
  check((await ev(`${section}.querySelector('.setup-line code').innerText`)) === 'https://raw.githubusercontent.com/CrownedPandaXIV/XIVFleetCompanion-Releases/main/repo.json',
    'the plugin page shows the repository address');
  const repos = await ev(`[...${section}.querySelectorAll('.setup-line code')].map((c) => c.innerText)`);
  check(repos.includes('https://love.puni.sh/ment.json') && repos.includes('https://puni.sh/api/repository/erdelf') && repos.length === 3,
    `AutoRetainer's and FCTracker's repositories are listed too: ${JSON.stringify(repos)}`);
  const steps = await ev(`[...${section}.querySelectorAll('.setup-steps h4')].map((h) => h.innerText)`);
  check(JSON.stringify(steps.map((h) => h.split('.')[0])) === '["1","2","3","4"]', `the plugin page's steps are numbered 1 to 4 once each: ${JSON.stringify(steps)}`);
  check((await ev(`${section}.querySelectorAll('.setup-plugins tr').length`)) === 4, 'the four plugins it works with are listed');
  check(/thank you to their makers: kawaii/.test(await ev(`${section}.querySelector('.setup-thanks').innerText`)), 'and their makers are thanked');
  check(/autoretainer\s+required/i.test(await text()), 'AutoRetainer is marked required');
  await ev(`[...${section}.querySelectorAll('.link-button')].find((b) => b.innerText.includes('Connect another PC')).click()`);
  check(await ev(`!!${section}.querySelector('.setup-details')`), 'its link goes back to the connection details');

  await page('Tailscale');
  await waitFor(`!!${section}.querySelector('.setup-test-address')`, 'the Tailscale page', 5000);
  const setAddress = (value) => ev(`(() => { const el = ${section}.querySelector('.setup-test-address');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  const runTest = async (label) => {
    await ev(`[...${section}.querySelectorAll('button')].find((b) => b.innerText === 'Test connection').click()`);
    await waitFor(`(${section}.querySelector('.setup-test-status') || {}).innerText && ${section}.querySelector('.setup-test-status').innerText !== 'Testing...'`, label, 30000);
    return ev(`${section}.querySelector('.setup-test-status').innerText`);
  };
  await setAddress(process.env.PGHOST || '127.0.0.1');
  const ok = await runTest('the test against the real database');
  check(ok.startsWith('Connected: this PC can reach the database'), `a working address says so: ${ok}`);
  await setAddress('no-such-pc.invalid');
  const bad = await runTest('the test against a made-up address');
  check(bad.startsWith(`Can't find a PC called "no-such-pc.invalid"`), `a made-up address says it can't be found: ${bad}`);
  check(/listen_addresses = '\*'/.test(await text()) && (await text()).includes('100.64.0.0/10'), 'the "can\'t connect" steps give the lines to add');

  await ev(`[...document.querySelectorAll('.modal-actions button')].find((b) => b.innerText === 'Close').click()`);
};
