// Discord alerts: Settings → Discord Alerts saves the webhook (this PC), the @mention and the choices,
// sends a test message, and "Check Now" posts what needs attention (here, the four sample FC houses
// past the 7-day warning). The 30-minute gap and Pause hold a new problem back, Quiet posts without the
// @mention, and the check started from the command line (as the Windows scheduled task does) posts that
// the problems were resolved. Discord is replaced by a small web
// server on this machine that records what is posted.
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

let server = null;
const posts = [];
const MENTION = '123456789012345678';
const CID = '18014498578000001';
const CID2 = '18014498578000002';

module.exports = async (t) => {
  const { ev, sleep, waitFor, check } = t;
  const section = `document.querySelector('.alerts-section')`;
  const setInput = (selector, value) => ev(`(() => { const el = ${section}.querySelector(${JSON.stringify(selector)});
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  const click = (text) => ev(`(() => { const b = [...${section}.querySelectorAll('button')].find((x) => x.innerText.trim() === ${JSON.stringify(text)}); if (!b) throw new Error('no ' + ${JSON.stringify(text)}); b.click(); return true; })()`);
  const status = () => ev(`(${section}.querySelector('.alerts-status') || {}).innerText || ''`);
  const waitStatus = (re, label) => waitFor(`/${re.source}/.test((${section}.querySelector('.alerts-status') || {}).innerText || '')`, label, 20000);

  // Settings opens on its tabs; the last one used is remembered.
  await ev(`localStorage.removeItem('settingsTab')`);
  await ev(`document.querySelector('.gear-button').click()`);
  await waitFor(`!!document.querySelector('.settings-tab.active')`, 'Settings');
  check(JSON.stringify(await ev(`[...document.querySelectorAll('.settings-tab')].map((b) => b.innerText)`)) === JSON.stringify(['General', 'Database', 'Backups', 'Discord Alerts', 'Data', 'Setup Help']),
    'Settings has the General, Database, Backups, Discord Alerts, Data and Setup Help tabs');
  check(await ev(`document.querySelector('.settings-tab.active').innerText === 'General' && !!document.querySelector('.settings-warnings') && !${section}`), 'it starts on General');
  const dot = `document.querySelector('.settings-tab-dot')`;
  // The alert settings load just after Settings opens.
  await waitFor(`!!${dot}`, 'the dot on the Discord Alerts tab', 10000);
  check(await ev(`/not set up yet/.test(${dot}.title)`), 'the Discord Alerts tab has a dot: alerts are not set up yet');
  await ev(`[...document.querySelectorAll('.settings-tab')].find((b) => b.innerText === 'Discord Alerts').click()`);
  await waitFor(`!!${section} && ${section}.innerText.includes('Last check')`, 'the Discord Alerts section');
  await ev(`document.querySelector('.settings-modal .modal-actions button').click()`);
  await ev(`document.querySelector('.gear-button').click()`);
  await waitFor(`!!${section} && ${section}.innerText.includes('Last check')`, 'the Discord Alerts tab again');
  check(true, 'reopening Settings goes back to the last tab used');
  check(await ev(`${section}.innerText.includes('Last check: never')`), 'no check has run yet');

  // The setup guide opens over Settings, step by step, and closes with Escape.
  await click('How to set this up');
  await waitFor(`!!document.querySelector('.modal.alerts-setup-help')`, 'the setup guide');
  const guide = await ev(`document.querySelector('.modal.alerts-setup-help').innerText`);
  check(await ev(`document.querySelectorAll('.modal.alerts-setup-help ol > li').length`) === 7
    && /Copy Webhook URL/.test(guide) && /Developer Mode/.test(guide) && /Send Test Message/.test(guide) && /Check every 5 minutes/.test(guide) && /If something does not work/.test(guide),
    'the setup guide has the seven steps and what to do if something does not work');
  await t.shot('alerts-setup-help');
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  await sleep(200);
  check(await ev(`!document.querySelector('.modal.alerts-setup-help') && !!document.querySelector('.settings-modal')`), 'Escape closes the guide and leaves Settings open');

  // The webhook: refused unless it looks like a Discord one; saved encrypted on this PC.
  await setInput('input.alerts-webhook', 'https://example.com/hook');
  await click('Save');
  await waitStatus(/failed/, 'the refusal');
  check(/does not look like a Discord webhook/.test(await status()), 'a wrong address is refused with a plain message: ' + await status());
  await setInput('input.alerts-webhook', `http://127.0.0.1:${server.address().port}/api/webhooks/1/test`);
  await click('Save');
  await waitFor(`${section}.innerText.includes('Discord webhook saved on this PC.')`, 'the saved webhook');
  check(true, 'the webhook is saved on this PC');
  check(await ev(`${section}.innerText.includes('can only be set up on Windows')`), 'automatic checks are offered on Windows only');

  // The @mention and the choices, saved in the database.
  await setInput('input.alerts-mention', '@me');
  await click('Save Alert Settings');
  await waitStatus(/failed/, 'the refusal');
  check(/17 to 20 digits/.test(await status()), 'a wrong user ID is refused: ' + await status());
  await setInput('input.alerts-mention', MENTION);
  await click('Save Alert Settings');
  await waitStatus(/Save alert settings: done/, 'the save');
  const saved = await t.query(`SELECT setting_value::text AS v FROM fleet_economics_settings WHERE setting_key = 'alert_mention_user_id'`);
  check(saved[0] && saved[0].v === MENTION, 'the user ID is saved in full: ' + (saved[0] && saved[0].v));

  // Test message: @mentions only that user.
  await click('Send Test Message');
  await waitStatus(/Test message: done/, 'the test message');
  const test = posts[posts.length - 1];
  check(posts.length === 1 && test.content.startsWith(`<@${MENTION}>`) && /Test message/.test(test.content), 'the test message is posted with the @mention');
  check(JSON.stringify(test.allowed_mentions) === JSON.stringify({ parse: [], users: [MENTION] }), 'only that user can be pinged (no @everyone or roles)');

  // Check Now: the four houses past the warning.
  await click('Check Now');
  await waitStatus(/Check: done/, 'the check');
  check(posts.length === 2, 'the check posted one message: ' + posts.length);
  const first = posts[1].content;
  check(first.startsWith(`<@${MENTION}> **Fleet alerts**\n**New**`), 'it starts with the @mention and the new problems');
  check((first.match(/^• FC house: /gm) || []).length === 4 && /not entered for 9 days, demolition possible in about 36 days/.test(first),
    'all four houses are listed: ' + first.split('\n').slice(2, 4).join(' | '));
  check(!/Subs idle|Plugin not syncing|Low supplies|Retainers/.test(first), 'nothing else is posted yet (the sample retainers have no ventures, but that is only reported after 30 minutes)');
  check(await ev(`${section}.innerText.includes('Retainers without a venture for more than')`), 'the retainer alert is offered in Settings');
  await waitFor(`${section}.innerText.includes('Last check: just now')`, 'the last check time');
  check(true, 'Settings shows the check just ran');
  check(await ev(`!${dot} && !${section}.querySelector('.alerts-attention')`), 'once a check has run, the dot and the note go away');
  await ev(`${section}.scrollIntoView({ block: 'start' })`);
  await sleep(200);
  await t.shot('alerts-settings');
  await ev(`${section}.querySelector('.alerts-actions').scrollIntoView({ block: 'end' })`);
  await sleep(200);
  await t.shot('alerts-settings-2');

  await click('Check Now');
  await waitStatus(/Check: done/, 'the second check');
  await sleep(300);
  check(posts.length === 2, 'checking again posts nothing (no repeats before 6 hours)');

  const lowCeruleum = async (cid) => {
    await t.query(`UPDATE companion_character_current SET ceruleum = 10 WHERE cid = ${cid}`);
    await t.query(`UPDATE companion_character_snapshot SET ceruleum = 10 WHERE cid = ${cid}`);
  };
  const checkNow = async (label) => {
    await click('Check Now');
    await waitStatus(/Check: done|Check failed/, label);
    await sleep(300);
    return status();
  };

  // At most one message every 30 minutes: a new problem right after a message waits.
  await lowCeruleum(CID);
  await t.query(`INSERT INTO fleet_economics_settings (setting_key, setting_value) VALUES ('low_ceruleum_threshold', 100)
                 ON CONFLICT (setting_key) DO UPDATE SET setting_value = 100`);
  let note = await checkNow('the check right after a message');
  check(posts.length === 2 && /Held until .* \(at most one message every 30 minutes\)/.test(note), 'a new problem minutes after a message waits for the 30-minute gap: ' + note);
  const gapInput = `[...${section}.querySelectorAll('label')].find((l) => l.innerText.includes('Send at most one message every')).querySelector('input')`;
  check(await ev(`${gapInput}.value`) === '30', 'the gap starts at 30 minutes');
  await ev(`(() => { const el = ${gapInput}; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '0'); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await click('Save Alert Settings');
  await waitStatus(/Save alert settings: done/, 'the save');

  // Pause: nothing is posted, whatever the quiet hours setting; resuming posts what is waiting.
  await click('Pause');
  await waitFor(`${section}.innerText.includes('Paused until')`, 'the pause');
  note = await checkNow('the paused check');
  check(posts.length === 2 && /Held: paused until/.test(note), 'while paused nothing is posted: ' + note);
  check(await ev(`${section}.querySelector('.alerts-last-check').innerText.includes('paused until')`), 'Settings says alerts are paused');
  await click('Resume now');
  await waitFor(`!${section}.innerText.includes('Paused until')`, 'the pause to end');
  note = await checkNow('the check after resuming');
  check(posts.length === 3 && /^<@\d+> \*\*Fleet alerts\*\*\n\*\*New\*\*\n• Low supplies: Bex Kitteh 1 \(Cuchulainn\): ceruleum 10 \(below 100\)$/.test(posts[2].content),
    'after resuming, the held problem is posted with the @mention: ' + (posts[2] && posts[2].content));

  // Quiet (no @mention) for N hours: messages still arrive, without pinging.
  await click('Start');
  await waitFor(`${section}.innerText.includes('Quiet (no @mention) until')`, 'quiet time');
  await lowCeruleum(CID2);
  note = await checkNow('the quiet check');
  check(posts.length === 4 && posts[3].content === '**Fleet alerts**\n**New**\n• Low supplies: Cal Kitteh 2 (Behemoth): ceruleum 10 (below 100)' && /without the @mention/.test(note),
    'during quiet time the message is posted without the @mention: ' + (posts[3] && posts[3].content));
  check(!posts[3].allowed_mentions.users.length, 'and nobody can be pinged by it');
  await click('End quiet time now');
  await waitFor(`!${section}.innerText.includes('Quiet (no @mention) until')`, 'quiet time to end');

  // The command-line check (what the scheduled task runs): no window, posts that the problem went away.
  await t.query(`UPDATE fleet_economics_settings SET setting_value = 0 WHERE setting_key = 'low_ceruleum_threshold'`);
  const started = Date.now();
  const code = await new Promise((resolve) => {
    const child = spawn(require('electron'), [path.join(__dirname, '..', 'launcher.js'), '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--fleet-alerts'], {
      env: { ...process.env, ...module.exports.env(), UI_TEST_PROFILE: t.profile }, stdio: 'ignore',
    });
    const timer = setTimeout(() => { child.kill(); resolve('timed out'); }, 60000);
    child.on('exit', (c) => { clearTimeout(timer); resolve(c); });
  });
  check(code === 0, `the command-line check finishes by itself (exit ${code}, ${((Date.now() - started) / 1000).toFixed(1)} s)`);
  check(posts.length === 5 && posts[4].content === '**Fleet alerts**\n**Resolved**\n• Low supplies: Bex Kitteh 1 (Cuchulainn)\n• Low supplies: Cal Kitteh 2 (Behemoth)',
    'it posts the resolved problems, without the @mention: ' + JSON.stringify(posts[4] && posts[4].content));

  // The alert PC stops checking: after 15 minutes without a check, the dot comes back (on any PC).
  await t.query(`UPDATE fleet_economics_settings SET setting_value = floor(extract(epoch FROM now())) - 3600 WHERE setting_key = 'alert_last_check_at'`);
  await ev(`document.querySelector('.settings-modal .modal-actions button').click()`);
  await ev(`document.querySelector('.gear-button').click()`);
  await waitFor(`!!${dot}`, 'the dot after an hour without a check');
  check(/No alert check since 60 min ago/.test(await ev(`${dot}.title`)), 'an hour without a check brings the dot back: ' + await ev(`${dot}.title`));
  await waitFor(`!!${section} && !!${section}.querySelector('.alerts-attention')`, 'the note in the section');
  await t.shot('alerts-stale');
};

module.exports.before = async (db) => {
  // The sample data's plugin sync time is when the test database was built; make it current.
  await db.query(`UPDATE companion_character_current SET last_synced_at = now()`);
  await db.query(`UPDATE companion_character_snapshot SET snapshot_at = now()`);
  // The sample subs are many ranks behind their builds; "ready for new parts" (scenario 29, alerts tests)
  // is left out here so the messages hold only what this scenario is about.
  await db.query(`INSERT INTO fleet_economics_settings (setting_key, setting_value) VALUES ('alert_build_on', 0)
                  ON CONFLICT (setting_key) DO UPDATE SET setting_value = 0`);
};

module.exports.after = async (db) => {
  await db.query(`DELETE FROM fleet_economics_settings WHERE setting_key LIKE 'alert\\_%' OR setting_key = 'low_ceruleum_threshold'`);
  await db.query(`UPDATE companion_character_current SET ceruleum = 5000 WHERE cid IN (${CID}, ${CID2})`);
  await db.query(`UPDATE companion_character_snapshot SET ceruleum = 5000 WHERE cid IN (${CID}, ${CID2})`);
};

module.exports.setup = () => new Promise((resolve) => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try { posts.push(JSON.parse(body)); } catch { posts.push({ content: body }); }
      res.writeHead(204);
      res.end();
    });
  });
  server.listen(0, '127.0.0.1', resolve);
});

module.exports.env = () => ({ FLEET_ALERTS_ALLOW_LOCAL_WEBHOOK: '1' });

module.exports.teardown = () => new Promise((resolve) => (server ? server.close(() => resolve()) : resolve()));
