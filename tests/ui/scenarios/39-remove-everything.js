// "Remove everything from this PC" in Setup Help: folded behind a button, it lists what goes (here: the
// database and its login, since PostgreSQL wasn't installed by the app) and what stays, offers a final backup,
// asks for the master password, and won't start until DELETE is typed (and only on Windows).
module.exports = async (t) => {
  const { ev, waitFor, check } = t;
  const box = `document.querySelector('.setup-remove')`;
  const setInput = (selector, value) => ev(`(() => { const el = ${box}.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  const database = process.env.PGDATABASE || 'postgres';
  const user = process.env.PGUSER || 'postgres';

  await waitFor(`document.querySelectorAll('.sidebar-button').length>0`, 'the app to load', 60000);
  await ev(`document.querySelector('.gear-button').click()`);
  await waitFor(`!!document.querySelector('.settings-tab')`, 'Settings');
  await ev(`[...document.querySelectorAll('.settings-tab')].find((b) => b.innerText === 'Setup Help').click()`);
  await waitFor(`!!${box}`, 'the Remove everything section', 10000);
  check(!(await ev(`!!${box}.querySelector('.remove-list')`)), 'folded until asked for');
  await ev(`${box}.querySelector('.remove-open').click()`);
  await waitFor(`!!${box}.querySelector('.remove-list')`, 'the list of what goes', 15000);

  const removes = await ev(`[...${box}.querySelectorAll('.remove-list li')].map((li) => li.innerText)`);
  const keeps = await ev(`[...${box}.querySelectorAll('.keep-list li')].map((li) => li.innerText)`);
  const expected = `The "${database}" database${user !== 'postgres' ? ` and its login "${user}"` : ''}`;
  check(removes.includes(expected), `the database (and its login, unless it's "postgres") go: ${JSON.stringify(removes)}`);
  check(!removes.some((r) => /^PostgreSQL/.test(r)) && !removes.includes('The app itself'), "PostgreSQL (not installed by the app) and the app run from source aren't removed");
  check(keeps.includes('Your backup files'), 'backup files stay');
  check(/Your other PCs use this database too/.test(await ev(`${box}.innerText`)), 'warns that other PCs lose the database');
  check(await ev(`${box}.querySelector('.remove-backup').checked`) && /XIV Fleet Companion final backup$/.test(await ev(`${box}.querySelector('.remove-backup-folder').value`)),
    'a final backup is ticked, to a folder of its own');
  check(await ev(`!!${box}.querySelector('.remove-master')`), "PostgreSQL's master password is asked for");

  const start = `${box}.querySelector('.remove-start')`;
  check(await ev(`${start}.disabled`), 'the button waits for DELETE');
  await setInput('.remove-typed', 'DELETE');
  check(await ev(`${start}.disabled`) && /Only on Windows\./.test(await ev(`${box}.innerText`)), 'and is Windows only (this is Linux)');
  await ev(`[...${box}.querySelectorAll('button')].find((b) => b.innerText === 'Cancel').click()`);
  await waitFor(`!${box}.querySelector('.remove-list')`, 'Cancel to fold it again', 5000);
  check(true, 'Cancel folds it again');
};
