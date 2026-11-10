// A PC that keeps its fleet in the plugin's file ("Just this PC"): the click-through fleet copied into a fleet file,
// with the plugin's choice for the PC (store.json) beside it. The app follows that choice even with a database
// connection saved: every page shows the file's fleet, an edit lands in the file, and Settings shows the file, its
// backups (one made from here) and its game data instead of the database's connection, backups and tools.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client } = require('pg');
const { copyIntoFile } = require('../../db/copy-to-file');

process.removeAllListeners('warning');
const { DatabaseSync } = require('node:sqlite');

const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-file-ui-'));
const fleetFile = path.join(folder, 'fleet.db');
const gameFile = path.join(folder, 'game-data.db');

module.exports = async (t) => {
  const { ev, waitFor, check, nav, shot, setSelect, chartReady } = t;
  const characters = new DatabaseSync(fleetFile).prepare('SELECT count(*) AS n FROM companion_character_current').get().n;
  const close = () => ev(`[...document.querySelectorAll('.modal-actions button')].find((b) => b.innerText === 'Close').click()`);
  const openTab = async (label) => {
    await ev(`[...document.querySelectorAll('.settings-tab')].find((b) => b.innerText === '${label}').click()`);
  };

  check(await ev(`!document.querySelector('.setup-wizard')`), 'no setup screen: there is nothing to set up');
  await waitFor(`document.querySelector('.connection-dot').innerText === 'Fleet file'`, 'the header says where the fleet is', 20000);
  check(true, "the header says it's the fleet file");
  await nav('Character Roster');
  await waitFor(`document.querySelectorAll('table tbody tr').length >= ${characters}`, `the Roster's ${characters} characters`, 30000);
  check(true, `the Roster lists the file's ${characters} characters`);

  // Every page opens without an error.
  for (const page of ['Summary', 'Trends', 'Subs', 'Route Optimization', 'Parts', 'Supplies', 'Salvage', 'Retainers', 'Free Companies',
    'Inventory', 'Income', 'Gil & Market', 'PCs']) {
    await nav(page);
    await t.sleep(1500);
    const error = await ev(`[...document.querySelectorAll('.error, .status')].map((e) => e.innerText).find((x) => /^(Error|Failed)|could not|no such/i.test(x)) || ''`);
    check(!error, `${page} opens on the file${error ? `: ${error}` : ''}`);
  }
  // Trends on the file: salvage shows what was gained a day, as on the database.
  await nav('Trends');
  await chartReady();
  await setSelect('Value', 'salvage_value'); await t.sleep(300); await chartReady(); await t.sleep(300);
  const salvageRate = await ev(`[...document.querySelectorAll('.trend-summary-label')].map(l => l.innerText.trim() + ': ' + l.nextElementSibling.innerText.trim())`);
  check(salvageRate.some((x) => /^Gained a day: \+[\d,]+$/.test(x)), 'Trends on the file: salvage shows what was gained a day: ' + JSON.stringify(salvageRate));

  await nav('Subs');
  await t.sleep(1500);
  await shot('subs-on-the-file');

  // An edit lands in the file: Settings > General's low supply warnings.
  await ev(`document.querySelector('.gear-button').click()`);
  await waitFor(`!!document.querySelector('.settings-tab')`, 'Settings');
  await openTab('Database');
  await waitFor(`[...document.querySelectorAll('.settings-section h3')].some((h) => h.innerText === 'The fleet file')`, 'the Database tab shows the file', 20000);
  const db = await ev(`document.querySelector('.settings-modal, .modal').innerText`);
  check(db.includes(fleetFile), 'and where it is');
  check(!/Database Connection|Speed check|Move the database/i.test(db), "and not the database's connection, speed check or move");
  await shot('settings-fleet-file');

  await openTab('Backups');
  await waitFor(`[...document.querySelectorAll('.settings-section h3')].some((h) => h.innerText === 'Backups of the fleet file')`, "the file's backups", 20000);
  await ev(`[...document.querySelectorAll('.settings-section button')].find((b) => b.innerText === 'Back up now').click()`);
  await waitFor(`/Backed up as fleet-/.test(document.querySelector('.settings-section').innerText)`, 'Back up now', 20000);
  const made = fs.readdirSync(path.join(folder, 'Backups')).filter((n) => /^fleet-.*\.db$/.test(n));
  check(made.length === 1, `a backup beside the file, named as the plugin names them: ${made.join(', ')}`);
  check(new DatabaseSync(path.join(folder, 'Backups', made[0])).prepare('SELECT count(*) AS n FROM companion_character_current').get().n === characters,
    'holding the whole fleet');
  check(await ev(`document.querySelectorAll('.settings-section table tbody tr').length`) === 1, 'and listed');

  await openTab('Data');
  await waitFor(`/Game Data/.test(document.querySelector('.settings-modal, .modal').innerText) && !!document.querySelector('.settings-section button')`, 'Data', 20000);
  check(await ev(`[...document.querySelectorAll('.settings-section button')].some((b) => b.innerText === 'Update now')`), "the game data has Update now (the app's own file)");
  check(await ev(`![...document.querySelectorAll('.settings-section button')].some((b) => b.innerText === 'Check for updates')`), "not the database's check");

  await openTab('General');
  await waitFor(`!!document.querySelector('.settings-warnings')`, 'General', 20000);
  const saved = await ev(`window.api.saveLowThresholds({ repairKitThreshold: 33, ceruleumThreshold: 444, houseWarnDays: 9, notSyncedMinutes: 45 })`);
  check(saved && saved.success, 'the low supply warnings save');
  const rows = new DatabaseSync(fleetFile).prepare(`SELECT setting_key, setting_value FROM fleet_economics_settings WHERE setting_key IN ('low_repair_kit_threshold', 'low_ceruleum_threshold')`).all();
  check(rows.some((r) => r.setting_key === 'low_ceruleum_threshold' && r.setting_value === 444) && rows.some((r) => r.setting_key === 'low_repair_kit_threshold' && r.setting_value === 33),
    `into the file: ${JSON.stringify(rows)}`);
  await close();
};

// The click-through fleet, copied into the file, and the plugin's choice for this PC beside it.
module.exports.setup = async () => {
  const pg = new Client();
  await pg.connect();
  try {
    await copyIntoFile(pg, fleetFile, gameFile);
  } finally {
    await pg.end();
  }
  fs.writeFileSync(path.join(folder, 'store.json'), JSON.stringify({ store: 'thisPc', useRemote: false, changedBy: 'test', changedAt: new Date().toISOString() }));
};
module.exports.env = () => ({ XIV_FLEET_FILE: fleetFile, XIV_FLEET_GAME_DATA: gameFile });
module.exports.teardown = async () => fs.rmSync(folder, { recursive: true, force: true });
