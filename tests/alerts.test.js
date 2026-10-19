const test = require('node:test');
const assert = require('node:assert');
const { readAlertSettings, validateAlertSettings, inQuietHours, alertMode, ALERT_DEFAULTS, QUIET_NO_MENTION } = require('../alerts/settings');
const { buildAlerts, formatDuration } = require('../alerts/checks');
const { planAlerts, splitMessages, MESSAGE_LIMIT } = require('../alerts/plan');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const now = new Date(2026, 9, 3, 15, 0).getTime(); // 15:00 local time
// The message gap is tested on its own (below); elsewhere it is off so each step's message shows.
const settings = (over = {}) => ({ ...ALERT_DEFAULTS, minGapMinutes: 0, ...over });

test('defaults: 2 hours idle, 30 minutes without syncing, repeat every 6 hours, one message per 30 minutes, quiet hours off', () => {
  const s = readAlertSettings([]);
  assert.deepStrictEqual([s.enabled, s.subIdleHours, s.syncStaleMinutes, s.repeatHours, s.minGapMinutes, s.quietOn, s.mentionUserId, s.pausedUntil], [true, 2, 30, 6, 30, false, '', 0]);
});

test('saved settings are read back, and bad values fall back to the defaults', () => {
  const s = readAlertSettings([
    { setting_key: 'alert_sub_idle_hours', setting_value: '3.5' },
    { setting_key: 'alert_quiet_on', setting_value: '1' },
    { setting_key: 'alert_quiet_mode', setting_value: '2' },
    { setting_key: 'alert_mention_user_id', setting_value: '123456789012345678' },
    { setting_key: 'alert_repeat_hours', setting_value: '500' },
    { setting_key: 'alert_last_check_at', setting_value: '1790000000' },
  ]);
  assert.strictEqual(s.subIdleHours, 3.5);
  assert.strictEqual(s.quietOn, true);
  assert.strictEqual(s.quietMode, QUIET_NO_MENTION);
  assert.strictEqual(s.mentionUserId, '123456789012345678', 'the id is kept as text (too long for a JS number)');
  assert.strictEqual(s.repeatHours, 6, 'out of range: default');
  assert.strictEqual(s.lastCheckAt, 1790000000);
});

test('saving checks the values and explains what is wrong', () => {
  assert.match(validateAlertSettings({ mentionUserId: '@me' }).error, /17 to 20 digits/);
  assert.match(validateAlertSettings({ subIdleHours: 0 }).error, /Subs idle after/);
  assert.match(validateAlertSettings({ quietOn: true, quietStart: 600, quietEnd: 600 }).error, /different start and end/);
  const ok = validateAlertSettings({ mentionUserId: ' 123456789012345678 ', quietOn: true });
  assert.ok(ok.ok);
  const rows = Object.fromEntries(ok.rows);
  assert.strictEqual(rows.alert_mention_user_id, '123456789012345678');
  assert.strictEqual(rows.alert_quiet_on, 1);
  assert.ok(!('alert_quiet_until' in rows) && !('alert_paused_until' in rows), '"quiet" and "pause" have their own buttons');
  assert.strictEqual(rows.alert_min_gap_minutes, 30);
  assert.match(validateAlertSettings({ minGapMinutes: 500 }).error, /At most one message every/);
});

test('quiet hours, including ones that cross midnight', () => {
  const at = (h, m = 0) => new Date(2026, 9, 3, h, m).getTime();
  const night = settings({ quietOn: true, quietStart: 23 * 60, quietEnd: 8 * 60 });
  assert.strictEqual(inQuietHours(night, at(23, 30)), true);
  assert.strictEqual(inQuietHours(night, at(3)), true);
  assert.strictEqual(inQuietHours(night, at(8)), false, 'ends at 08:00');
  assert.strictEqual(inQuietHours(night, at(15)), false);
  const day = settings({ quietOn: true, quietStart: 9 * 60, quietEnd: 17 * 60 });
  assert.strictEqual(inQuietHours(day, at(12)), true, 'sleeping in the day works too');
  assert.strictEqual(inQuietHours(day, at(20)), false);
  assert.strictEqual(inQuietHours(settings({ quietOn: false }), at(3)), false, 'off');
});

test('how alerts go out: pause holds everything, "quiet for N hours" drops the @mention, quiet hours follow their setting', () => {
  const at = (h, m = 0) => new Date(2026, 9, 3, h, m).getTime();
  const sec = (ms) => ms / 1000;
  assert.strictEqual(alertMode(settings(), at(15)).mode, 'normal');
  assert.strictEqual(alertMode(settings({ pausedUntil: sec(at(18)) }), at(15)).mode, 'hold', 'paused');
  assert.match(alertMode(settings({ pausedUntil: sec(at(18)) }), at(15)).reason, /^paused until/);
  assert.strictEqual(alertMode(settings({ pausedUntil: sec(at(14)) }), at(15)).mode, 'normal', 'the pause has ended');
  assert.strictEqual(alertMode(settings({ pausedUntil: sec(at(18)), quietMode: QUIET_NO_MENTION }), at(15)).mode, 'hold', 'a pause holds even when quiet hours are set to post without the @mention');
  assert.strictEqual(alertMode(settings({ quietUntil: sec(at(18)) }), at(15)).mode, 'silent', 'quiet for N hours: no @mention');
  assert.strictEqual(alertMode(settings({ quietUntil: sec(at(18)), quietMode: 1 }), at(15)).mode, 'silent', 'whatever the quiet hours setting is');
  const nightHold = settings({ quietOn: true, quietStart: 23 * 60, quietEnd: 8 * 60, quietMode: 1 });
  assert.strictEqual(alertMode(nightHold, at(3)).mode, 'hold');
  assert.strictEqual(alertMode({ ...nightHold, quietMode: QUIET_NO_MENTION }, at(3)).mode, 'silent');
  assert.strictEqual(alertMode({ ...nightHold, quietUntil: sec(at(5)) }, at(3)).mode, 'hold', 'quiet hours set to hold win over quiet for N hours');
});

test('durations read naturally', () => {
  assert.strictEqual(formatDuration(45 * MIN), '45 min');
  assert.strictEqual(formatDuration(2 * HOUR + 15 * MIN), '2 h 15 min');
  assert.strictEqual(formatDuration(3 * HOUR), '3 h');
  assert.strictEqual(formatDuration(80 * HOUR), '3 days');
});

const characters = [
  { cid: '1', name: 'Marin', world: 'Golem', account_label: 'Account 2', last_synced_at: new Date(now - 2 * MIN), ceruleum: 100, repair_kits: 300, subs_built: 4 },
  { cid: '2', name: 'Wakana', world: 'Golem', account_label: 'Account 2', last_synced_at: new Date(now - 3 * MIN), ceruleum: 2000, repair_kits: 300, subs_built: 4 },
  { cid: '3', name: 'Sajuna', world: 'Golem', account_label: 'Account 3', last_synced_at: new Date(now - 50 * MIN), ceruleum: 0, repair_kits: 0, subs_built: 4 },
  { cid: '4', name: 'Fresh', world: 'Golem', account_label: 'Account 2', last_synced_at: new Date(now - 2 * MIN), ceruleum: 0, repair_kits: 0, subs_built: 0 },
];
const subs = [
  { cid: '1', sub_name: 'A', level: 90, return_time: (now - 3 * HOUR) / 1000 },
  { cid: '1', sub_name: 'B', level: 90, return_time: (now - 2.5 * HOUR) / 1000 },
  { cid: '1', sub_name: 'C', level: 90, return_time: (now + HOUR) / 1000 },
  { cid: '2', sub_name: 'A', level: 90, return_time: (now - HOUR) / 1000 },
  { cid: '2', sub_name: 'B', level: 0, return_time: (now - 9 * HOUR) / 1000 },
  { cid: '3', sub_name: 'A', level: 90, return_time: (now - 9 * HOUR) / 1000 },
  { cid: '2', sub_name: 'C', level: 90, return_time: 0 },
];
const houses = [
  { fc_id: '10', fc_name: 'Cute Kittehs!', fc_world: 'Golem', district_name: 'Mist', house_ward: 13, house_plot: 9, has_house: true, house_level: 'warn', house_days: 9, demolition_in_days: 36 },
  { fc_id: '11', fc_name: 'Best Cats', has_house: true, house_level: 'ok', house_days: 0 },
  { fc_id: '12', fc_name: 'No House', has_house: false },
  { fc_id: '13', fc_name: 'Lost', district_name: 'Goblet', house_ward: 1, house_plot: 2, has_house: true, house_level: 'unknown', house_days: null, demolition_in_days: null },
];
const data = { characters, subs, houses, thresholds: { ceruleumThreshold: 500, repairKitThreshold: 50 }, formatTime: () => '14:10' };

test('the four checks', () => {
  const alerts = buildAlerts(data, settings(), now);
  const byKey = Object.fromEntries(alerts.map((a) => [a.key, a.text]));
  assert.deepStrictEqual(Object.keys(byKey).sort(), ['house:10', 'house:13', 'subs:1', 'subs:2', 'supplies:1', 'supplies:3', 'sync:Account 3'].sort());
  assert.strictEqual(byKey['subs:2'], 'Wakana (Golem): 1 sub not on a voyage');
  assert.strictEqual(alerts.find((a) => a.key === 'subs:2').waitMs, 2 * HOUR, 'idle since an unknown time: waits the full setting');
  assert.strictEqual(byKey['subs:1'], 'Marin (Golem): 2 subs back in port for 3 h', 'only built subs back for 2 hours or more, longest wait shown');
  assert.strictEqual(byKey['supplies:1'], 'Marin (Golem): ceruleum 100 (below 500)');
  assert.match(byKey['sync:Account 3'], /^Account 3: no new plugin data for 50 min \(last at 14:10\)/);
  assert.match(byKey['house:10'], /Cute Kittehs! \(Golem\), Mist W13 P9: not entered for 9 days, demolition possible in about 36 days/);
  assert.match(byKey['house:13'], /no date/);
  assert.ok(!byKey['subs:3'], "a stopped account's subs are not reported as idle (the sync alert covers it)");
  assert.ok(byKey['supplies:3'], 'its last known supplies are still checked');
  assert.ok(!byKey['supplies:4'], 'a character with no subs built needs no supplies');
});

test('each check can be turned off, and a database error replaces everything', () => {
  const none = buildAlerts(data, settings({ subsOn: false, suppliesOn: false, houseOn: false, syncOn: false }), now);
  assert.deepStrictEqual(none, []);
  const down = buildAlerts({ ...data, dbError: "Can't reach the database at localhost:5432." }, settings(), now);
  assert.deepStrictEqual(down.map((a) => a.key), ['database']);
});

test('a character no longer synced (behind the rest of its account) is named once and left out of the other checks', () => {
  const unticked = { cid: '5', name: 'Old', world: 'Golem', account_label: 'Account 2', last_synced_at: new Date(now - 3 * 24 * HOUR - 2 * MIN), ceruleum: 0, repair_kits: 0, subs_built: 4 };
  const withOld = {
    ...data,
    characters: [...characters, unticked],
    subs: [...subs, { cid: '5', sub_name: 'A', level: 90, return_time: (now - 70 * HOUR) / 1000 }],
    retainers: [{ owner_cid: '5', name: 'Ret', job: 10, has_venture: false }],
  };
  const alerts = buildAlerts(withOld, settings(), now);
  const keys = alerts.map((a) => a.key);
  assert.ok(!keys.includes('subs:5') && !keys.includes('supplies:5') && !keys.includes('retainers:5'), 'its old subs, supplies and retainers are not reported');
  assert.ok(!keys.includes('sync:Account 2'), 'its account is still syncing');
  const note = alerts.find((a) => a.key === 'not-synced');
  assert.match(note.text, /^not synced while the rest of their account is: Old \(Golem\) for 3 days\. Untick them/);
  assert.ok(!buildAlerts(withOld, settings({ syncOn: false }), now).some((a) => a.key === 'not-synced'), 'off with the sync check');
  assert.ok(!buildAlerts(data, settings(), now).some((a) => a.key === 'not-synced'), 'a whole account that stopped is not this (Account 3)');
});

const A = (key, text = key) => ({ key, kind: 'Subs idle', subject: key, text });

test('a new problem is posted once, with the @mention, then repeated after the repeat time', () => {
  const s = settings({ mentionUserId: '123456789012345678' });
  const first = planAlerts({ state: null, alerts: [A('subs:1', 'Marin: 2 subs back')], settings: s, mode: 'normal', now });
  assert.strictEqual(first.messages.length, 1);
  assert.match(first.messages[0], /^<@123456789012345678> \*\*Fleet alerts\*\*\n\*\*New\*\*\n• Subs idle: Marin: 2 subs back$/);
  assert.strictEqual(first.mention, true);
  const again = planAlerts({ state: first.nextState, alerts: [A('subs:1')], settings: s, mode: 'normal', now: now + 10 * MIN });
  assert.deepStrictEqual(again.messages, [], 'not repeated before 6 hours');
  const later = planAlerts({ state: again.nextState, alerts: [A('subs:1', 'Marin: still')], settings: s, mode: 'normal', now: now + 6 * HOUR });
  assert.match(later.messages[0], /\*\*Still going\*\*\n• Subs idle: Marin: still \(for 6 h\)/);
});

test('a problem that clears gets one "Resolved" line, without the @mention', () => {
  const s = settings({ mentionUserId: '123456789012345678' });
  const first = planAlerts({ state: null, alerts: [A('subs:1')], settings: s, mode: 'normal', now });
  const gone = planAlerts({ state: first.nextState, alerts: [], settings: s, mode: 'normal', now: now + 5 * MIN });
  assert.strictEqual(gone.messages[0], '**Fleet alerts**\n**Resolved**\n• Subs idle: subs:1');
  assert.strictEqual(gone.mention, false);
  assert.deepStrictEqual(gone.nextState.alerts, {});
});

test('held (paused, or quiet hours set to hold): nothing is posted; what is still going is posted afterwards', () => {
  const s = settings({ mentionUserId: '123456789012345678', quietMode: 1 });
  const night = planAlerts({ state: null, alerts: [A('subs:1'), A('subs:2')], settings: s, mode: 'hold', now });
  assert.deepStrictEqual(night.messages, []);
  // subs:2 cleared before morning: never mentioned at all.
  const morning = planAlerts({ state: night.nextState, alerts: [A('subs:1')], settings: s, mode: 'normal', now: now + 8 * HOUR });
  assert.strictEqual(morning.messages.length, 1);
  assert.ok(morning.messages[0].includes('subs:1') && !morning.messages[0].includes('subs:2'));
  assert.strictEqual(morning.mention, true);
  // Something announced before quiet time that clears during it is reported resolved afterwards.
  const quietGone = planAlerts({ state: morning.nextState, alerts: [], settings: s, mode: 'hold', now: now + 9 * HOUR });
  assert.deepStrictEqual(quietGone.messages, []);
  const after = planAlerts({ state: quietGone.nextState, alerts: [], settings: s, mode: 'normal', now: now + 16 * HOUR });
  assert.match(after.messages[0], /Resolved/);
});

test('silent (quiet for N hours, or quiet hours set to no @mention): posted as usual, but without the @mention', () => {
  const s = settings({ mentionUserId: '123456789012345678', quietMode: QUIET_NO_MENTION });
  const p = planAlerts({ state: null, alerts: [A('subs:1')], settings: s, mode: 'silent', now });
  assert.strictEqual(p.messages.length, 1);
  assert.ok(!p.messages[0].includes('<@'));
  assert.strictEqual(p.mention, false);
});

test('while the database cannot be read, earlier alerts are not marked resolved', () => {
  const s = settings();
  const first = planAlerts({ state: null, alerts: [A('subs:1')], settings: s, mode: 'normal', now });
  const down = planAlerts({ state: first.nextState, alerts: [{ key: 'database', kind: 'Database', subject: 'the fleet database', text: 'x' }], settings: s, mode: 'normal', keepMissing: true, now: now + MIN });
  assert.ok(!/Resolved/.test(down.messages[0]));
  assert.ok(down.nextState.alerts['subs:1'], 'kept');
});

test('long lists are split under Discord\'s 2000-character limit, the @mention only on the first', () => {
  const lines = Array.from({ length: 200 }, (_, i) => `• Subs idle: Character number ${i} (World): 4 subs back in port for 3 h`);
  const messages = splitMessages('<@1> **Fleet alerts**', lines);
  assert.ok(messages.length > 1);
  assert.ok(messages.every((m) => m.length <= MESSAGE_LIMIT));
  assert.ok(messages[0].startsWith('<@1>') && messages.slice(1).every((m) => !m.includes('<@')));
  assert.strictEqual(messages.join('\n').split('\n').filter((l) => l.startsWith('•')).length, 200, 'no line lost');
});

test('a sub idle since an unknown time is only announced once it has been seen idle for the setting', () => {
  const s = settings();
  const alert = { ...A('subs:2', 'Wakana: 1 sub not on a voyage'), waitMs: 2 * HOUR };
  const first = planAlerts({ state: null, alerts: [alert], settings: s, mode: 'normal', now });
  assert.deepStrictEqual(first.messages, []);
  const soon = planAlerts({ state: first.nextState, alerts: [alert], settings: s, mode: 'normal', now: now + HOUR });
  assert.deepStrictEqual(soon.messages, []);
  const later = planAlerts({ state: soon.nextState, alerts: [alert], settings: s, mode: 'normal', now: now + 2 * HOUR });
  assert.match(later.messages[0], /Wakana: 1 sub not on a voyage/);
  // Sent out again before the wait was over: nothing was ever said, so nothing to resolve.
  const gone = planAlerts({ state: soon.nextState, alerts: [], settings: s, mode: 'normal', now: now + HOUR });
  assert.deepStrictEqual(gone.messages, []);
});

test('the scheduled task starts the app itself in alert mode, every 5 minutes', () => {
  const { createArgs } = require('../alerts/schedule');
  const args = createArgs('C:\\Fleet App\\node_modules\\electron\\dist\\electron.exe', 'C:\\Fleet App');
  assert.deepStrictEqual(args.slice(0, 7), ['/Create', '/TN', 'Fleet Companion alerts', '/SC', 'MINUTE', '/MO', '5']);
  assert.strictEqual(args[8], '"C:\\Fleet App\\node_modules\\electron\\dist\\electron.exe" "C:\\Fleet App" --fleet-alerts', 'paths with spaces are quoted');
  assert.strictEqual(args[9], '/F');
  const installed = createArgs('C:\\Users\\Me\\AppData\\Local\\Programs\\XIV Fleet Companion\\XIV Fleet Companion.exe', null);
  assert.strictEqual(installed[8], '"C:\\Users\\Me\\AppData\\Local\\Programs\\XIV Fleet Companion\\XIV Fleet Companion.exe" --fleet-alerts',
    'the installed app starts its own .exe');
});

test('the scheduled task command is read back, to spot one that runs another copy of the app', () => {
  const { taskToRun, taskCommand } = require('../alerts/schedule');
  const fromSource = taskCommand('E:\\tier3-app-final\\node_modules\\electron\\dist\\electron.exe', 'E:\\tier3-app-final');
  const output = `Folder: \\\r\nHostName:      DESKTOP-2\r\nTaskName:      \\Fleet Companion alerts\r\nStatus:        Ready\r\nTask To Run:   ${fromSource}\r\nStart In:      N/A\r\n`;
  assert.strictEqual(taskToRun(output), fromSource);
  assert.notStrictEqual(taskToRun(output), taskCommand('C:\\Programs\\XIV Fleet Companion\\XIV Fleet Companion.exe', null), 'the installed app is a different copy');
  assert.strictEqual(taskToRun('Ordnerpfad: \\\r\nAuszuführende Aufgabe: x'), null, 'another language: unknown');
});

test('at most one message every 30 minutes: a burst of problems goes out together', () => {
  const s = settings({ minGapMinutes: 30 });
  const first = planAlerts({ state: null, alerts: [A('subs:1')], settings: s, mode: 'normal', now });
  assert.strictEqual(first.messages.length, 1, 'the first problem is posted straight away');
  // More problems in the next minutes wait for the gap.
  const t5 = planAlerts({ state: first.nextState, alerts: [A('subs:1'), A('subs:2')], settings: s, mode: 'normal', now: now + 5 * MIN });
  assert.deepStrictEqual(t5.messages, []);
  assert.strictEqual(t5.heldUntil, now + 30 * MIN, 'held until the gap ends');
  const t10 = planAlerts({ state: t5.nextState, alerts: [A('subs:1'), A('subs:2'), A('subs:3')], settings: s, mode: 'normal', now: now + 10 * MIN });
  assert.deepStrictEqual(t10.messages, []);
  // subs:1 clears and subs:4 comes and goes in between: subs:4 is never posted.
  const t15 = planAlerts({ state: t10.nextState, alerts: [A('subs:2'), A('subs:3'), A('subs:4')], settings: s, mode: 'normal', now: now + 15 * MIN });
  const t20 = planAlerts({ state: t15.nextState, alerts: [A('subs:2'), A('subs:3')], settings: s, mode: 'normal', now: now + 20 * MIN });
  assert.deepStrictEqual(t20.messages, []);
  const t30 = planAlerts({ state: t20.nextState, alerts: [A('subs:2'), A('subs:3')], settings: s, mode: 'normal', now: now + 30 * MIN });
  assert.strictEqual(t30.messages.length, 1, 'one message once the gap is over');
  const text = t30.messages[0];
  assert.ok(/subs:2/.test(text) && /subs:3/.test(text), 'with everything new since the last one');
  assert.match(text, /\*\*Resolved\*\*\n• Subs idle: subs:1/, 'and what cleared in between');
  assert.ok(!/subs:4/.test(text), 'a problem that came and went in between is not posted');
  // The next gap counts from this message.
  const t35 = planAlerts({ state: t30.nextState, alerts: [A('subs:2'), A('subs:3'), A('subs:5')], settings: s, mode: 'normal', now: now + 35 * MIN });
  assert.strictEqual(t35.heldUntil, now + 60 * MIN);
});

test('with the gap at 0, each check posts its news straight away', () => {
  const s = settings({ minGapMinutes: 0 });
  const first = planAlerts({ state: null, alerts: [A('subs:1')], settings: s, mode: 'normal', now });
  const next = planAlerts({ state: first.nextState, alerts: [A('subs:1'), A('subs:2')], settings: s, mode: 'normal', now: now + MIN });
  assert.strictEqual(next.messages.length, 1);
});

test('retainers without a venture: only ones with a class, reported after the wait, per character', () => {
  const s = settings();
  const data = {
    characters: [
      { cid: '1', name: 'Marin', world: 'Golem', account_label: 'A', last_synced_at: new Date(now - MIN) },
      { cid: '2', name: 'Wakana', world: 'Golem', account_label: 'B', last_synced_at: new Date(now - 2 * HOUR) },
    ],
    retainers: [
      { owner_cid: '1', name: 'Zed', job: 10, has_venture: false },
      { owner_cid: '1', name: 'Amy', job: 11, has_venture: false },
      { owner_cid: '1', name: 'Busy', job: 10, has_venture: true },
      { owner_cid: '1', name: 'New Hire', job: 0, has_venture: false },
      { owner_cid: '2', name: 'Stale', job: 10, has_venture: false },
    ],
  };
  const alerts = buildAlerts(data, s, now).filter((a) => a.kind === 'Retainers');
  assert.deepStrictEqual(alerts.map((a) => a.text), ['Marin (Golem): 2 retainers without a venture (Amy, Zed)'],
    'a finished or running venture counts as assigned, one with no class cannot go, and a stopped account is left to the sync alert');
  assert.strictEqual(alerts[0].waitMs, 30 * MIN);
  const first = planAlerts({ state: null, alerts, settings: s, mode: 'normal', now });
  assert.deepStrictEqual(first.messages, [], 'not straight away (AutoRetainer may be resending)');
  const later = planAlerts({ state: first.nextState, alerts, settings: s, mode: 'normal', now: now + 30 * MIN });
  assert.match(later.messages[0], /• Retainers: Marin \(Golem\): 2 retainers without a venture \(Amy, Zed\)/);
  assert.deepStrictEqual(buildAlerts(data, settings({ retainersOn: false }), now).filter((a) => a.kind === 'Retainers'), [], 'can be turned off');
  assert.strictEqual(readAlertSettings([]).retainerIdleMinutes, 30);
});

test('when Discord refuses a later message, only the alerts in the posted ones count as sent', () => {
  const { stateAfterPosting } = require('../alerts/plan');
  const long = (n) => A(`subs:${n}`, `Character ${n}: ${'x'.repeat(300)}`);
  const alerts = Array.from({ length: 12 }, (_, i) => long(i));
  const previous = { alerts: { 'subs:old': { kind: 'Subs idle', subject: 'Old', text: 'Old', firstSeen: now - HOUR, lastSent: now - HOUR } }, lastPostAt: 0 };
  const plan = planAlerts({ state: previous, alerts, settings: settings({ minGapMinutes: 0 }), mode: 'normal', now });
  assert.ok(plan.messages.length >= 2, 'long enough to need two messages');
  const after = stateAfterPosting(plan, previous, 1);
  const sentKeys = Object.entries(after.alerts).filter(([, e]) => e.lastSent === now).map(([k]) => k);
  assert.deepStrictEqual(sentKeys.sort(), plan.messageKeys[0].filter((k) => k.startsWith('subs:') && k !== 'subs:old').sort());
  assert.ok(sentKeys.length > 0 && sentKeys.length < 12, 'some went out, some did not');
  const lastKey = plan.messageKeys[plan.messageKeys.length - 1].find((k) => k !== 'subs:old');
  assert.strictEqual(after.alerts[lastKey].lastSent, null, 'not posted: it goes out next time');
  assert.strictEqual(after.lastPostAt, now);
  const next = planAlerts({ state: after, alerts, settings: settings({ minGapMinutes: 0 }), mode: 'normal', now: now + MIN });
  assert.ok(next.messages.join('\n').includes(lastKey.replace('subs:', 'Character ')) && !next.messages.join('\n').includes('Character 0:'),
    'the next check posts only what did not go out');
  assert.deepStrictEqual(stateAfterPosting(plan, previous, plan.messages.length), plan.nextState, 'all posted: the plan as it was');
});

test('a sub whose rank calls for new parts is announced once per new build, with spares or what to craft', () => {
  const data = {
    characters: [{ cid: '1', name: 'Aki', world: 'Maduin', account_label: 'A', last_synced_at: new Date(now - 5 * MIN), subs_built: 4 }],
    buildNeeds: [
      { cid: '1', sub_name: 'Sub-1', rank: 90, slot: 'Hull', needed_class: 'Whale', needed_modified: true, spare_location: null },
      { cid: '1', sub_name: 'Sub-1', rank: 90, slot: 'Bow', needed_class: 'Shark', needed_modified: false, spare_location: 'Retainer: Oldret' },
      { cid: '1', sub_name: 'Submersible-4', rank: 0, slot: 'Hull', needed_class: 'Shark', needed_modified: false, spare_location: null },
    ],
  };
  const alerts = buildAlerts(data, settings(), now).filter((a) => a.kind === 'Ready for new parts');
  assert.strictEqual(alerts.length, 1, 'an unbuilt slot is not "ready for new parts"');
  assert.strictEqual(alerts[0].text, 'Aki (Maduin): Sub-1 (rank 90) is ready for new parts: Hull Modified Whale (to craft), Bow Shark (spare in Retainer: Oldret)');
  assert.strictEqual(alerts[0].key, 'build:1:Sub-1:HullModified Whale,BowShark');
  assert.strictEqual(buildAlerts(data, settings({ buildOn: false }), now).some((a) => a.kind === 'Ready for new parts'), false, 'can be turned off');
});

test('"ready for new parts" is said once, without the @mention, never repeated and with no "Resolved" line', () => {
  const s = settings({ mentionUserId: '123456789012345678' });
  const news = { key: 'build:1:Sub-1:x', kind: 'Ready for new parts', subject: 'Aki Sub-1', text: 'Aki: Sub-1 ready', once: true };
  const first = planAlerts({ state: { alerts: {} }, alerts: [news], settings: s, now });
  assert.strictEqual(first.messages.length, 1);
  assert.strictEqual(first.mention, false, 'news does not ping');
  const later = planAlerts({ state: first.nextState, alerts: [news], settings: s, now: now + 30 * HOUR });
  assert.deepStrictEqual(later.messages, [], 'not repeated');
  const gone = planAlerts({ state: first.nextState, alerts: [], settings: s, now: now + 31 * HOUR });
  assert.deepStrictEqual(gone.messages, [], 'no "Resolved" line when the parts go in');
  const withProblem = planAlerts({ state: { alerts: {} }, alerts: [news, { key: 'sync:A', kind: 'Plugin not syncing', subject: 'A', text: 'A: stopped' }], settings: s, now });
  assert.strictEqual(withProblem.mention, true, 'a real problem in the same message still pings');
});

test('a PC whose AutoRetainer is not running is named, instead of guessing why its account stopped', () => {
  const data = { characters, subs, retainers: [], houses: [], pcs: [
    { pc_name: 'LAPTOP', account_label: 'Account 3', autoretainer_ready: false, last_sync_at: new Date(now - 2 * HOUR).toISOString() },
    { pc_name: 'DESKTOP-1', account_label: 'Account 2', autoretainer_ready: true, last_sync_at: new Date(now - 5 * 60000).toISOString() },
    // A PC no longer used (renamed, or retired) that last said AutoRetainer was not running: not alerted.
    { pc_name: 'OLD-PC', account_label: 'Account 2', autoretainer_ready: false, last_sync_at: new Date(now - 3 * 24 * HOUR).toISOString() },
    { pc_name: 'NEVER-SYNCED', account_label: 'Account 2', autoretainer_ready: false, last_sync_at: null },
  ] };
  const alerts = buildAlerts(data, settings(), now);
  const ar = alerts.filter((a) => a.kind === 'AutoRetainer not running');
  assert.deepStrictEqual(ar.map((a) => a.text), ['LAPTOP (Account 3): AutoRetainer is not running, so nothing syncs from that PC. Start it in game (or check it is installed and enabled).']);
  assert.ok(!alerts.some((a) => a.kind === 'Plugin not syncing' && a.subject === 'Account 3'), 'no second alert for the same account');
  assert.ok(!alerts.some((a) => a.kind === 'Subs idle' && a.subject.startsWith('Sajuna')), 'its subs are not reported idle');
  assert.ok(!buildAlerts(data, settings({ syncOn: false }), now).some((a) => a.kind === 'AutoRetainer not running'), 'off with the sync alerts');
  assert.ok(!alerts.some((a) => a.subject === 'Account 2'), 'a PC not seen for 2 days does not hold back or replace its account\'s alerts');
});

test('undercut listings: one message per world, biggest gap first, said again only when they change', () => {
  const l = (over) => ({ world: 'Maduin', item_name: 'Iron Ore', hq: false, unit_price: 100, cheapest: 90, undercutBy: 10, quantity: 1, retainer_name: 'Ret', owner_name: 'Aki', retainer_id: '1', slot: 0, item_id: 5111, ...over });
  const undercut = [
    l({}),
    l({ item_name: 'Cotton', hq: true, unit_price: 5000, cheapest: 4000, undercutBy: 1000, slot: 1, item_id: 5343 }),
    l({ world: 'Golem', owner_name: 'Bex', slot: 2 }),
  ];
  const data = { characters: [], subs: [], retainers: [], houses: [], undercut };
  const alerts = buildAlerts(data, settings(), now).filter((a) => a.kind === 'Undercut');
  assert.deepStrictEqual(alerts.map((a) => a.text), [
    'Golem: 1 listing undercut. Iron Ore on Ret (Bex): yours 100, cheapest 90.',
    'Maduin: 2 listings undercut. Cotton (HQ) on Ret (Aki): yours 5,000, cheapest 4,000; Iron Ore on Ret (Aki): yours 100, cheapest 90.',
  ]);
  assert.ok(alerts.every((a) => a.once), 'news, without the @mention');
  const again = buildAlerts(data, settings(), now).filter((a) => a.kind === 'Undercut');
  assert.deepStrictEqual(again.map((a) => a.key), alerts.map((a) => a.key), 'the same listings keep the same key');
  const changed = buildAlerts({ ...data, undercut: [l({ cheapest: 80, undercutBy: 20 })] }, settings(), now).filter((a) => a.kind === 'Undercut');
  assert.notStrictEqual(changed[0].key, alerts[1].key, 'cheaper again: a new message');
  assert.strictEqual(buildAlerts(data, settings({ undercutOn: false }), now).some((a) => a.kind === 'Undercut'), false, 'can be turned off');
});

test('backups: a failed backup, none for 2 days, or a failed second copy is said; nothing when backups are off here', () => {
  const { backupAlerts } = require('../alerts/checks');
  const fmt = () => 'Sat 03:30';
  const on = { enabled: true };
  const at = (hoursAgo, extra = {}) => ({ settings: on, last: { ok: true, at: now - hoursAgo * HOUR, ...extra } });
  assert.deepStrictEqual(backupAlerts(at(10), now, fmt), [], 'a recent backup is fine');
  assert.deepStrictEqual(backupAlerts({ settings: { enabled: false }, last: { ok: false, at: now } }, now, fmt), [], 'off on this PC');
  assert.deepStrictEqual(backupAlerts({ settings: on, last: null }, now, fmt), [], 'not made yet');
  assert.deepStrictEqual(backupAlerts(null, now, fmt), []);
  const failed = backupAlerts({ settings: on, last: { ok: false, at: now - HOUR, message: 'Drive E:\\ is not available (is it plugged in?).' } }, now, fmt);
  assert.deepStrictEqual(failed.map((a) => [a.key, a.kind, a.text]),
    [['backup:failed', 'Backup', 'The database backup failed (Sat 03:30): Drive E:\\ is not available (is it plugged in?).']]);
  assert.match(backupAlerts(at(49), now, fmt)[0].text, /^No database backup for 2 days \(the last one was Sat 03:30\)/);
  assert.strictEqual(backupAlerts(at(49), now, fmt)[0].key, 'backup:stale');
  assert.deepStrictEqual(backupAlerts(at(1, { copyError: 'no access' }), now, fmt).map((a) => [a.key, a.text]),
    [['backup:copy', 'The backup was made, but its second copy failed: no access']]);
  const data = { characters: [], backup: { settings: on, last: { ok: false, at: now, message: 'x' } } };
  assert.strictEqual(buildAlerts(data, settings(), now).some((a) => a.kind === 'Backup'), true, 'on by default');
  assert.strictEqual(buildAlerts(data, settings({ backupOn: false }), now).some((a) => a.kind === 'Backup'), false, 'can be turned off');
});
