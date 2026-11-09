// Settings → General → This PC shows → Just the database tools (the Database Helper): the sidebar keeps only its home
// page and PCs, the home page says where the database is, whether it's up to date and this PC's backups, its buttons
// open the right Settings tabs, the choice is kept after a restart of the page, and Open the full app brings it all back.
module.exports = async (t) => {
  const { ev, waitFor, check, nav, shot } = t;
  const groups = () => ev(`[...document.querySelectorAll('.sidebar-group')].map((g) => g.querySelector('.sidebar-group-title').innerText + ': ' + [...g.querySelectorAll('.sidebar-button')].map((b) => b.innerText).join(', ')).join(' | ').toLowerCase()`);
  const close = () => ev(`[...document.querySelectorAll('.modal-actions button')].find((b) => b.innerText === 'Close').click()`);
  const openSettings = async () => {
    await ev(`document.querySelector('.gear-button').click()`);
    await waitFor(`!!document.querySelector('.app-mode-section')`, 'This PC shows', 20000);
  };

  check(!(await groups()).includes('database helper'), 'the full app has no Database Helper page');
  await openSettings();
  check(await ev(`document.querySelector('.app-mode-fleet').checked`), 'This PC shows: My fleet, to start with');
  check(await ev(`!!document.querySelector('.settings-warnings')`), 'the fleet settings are there');
  await ev(`document.querySelector('.app-mode-tools').click()`);
  await waitFor(`document.querySelector('.app-mode-tools').checked`, 'the Database Helper chosen');
  check(await ev(`!document.querySelector('.settings-warnings')`), "the fleet's own settings leave Settings");
  await close();

  await waitFor(`document.querySelector('h1')?.innerText === 'Database Helper' && !!document.querySelector('.helper-card')`, 'the Database Helper', 20000);
  check(await groups() === 'database helper: home | system: pcs', 'the sidebar keeps only Home and PCs: ' + await groups());
  await waitFor(`/Up to date \\(database version \\d+\\)/.test(document.querySelector('.helper-view').innerText)`, 'the database version', 20000);
  // The backups are read separately and can arrive a moment later.
  await waitFor(`/daily backup is off|Backs up every day/.test(document.querySelector('.helper-view').innerText)`, "this PC's backups", 20000);
  await waitFor(`/Answering/.test(document.querySelector('.helper-view').innerText)`, 'that it answers', 20000);
  check(true, 'and that it answers');
  const text = await ev(`document.querySelector('.helper-view').innerText`);
  check(text.includes(`${process.env.PGDATABASE || 'postgres'} on `), 'where the database is');
  check(/No backup made on this PC yet|Last backup/.test(text) && /daily backup is off|Backs up every day/.test(text), "this PC's backups");
  check(/PCs? with the plugin use this database/.test(text), 'how many PCs use it');
  await t.sleep(500);
  await shot('database-helper');

  await ev(`document.querySelector('.helper-open-backups').click()`);
  await waitFor(`!!document.querySelector('.backups-section')`, 'Backups and restore opens the Backups tab', 20000);
  await close();
  await ev(`document.querySelector('.helper-open-database').click()`);
  await waitFor(`[...document.querySelectorAll('.settings-section h3')].some((h) => /Database Connection/i.test(h.innerText))`, 'Connection and moving opens the Database tab', 20000);
  await close();
  await nav('PCs');
  await waitFor(`document.querySelector('h1')?.innerText === 'PCs'`, 'the PCs page', 20000);
  check(true, 'PCs opens from the sidebar');

  await ev('location.reload()');
  await waitFor(`document.querySelectorAll('.sidebar-button').length>0`, 'the app to load again', 60000);
  await waitFor(`document.querySelector('h1')?.innerText === 'Database Helper'`, 'the Database Helper again', 20000);
  check(await groups() === 'database helper: home | system: pcs', 'the choice is kept on this PC');

  await ev(`document.querySelector('.helper-show-fleet').click()`);
  await waitFor(`document.querySelector('h1')?.innerText === 'Summary'`, 'the full app back', 20000);
  check((await groups()).startsWith('overview: summary, trends') && !(await groups()).includes('database helper'), 'Open the full app brings every page back');
};
