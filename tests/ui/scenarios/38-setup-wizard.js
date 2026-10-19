// "Set up this PC": the setup screen from Setup Help (its plan for a database PC, password suggestions, the
// installs being Windows only), connecting this PC to an existing database through it, and the screen opening
// by itself on a first start with no connection saved.
const fs = require('fs');
const path = require('path');

module.exports = async (t) => {
  const { ev, waitFor, check } = t;
  const wiz = `document.querySelector('.setup-wizard')`;
  const text = () => ev(`${wiz}.innerText`);
  const click = (label) => ev(`(() => { const b = [...${wiz}.querySelectorAll('button')].find((x) => x.innerText.trim() === ${JSON.stringify(label)} && !x.disabled); if (!b) throw new Error('no ' + ${JSON.stringify(label)}); b.click(); return true; })()`);
  const role = (key) => ev(`${wiz}.querySelector('input[name=setup-role][value=${key}]').click()`);
  const setInput = (selector, value) => ev(`(() => { const el = ${wiz}.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);

  await waitFor(`document.querySelectorAll('.sidebar-button').length>0`, 'the app to load', 60000);
  check(!(await ev(`!!${wiz}`)), "with a saved connection, the setup screen doesn't open by itself");
  await ev(`document.querySelector('.gear-button').click()`);
  await waitFor(`!!document.querySelector('.settings-tab')`, 'Settings');
  await ev(`[...document.querySelectorAll('.settings-tab')].find((b) => b.innerText === 'Setup Help').click()`);
  await waitFor(`!!document.querySelector('.setup-run-button')`, 'the Set up this PC button', 10000);
  await ev(`document.querySelector('.setup-run-button').click()`);
  await waitFor(`!!${wiz} && !!${wiz}.querySelector('input[name=setup-role]')`, 'the setup screen', 10000);
  check((await ev(`${wiz}.querySelectorAll('input[name=setup-role]').length`)) === 4, 'four kinds of PC to choose from');
  check(await ev(`(${wiz}.querySelector('button.setup-next') || {}).disabled === true`), 'Next waits for a choice');

  await role('dbhost');
  check(/All my PCs are in the same house/.test(await text()), 'a database PC can skip Tailscale when every PC is at home');
  await click('Next');
  await waitFor(`!!${wiz}.querySelector('.setup-master')`, 'the passwords page', 10000);
  const plan = await ev(`[...${wiz}.querySelectorAll('.setup-plan li')].map((li) => li.innerText)`);
  check(plan.length === 4 && /^Download PostgreSQL 18/.test(plan[0]) && /^Download Tailscale/.test(plan[1]) && /let other PCs connect \(Windows asks for permission\)/.test(plan[2]) && /^Make the database/.test(plan[3]),
    `the plan for a database PC: ${JSON.stringify(plan)}`);
  await click('Suggest one');
  // The suggestion comes back from the app a moment later.
  await waitFor(`!!${wiz}.querySelector('.setup-line code')`, 'the suggested password', 5000);
  const suggested = await ev(`${wiz}.querySelector('.setup-line code').innerText`);
  check(/^[A-Za-z0-9]{16}$/.test(suggested) && (await ev(`${wiz}.querySelector('.setup-master').value`)) === suggested && (await ev(`${wiz}.querySelector('.setup-master2').value`)) === suggested,
    'Suggest one fills both boxes and shows it to write down');
  check(await ev(`${wiz}.querySelector('button.setup-start').disabled`) && /Only on Windows\./.test(await text()), 'the installs are Windows only (this is Linux)');
  await click('Back');

  await role('connect');
  await ev(`${wiz}.querySelector('.setup-same-network input').click()`);
  await click('Next');
  await waitFor(`!!${wiz}.querySelector('.setup-conn-host')`, 'straight to the connection details (nothing to install)', 10000);
  await setInput('.setup-conn-host', process.env.PGHOST || '127.0.0.1');
  await setInput('.setup-conn-port', String(process.env.PGPORT || 5432));
  await setInput('.setup-conn-database', process.env.PGDATABASE || 'postgres');
  await setInput('.setup-conn-user', process.env.PGUSER || 'postgres');
  await setInput('.setup-conn-password', process.env.PGPASSWORD || '');
  await click('Test connection');
  await waitFor(`(${wiz}.querySelector('.setup-conn-status') || {}).innerText && ${wiz}.querySelector('.setup-conn-status').innerText !== 'Testing...'`, 'the test', 15000);
  check((await ev(`${wiz}.querySelector('.setup-conn-status').innerText`)) === 'Connected.', 'the connection test works');
  await click('Save and finish');
  await waitFor(`!${wiz}`, 'the setup screen to close', 10000);
  check(true, 'saving closes the setup screen');
  await ev(`[...document.querySelectorAll('.modal-actions button')].find((b) => b.innerText === 'Close').click()`);

  // First start: no connection saved yet.
  const saved = path.join(t.profile, 'pg-credentials.enc');
  const keep = fs.readFileSync(saved);
  fs.unlinkSync(saved);
  await ev('location.reload()');
  await waitFor(`!!document.querySelector('.setup-wizard') && document.querySelector('.setup-wizard').innerText.includes('Welcome!')`, 'the setup screen on a first start', 20000);
  check(true, 'with no connection saved, the setup screen opens by itself');
  await ev(`[...document.querySelectorAll('.setup-wizard button')].find((b) => b.innerText.startsWith('Skip')).click()`);
  await waitFor(`(document.querySelector('.settings-tab.active') || {}).innerText === 'Database'`, 'Settings on the Database tab', 10000);
  check(true, 'skipping goes to Settings → Database');
  fs.writeFileSync(saved, keep);
  t.errors.length = 0; // database calls fail while no connection is saved
};
