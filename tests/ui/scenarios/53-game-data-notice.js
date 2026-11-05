// "New game data is available": the app looks once a day for changed game data files (GitHub's answer stood in for
// here) and says so under the header. Update now runs the same check and update as Settings (here the download
// fails, as with no internet, and says so); Later hides it on this PC until something newer changes.
const fs = require('fs');
const path = require('path');

const CHANGES = { Item: '2026-11-04T10:00:00Z', World: '2026-11-03T00:00:00Z' };

module.exports = async (t) => {
  const { ev, waitFor, check, shot } = t;
  const banner = `document.querySelector('.game-data-banner')`;
  const click = (text) => ev(`(() => { const b = [...${banner}.querySelectorAll('button')].find((x) => x.innerText.trim() === ${JSON.stringify(text)}); if (!b) throw new Error('no ' + ${JSON.stringify(text)}); b.click(); return true; })()`);

  await waitFor(`!!${banner}`, 'the new game data banner', 20000);
  const text = await ev(`${banner}.innerText`);
  check(text.startsWith('New game data is available (it changed on ') && text.includes('Update now') && text.includes('Later'),
    'says new game data is available, with Update now and Later: ' + text);
  const stored = await t.query('SELECT changes FROM companion_game_data_check WHERE id = 1');
  check(stored.length === 1 && Object.keys(stored[0].changes).sort().join(',') === 'Item,World', 'what was found is kept in the database for the other PCs');
  await shot('game-data-banner');

  await click('Update now');
  await waitFor(`${banner} && ${banner}.innerText.includes("couldn't be downloaded")`, 'the update to say the download failed', 30000);
  check(await ev(`${banner}.innerText.includes('Try again later, or from Settings > Data > Game Data.')`), 'says where else to try');
  await click('Close');
  await waitFor(`${banner} && ${banner}.innerText.startsWith('New game data is available')`, 'the banner to come back', 10000);

  await click('Later');
  await waitFor(`!${banner}`, 'the banner to close', 5000);
  const remembered = JSON.parse(fs.readFileSync(path.join(t.profile, 'game-data-notice.json'), 'utf8'));
  check(remembered.dismissed === '2026-11-04T10:00:00.000Z', 'Later is remembered on this PC for the latest change: ' + JSON.stringify(remembered));
  check(await ev(`window.api.getGameDataNotice().then((r) => r.success && !r.available)`), 'and not shown again for it');
};

module.exports.before = (db) => db.query('DELETE FROM companion_game_data_check');
module.exports.after = (db) => db.query('DELETE FROM companion_game_data_check');
module.exports.env = () => ({ XIV_FLEET_TEST_GAME_DATA_CHANGES: JSON.stringify(CHANGES), XIV_FLEET_TEST_GAME_DATA_BASE_URL: 'http://127.0.0.1:9/' });
