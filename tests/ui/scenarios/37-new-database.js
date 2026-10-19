// Settings → Database → New database on this PC: makes a database and the app's login with PostgreSQL's
// administrator login, then the app switches to it and sets up its tables. While the saved connection works,
// the section is folded behind "Make a new database instead". Also Setup Help's "Let other PCs
// connect", which only runs on Windows (this is Linux), so only its check and message are looked at.
module.exports = async (t) => {
  const { ev, waitFor, check } = t;
  const section = `document.querySelector('.new-database')`;
  const setInput = (selector, value) => ev(`(() => { const el = ${section}.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  const status = () => ev(`(${section}.querySelector('.newdb-status') || {}).innerText || ''`);
  const create = async (label) => {
    await ev(`[...${section}.querySelectorAll('button')].find((b) => b.innerText === 'Create database').click()`);
    await waitFor(`(${section}.querySelector('.newdb-status') || {}).innerText && ${section}.querySelector('.newdb-status').innerText !== 'Creating...'`, label, 30000);
    return status();
  };
  await t.query('DROP DATABASE IF EXISTS ui_newdb WITH (FORCE)');
  await t.query('DROP ROLE IF EXISTS ui_newdb_app');

  await waitFor(`document.querySelectorAll('.sidebar-button').length>0`, 'the app to load', 60000);
  await ev(`document.querySelector('.gear-button').click()`);
  await waitFor(`!!document.querySelector('.settings-tab')`, 'Settings');
  await ev(`[...document.querySelectorAll('.settings-tab')].find((b) => b.innerText === 'Setup Help').click()`);
  await waitFor(`!!document.querySelector('.setup-details')`, 'Setup Help', 10000);
  if (await ev(`!!document.querySelector('.setup-open')`)) {
    await waitFor(`!document.querySelector('.setup-open-check').innerText.startsWith('Checking')`, 'the check from this PC', 20000);
    check(/^Other PCs (can|can't) connect/.test(await ev(`document.querySelector('.setup-open-check').innerText`)), 'the database PC says whether other PCs can connect');
    check(await ev(`[...document.querySelectorAll('.setup-open button')].find((b) => b.innerText === 'Let other PCs connect').disabled`)
      && await ev(`document.querySelector('.setup-open').innerText.includes('Only on Windows.')`), '"Let other PCs connect" is Windows only');
  } else {
    console.log('  (this machine has no network address for other PCs, so "Let other PCs connect" is not offered)');
  }

  await ev(`[...document.querySelectorAll('.settings-tab')].find((b) => b.innerText === 'Database').click()`);
  await waitFor(`!!${section} && !!${section}.querySelector('.newdb-open')`, 'the New database section, folded away while the connection works', 10000);
  check(!(await ev(`!!${section}.querySelector('.newdb-admin-password')`)), 'its fields are hidden while the saved connection works');
  await ev(`${section}.querySelector('.newdb-open').click()`);
  await waitFor(`!!${section}.querySelector('.newdb-admin-password')`, 'the fields after "Make a new database instead"', 5000);
  await setInput('.newdb-admin-password', process.env.PGPASSWORD || '');
  await setInput('.newdb-port', String(process.env.PGPORT || 5432));
  await setInput('.newdb-database', 'ui_newdb');
  await setInput('.newdb-user', 'ui_newdb_app');
  await setInput('.newdb-password', 'ui test password');
  await setInput('.newdb-repeat', 'ui test passwort');
  check((await create('the mismatch')) === "The two passwords for the app don't match.", 'mismatched passwords are caught first');
  await setInput('.newdb-repeat', 'ui test password');
  await setInput('.newdb-database', 'UI NewDB');
  check(/database name can only use/.test(await create('the bad name')), 'a bad name is refused');
  await setInput('.newdb-database', 'ui_newdb');
  const made = await create('the new database');
  check(made.startsWith('Created "ui_newdb"'), `the database is made: ${made}`);
  check(await ev(`${section}.querySelector('.newdb-admin-password').value === '' && ${section}.querySelector('.newdb-password').value === ''`), 'the passwords are cleared from the form');
  await waitFor(`[...document.querySelectorAll('.settings-section input[type=text]')].some((i) => i.value === 'ui_newdb')`, 'the connection form shows the new database', 10000);
  const form = await ev(`[...document.querySelectorAll('.settings-section')][0].querySelectorAll('input[type=text]').length && [...[...document.querySelectorAll('.settings-section')][0].querySelectorAll('input[type=text]')].map((i) => i.value)`);
  check(form[0] === 'localhost' && form.includes('ui_newdb') && form.includes('ui_newdb_app'), `the app now connects to it: ${JSON.stringify(form)}`);
  const owner = await t.query(`SELECT pg_get_userbyid(datdba) AS o FROM pg_database WHERE datname = 'ui_newdb'`);
  check(owner.length === 1 && owner[0].o === 'ui_newdb_app', 'the new login owns the new database');
  await setInput('.newdb-admin-password', process.env.PGPASSWORD || '');
  await setInput('.newdb-password', 'ui test password');
  await setInput('.newdb-repeat', 'ui test password');
  check(/already exists/.test(await create('the same again')), 'making it again says it already exists');

  await ev(`[...document.querySelectorAll('.modal-actions button')].find((b) => b.innerText === 'Close').click()`);
  await t.query('DROP DATABASE IF EXISTS ui_newdb WITH (FORCE)');
  await t.query('DROP ROLE IF EXISTS ui_newdb_app');
};
