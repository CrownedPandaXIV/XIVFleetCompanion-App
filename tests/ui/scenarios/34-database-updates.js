// On its first connection the app records which database updates the database has (db/apply-updates.js): the
// scratch database is made by db/schema.sql, so it is recorded as version 9 and then has each file of db/updates/
// (which change nothing it doesn't already have), with no banner. The window is named after the app.
module.exports = async (t) => {
  const { ev, waitFor, check } = t;
  await waitFor(`document.querySelectorAll('.sidebar-button').length>0`, 'the app to load', 60000);
  const rows = await t.query('SELECT version, name FROM companion_schema_version ORDER BY version');
  check(JSON.stringify(rows) === JSON.stringify([{ version: 9, name: 'catch-up' }, { version: 10, name: 'database_move' }]),
    `the database is recorded as version 9, then update 10: ${JSON.stringify(rows)}`);
  const status = await ev(`window.api.getDatabaseStatus()`);
  check(status && status.ok === true && status.version === 10 && status.latest === 10 && status.applied.length === 0, `nothing more needed changing: ${JSON.stringify(status)}`);
  check(!(await ev(`[...document.querySelectorAll('[role=status]')].some((e) => /database/i.test(e.innerText))`)), 'no database banner');
  check((await ev('document.title')).startsWith('XIV Fleet Companion'), `the window is named XIV Fleet Companion: ${await ev('document.title')}`);
};
