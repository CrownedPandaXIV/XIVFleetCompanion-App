// Fixes from the October 2026 audit, as they show on screen:
//   - a character the plugin no longer syncs (Hana Kitteh 7, 3 days behind the rest of acct1) gets a
//     "not synced" tag on the Roster and is named under Summary's low supplies instead of counted;
//   - characters and Free Companies removed before app 0.17.2 are left out of Trends once, at start-up;
//   - a retainer AllaganTools saw with nothing in it (items_seen_at, database version 7) is not "unseen";
//   - a retainer gear target is checked before it is saved.
const HANA = '18014498578000007';
const GONE = '18014498578099999';
const GONE_FC = '9099999';
const EMPTY_RETAINER = 50000022;
const UNSEEN = `SELECT count(*)::int AS n FROM companion_retainer_lookup rl
                WHERE rl.items_seen_at IS NULL AND NOT EXISTS (SELECT 1 FROM companion_inventory_snapshot i WHERE i.owner_cid = rl.owner_cid AND i.retainer_id = rl.retainer_id)`;

module.exports = async (t) => {
  const { ev, waitFor, check, nav, sleep, shot } = t;

  // Left out of Trends at start-up, once.
  let cleaned = [];
  for (let i = 0; i < 40; i++) {
    cleaned = await t.query(`SELECT (SELECT count(*)::int FROM companion_metric_latest WHERE subject_id IN (${GONE}, ${GONE_FC})) AS stray,
                                    (SELECT count(*)::int FROM fleet_economics_settings WHERE setting_key = 'trends_removed_cleanup_done') AS done`);
    if (cleaned[0].stray === 0 && cleaned[0].done === 1) break;
    await sleep(250);
  }
  check(cleaned[0].stray === 0 && cleaned[0].done === 1, 'a removed character and FC are left out of Trends at start-up, and it is remembered: ' + JSON.stringify(cleaned[0]));
  const history = await t.query(`SELECT count(*)::int AS n FROM companion_metric_history WHERE subject_id IN (${GONE}, ${GONE_FC})`);
  check(history[0].n === 2, 'their history is kept');

  await nav('Character Roster');
  const row = `document.querySelector('tr[data-cid="${HANA}"]')`;
  await waitFor(`!!${row}`, 'Hana on the Roster', 20000);
  check(await ev(`!!${row}.querySelector('.not-synced-tag') && ${row}.querySelector('.not-synced-tag').title.startsWith('Not synced for 3 days')`),
    'the Roster tags a character no longer synced, with how long on hover');
  check(await ev(`document.querySelectorAll('.not-synced-tag').length === 1`), 'only that one');
  await ev(`${row}.scrollIntoView({ block: 'center' })`);
  await shot('roster-not-synced');

  await nav('Summary');
  await waitFor(`!!document.querySelector('.not-synced-note')`, 'the not synced note', 20000);
  const note = await ev(`document.querySelector('.not-synced-note').innerText`);
  check(/^Not counted: 1 character is no longer synced while the rest of their account is \(Hana Kitteh 7 for 3 days\)/.test(note), 'Summary names it: ' + note);
  const hanaRows = await ev(`[...document.querySelectorAll('table tbody tr')].filter(r => [...r.children].some(td => td.innerText.trim() === 'Hana Kitteh 7')).map(r => r.closest('table').className + ': ' + r.innerText)`);
  check(hanaRows.length === 0, 'and does not list its old low supplies or subs: ' + JSON.stringify(hanaRows));

  // A retainer seen with nothing in it is not listed as unseen.
  const before = (await t.query(UNSEEN))[0].n;
  await t.query(`UPDATE companion_retainer_lookup SET items_seen_at = now() WHERE retainer_id = ${EMPTY_RETAINER}`);
  await nav('Retainers');
  await waitFor(`!!document.querySelector('details.unseen-retainers') && document.querySelector('details.unseen-retainers summary').innerText.startsWith('${before - 1} ')`, 'one fewer unseen', 20000);
  check(true, 'a retainer seen with nothing in it is not listed as unseen');

  const bad = await ev(`window.api.saveRetainerTarget({ retainerId: '50000011', targetMode: 'level', targetValue: 2.5, onlyCrafted: false })`);
  const worse = await ev(`window.api.saveRetainerTarget({ retainerId: '50000011', targetMode: 'banana', targetValue: 10, onlyCrafted: false })`);
  check(!bad.success && /whole number from 1 to 999/.test(bad.error) && !worse.success && /Level or ilvl/.test(worse.error),
    'a gear target is checked before it is saved: ' + bad.error + ' / ' + worse.error);
};

module.exports.before = async (db) => {
  await db.query(`UPDATE companion_character_current SET last_synced_at = last_synced_at - interval '3 days 5 minutes', ceruleum = 0 WHERE cid = ${HANA}`);
  await db.query(`INSERT INTO fleet_economics_settings (setting_key, setting_value, updated_at) VALUES ('low_ceruleum_threshold', 100, now())
                  ON CONFLICT (setting_key) DO UPDATE SET setting_value = 100`);
  await db.query(`DELETE FROM fleet_economics_settings WHERE setting_key = 'trends_removed_cleanup_done'`);
  await db.query(`INSERT INTO companion_metric_latest (subject_type, subject_id, metric, value, recorded_at) VALUES
                  ('character', ${GONE}, 'gil', 5, now()), ('fc', ${GONE_FC}, 'fc_points', 5, now())`);
  await db.query(`INSERT INTO companion_metric_history (recorded_at, subject_type, subject_id, metric, value) VALUES
                  (now(), 'character', ${GONE}, 'gil', 5), (now(), 'fc', ${GONE_FC}, 'fc_points', 5)`);
};

module.exports.after = async (db) => {
  await db.query(`UPDATE companion_character_current c SET last_synced_at = o.last_synced_at, ceruleum = 5000
                  FROM companion_character_current o WHERE c.cid = ${HANA} AND o.cid = 18014498578000001`);
  await db.query(`DELETE FROM fleet_economics_settings WHERE setting_key = 'low_ceruleum_threshold'`);
  await db.query(`DELETE FROM companion_metric_latest WHERE subject_id IN (${GONE}, ${GONE_FC})`);
  await db.query(`DELETE FROM companion_metric_history WHERE subject_id IN (${GONE}, ${GONE_FC})`);
  await db.query(`UPDATE companion_retainer_lookup SET items_seen_at = NULL WHERE retainer_id = ${EMPTY_RETAINER}`);
};
