// One alert check: read the fleet database, work out what needs saying (checks.js, plan.js) and post it
// to Discord. Run every 5 minutes on the PC that holds the webhook by a Windows scheduled task that
// starts the app with --fleet-alerts (no window opens; see main.js and schedule.js), or from
// Settings → Discord alerts → "Check now". What was already posted is remembered in alerts-state.json
// in the app's data folder on this PC; a log of each check is kept in alerts.log next to it.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { createPgClient, loadPostgresConfig, snapshotFragments, followMoveNow } = require('../db');
const { describeError } = require('../db/connection-status');
const { loadFcDirectory } = require('../characters/fc-directory');
const { computePartsNeeded } = require('../ipc/parts');
const { ALERT_SETTING_KEYS, LAST_CHECK_KEY, readAlertSettings, alertMode } = require('./settings');
const { buildAlerts, readyForParts } = require('./checks');
const { planAlerts, stateAfterPosting } = require('./plan');
const { loadWebhook, postMessage } = require('./discord');
const { summaryDue, buildSummary, LOW_SUPPLY_DAYS, DAY } = require('./summary');
const { loadIncome } = require('../ipc/income');
const { loadSupplies } = require('../ipc/supplies');
const { loadPlayStyle } = require('../ipc/play-style');
const { playStyleUses, alertSettingsFor } = require('../shared/play-style');
const { loadLoot, loadMarket } = require('../ipc/details');
const { universalisEnabled } = require('../ipc/universalis');
const { createUniversalis } = require('../characters/universalis');
const { loadBackupSettings } = require('../backups/settings');

const UNDERCUT_EVERY_MS = 30 * 60 * 1000;

// Listings someone else sells cheaper on the same world, from Universalis (live prices on), asked for at most
// every 30 minutes; in between, the last answer (kept in the state file as `cache`). Returns { list, cache }.
async function undercutListings(client, cache, now) {
  if (cache && now - cache.at < UNDERCUT_EVERY_MS) return { list: cache.list, cache };
  try {
    const market = (await loadMarket(client, { universalis: createUniversalis() })).market;
    const live = market && market.live;
    if (!live || live.error) {
      if (live && live.error) log(`Undercut check: ${live.error}`);
      return { list: cache ? cache.list : [], cache };
    }
    const list = live.undercut.map((l) => ({
      world: l.world, item_name: l.item_name, hq: !!l.hq, unit_price: Number(l.unit_price), cheapest: l.others.world.price,
      undercutBy: l.undercutBy, quantity: Number(l.quantity), retainer_name: l.retainer_name, owner_name: l.owner_name,
      retainer_id: l.retainer_id, slot: l.slot, item_id: l.item_id,
    }));
    return { list, cache: { at: now, list } };
  } catch (err) {
    log(`Undercut check failed: ${err.message}`);
    return { list: cache ? cache.list : [], cache };
  }
}

const STATE_FILE = () => path.join(app.getPath('userData'), 'alerts-state.json');
const LOG_FILE = () => path.join(app.getPath('userData'), 'alerts.log');
const LOG_KEEP_LINES = 1000;

function log(line) {
  const text = `${new Date().toISOString()} ${line}`;
  console.log(`[alerts] ${line}`);
  try {
    const file = LOG_FILE();
    const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
    fs.writeFileSync(file, [...old.slice(-(LOG_KEEP_LINES - 1)), text].join('\n') + '\n');
  } catch { /* the log is a convenience */ }
}

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE(), 'utf8')); } catch { return { alerts: {} }; }
}

function writeState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE()), { recursive: true });
  fs.writeFileSync(STATE_FILE(), JSON.stringify(state, null, 1));
}

async function readSettingsRows(client) {
  const keys = [...Object.values(ALERT_SETTING_KEYS), LAST_CHECK_KEY, 'low_repair_kit_threshold', 'low_ceruleum_threshold'];
  const result = await client.query('SELECT setting_key, setting_value FROM fleet_economics_settings WHERE setting_key = ANY($1)', [keys]);
  return result.rows;
}

// Everything the checks look at, from one connection, in a fixed order (by character name) so messages
// list things the same way every time.
async function readFleet(client) {
  const { latestCharacter } = await snapshotFragments(client);
  const characters = (await client.query(`
    SELECT c.cid, c.name, c.world, c.account_label, c.snapshot_at AS last_synced_at, c.ceruleum, c.repair_kits,
           (SELECT COUNT(*) FROM companion_submarine_snapshot s WHERE s.cid = c.cid AND s.level > 0) AS subs_built
    FROM ${latestCharacter} c
    ORDER BY c.name, c.cid`)).rows;
  const subs = (await client.query('SELECT cid, sub_name, level, return_time FROM companion_submarine_snapshot ORDER BY cid, sub_name')).rows;
  const retainers = (await client.query('SELECT owner_cid, name, job, has_venture FROM companion_retainer_lookup ORDER BY owner_cid, name')).rows;
  const { rows: houses } = await loadFcDirectory(client);
  const buildNeeds = await computePartsNeeded(client);
  // Each PC's status (database version 8): which PCs' AutoRetainer is not running.
  const pcs = await optionalQuery(client, 'SELECT pc_name, account_label, autoretainer_ready, last_sync_at FROM companion_pc_status ORDER BY pc_name, account_label') || [];
  return { characters, subs, retainers, houses, buildNeeds, pcs };
}

const formatTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// A query on a table from database version 8; null when the database doesn't have it yet.
async function optionalQuery(client, sql, params) {
  try {
    return (await client.query(sql, params)).rows;
  } catch (err) {
    if (err.code === '42P01') return null;
    throw err;
  }
}

// The numbers for the Discord summary over the last `every` days (summary.js words them).
// `style`: what the player runs (play-style.js); the summary leaves out what is not run.
async function gatherSummary(client, every, buildNeeds, style = 'both') {
  // Loot and venture rewards (database version 8) at vendor prices, and at market prices when live prices are on:
  // the Income tab's figures. Left out until the database has version 8.
  let loot = null;
  let ventures = null;
  let market = null;
  try {
    const live = await universalisEnabled(client);
    const lootData = await loadLoot(client, { universalis: live ? createUniversalis() : null, windowDays: every });
    loot = { voyages: lootData.totals.voyages, salvage: lootData.totals.salvage, gil: lootData.totals.gil };
    ventures = { count: lootData.ventureTotals.rewards, gil: lootData.ventureTotals.gil };
    market = lootData.market;
  } catch (err) {
    if (err.code !== '42P01') log(`Summary: loot and venture rewards not read: ${err.message}`);
  }
  const since = new Date(Date.now() - every * DAY);
  const who = (r) => (r.world ? `${r.name} (${r.world})` : r.name);

  // Income over the period, with an hour to spare so the last sync still makes a whole day.
  const income = await loadIncome(client, every + 1 / 24);
  const counted = income.rows.filter((r) => r.enough);

  const ranks = (await client.query(`
    SELECT c.name, c.world, h.metric, max(h.value) AS now_rank,
           (array_agg(h.label ORDER BY h.recorded_at DESC))[1] AS sub_name,
           (SELECT b.value FROM companion_metric_history b
            WHERE b.subject_type = 'character' AND b.subject_id = h.subject_id AND b.metric = h.metric AND b.recorded_at <= $1
            ORDER BY b.recorded_at DESC LIMIT 1) AS before_rank
    FROM companion_metric_history h
    JOIN companion_character_current c ON c.cid = h.subject_id
    WHERE h.subject_type = 'character' AND h.metric LIKE 'sub_rank:%' AND h.recorded_at > $1
    GROUP BY c.name, c.world, h.subject_id, h.metric
    ORDER BY c.name, h.metric`, [since])).rows
    .filter((r) => r.before_rank !== null && Number(r.now_rank) > Number(r.before_rank))
    .map((r) => ({ who: who(r), sub: r.sub_name || `Sub ${r.metric.split(':')[1]}`, from: Number(r.before_rank), to: Number(r.now_rank) }));

  const supplies = await loadSupplies(client);
  const lowSupplies = [];
  for (const r of supplies.rows) {
    for (const [what, s] of [['ceruleum', r.ceruleum], ['repair kits', r.repair_kits]]) {
      if (typeof s.days === 'number' && s.days < LOW_SUPPLY_DAYS) lowSupplies.push({ who: who(r), what, days: s.days });
    }
  }
  lowSupplies.sort((a, b) => a.days - b.days);

  const names = new Map(supplies.rows.map((r) => [String(r.cid), r]));
  const buildReady = readyForParts(buildNeeds || []).map((sub) => {
    const c = names.get(String(sub.cid));
    return { who: c ? who(c) : sub.cid, sub: sub.sub_name, rank: sub.rank };
  });

  return buildSummary({
    every,
    uses: playStyleUses(style),
    income: { net: income.totals.net, perDay: income.totals.perDay, share: income.totals.share, counted: counted.length },
    loot,
    ventures,
    market,
    rankUps: ranks,
    buildReady,
    lowSupplies,
  });
}

// Posts the summary now (Settings → "Send summary now"), whatever the schedule.
async function sendSummaryNow() {
  const webhook = loadWebhook();
  if (!webhook) return { ok: false, error: 'No Discord webhook is saved on this PC.' };
  let client = null;
  try {
    client = createPgClient(loadPostgresConfig());
    await client.connect();
    const settings = readAlertSettings(await readSettingsRows(client));
    const { style } = await loadPlayStyle(client);
    const text = await gatherSummary(client, settings.summaryEvery === 7 ? 7 : 1, await computePartsNeeded(client), style);
    await postMessage(webhook, text, null);
    log('Summary posted (sent from Settings).');
    return { ok: true };
  } catch (err) {
    log(`Summary FAILED: ${err.message}`);
    return { ok: false, error: err.message };
  } finally {
    if (client) await client.end().catch(() => {});
  }
}

// Runs one check. Returns { ok, posted (messages sent), alerts (how many problems), quiet, error }.
async function runAlertCheck() {
  const webhook = loadWebhook();
  if (!webhook) {
    log('No Discord webhook is saved on this PC; nothing to do.');
    return { ok: false, error: 'No Discord webhook is saved on this PC.' };
  }

  let client = null;
  let config = null;
  let rows = [];
  let data;
  try {
    // If the database moved to another PC, check the new one.
    await followMoveNow();
    config = loadPostgresConfig();
    client = createPgClient(config);
    await client.connect();
    rows = await readSettingsRows(client);
    const settings = readAlertSettings(rows);
    if (!settings.enabled) {
      await writeHeartbeat(client);
      await client.end().catch(() => {});
      log('Alerts are turned off in Settings.');
      return { ok: true, posted: 0, alerts: 0, off: true };
    }
    const byKey = Object.fromEntries(rows.map((r) => [r.setting_key, Number(r.setting_value)]));
    data = {
      ...(await readFleet(client)),
      playStyle: (await loadPlayStyle(client)).style,
      thresholds: { repairKitThreshold: byKey.low_repair_kit_threshold || 0, ceruleumThreshold: byKey.low_ceruleum_threshold || 0 },
    };
  } catch (err) {
    data = { dbError: describeError(err, config) };
  }

  // With no database, the last settings this PC saw are used (kept in the state file).
  const previous = readState();
  // Alerts for what the player does not run (subs or retainers) are left out; without the database, the
  // last known choice is used.
  const playStyle = data.playStyle || previous.playStyle || 'both';
  const savedSettings = rows.length ? readAlertSettings(rows) : { ...readAlertSettings([]), ...(previous.settings || {}) };
  const settings = alertSettingsFor(savedSettings, playStyle);
  const now = Date.now();
  const { mode, reason } = alertMode(settings, now);
  // Undercut listings (live prices on): asked for at most every 30 minutes.
  let undercutCache = previous.undercut || null;
  if (client && !data.dbError && settings.undercutOn && await universalisEnabled(client).catch(() => false)) {
    const found = await undercutListings(client, undercutCache, now);
    data.undercut = found.list;
    undercutCache = found.cache;
  }
  // This PC's own backups (Settings → Backups): the alert PC is normally the database PC that makes them.
  const backup = loadBackupSettings(path.join(app.getPath('userData'), 'backups.json'));
  const alerts = buildAlerts({ ...data, backup, formatTime }, settings, now);
  const plan = planAlerts({ state: previous, alerts, settings, mode, keepMissing: !!data.dbError, now });

  let posted = 0;
  let error = null;
  for (const message of plan.messages) {
    try {
      await postMessage(webhook, message, plan.mention && posted === 0 ? settings.mentionUserId : null);
      posted++;
    } catch (err) {
      error = err.message;
      break;
    }
  }
  // Remember what went out: everything, or (when Discord refused a later message) only the alerts in the
  // messages that were posted, so the rest is retried next time and nothing is posted twice.
  if (!error || posted > 0) {
    writeState({ ...stateAfterPosting(plan, previous, posted), settings: { ...savedSettings, lastCheckAt: undefined }, playStyle, summary: previous.summary, undercut: undercutCache });
  }
  // The daily or weekly summary, once its time has come (not while alerts are held).
  let summaryNote = '';
  if (client && !data.dbError && mode !== 'hold') {
    const state = readState();
    const summary = state.summary || {};
    if (settings.summaryEvery && !summary.firstSeenAt) {
      writeState({ ...state, summary: { ...summary, firstSeenAt: now } });
    } else if (summaryDue(settings, summary, now)) {
      try {
        await postMessage(webhook, await gatherSummary(client, settings.summaryEvery, data.buildNeeds, playStyle), null);
        writeState({ ...readState(), summary: { ...summary, lastSentAt: now } });
        summaryNote = ' Summary posted.';
      } catch (err) {
        summaryNote = ` Summary failed: ${err.message}`;
      }
    }
  }
  if (client) {
    if (!data.dbError) await writeHeartbeat(client).catch(() => {});
    await client.end().catch(() => {});
  }
  // A short plain note for Settings ("Check Now") and the log.
  let note;
  if (error) note = `Posting failed: ${error}`;
  else if (posted) note = `Posted ${posted} message${posted === 1 ? '' : 's'}${mode === 'silent' ? ' without the @mention' : ''}.`;
  else if (plan.heldUntil) note = `Held until ${formatTime(plan.heldUntil)} (at most one message every ${settings.minGapMinutes} minutes).`;
  else if (mode === 'hold') note = `Held: ${reason}.`;
  else note = 'Nothing new to post.';
  note += summaryNote;
  log(`${alerts.length} problem(s) found${reason ? `, ${reason}` : ''}; ${note}`);
  return { ok: !error, posted, alerts: alerts.length, mode, note, error };
}

// So Settings can show when the last check ran (on any PC).
async function writeHeartbeat(client) {
  await client.query(
    `INSERT INTO fleet_economics_settings (setting_key, setting_value, updated_at)
     VALUES ($1, floor(extract(epoch FROM now())), now())
     ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now()`,
    [LAST_CHECK_KEY]);
}

// A message to check the webhook and the @mention work.
async function sendTestMessage(mentionUserId) {
  const webhook = loadWebhook();
  if (!webhook) return { ok: false, error: 'No Discord webhook is saved on this PC.' };
  try {
    const mention = mentionUserId ? `<@${mentionUserId}> ` : '';
    await postMessage(webhook, `${mention}**Fleet alerts**\nTest message from Fleet Companion: alerts will appear here.`, mentionUserId || null);
    log('Test message posted.');
    return { ok: true };
  } catch (err) {
    log(`Test message FAILED: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

// `--fleet-alerts`: run one check and quit (no window).
async function runFromCommandLine() {
  let code = 0;
  try {
    const result = await runAlertCheck();
    if (!result.ok && result.error && !/No Discord webhook/.test(result.error)) code = 1;
  } catch (err) {
    log(`FAILED: ${err.stack || err.message}`);
    code = 1;
  }
  app.exit(code);
}

module.exports = { runAlertCheck, sendTestMessage, sendSummaryNow, runFromCommandLine };
