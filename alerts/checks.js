// What needs an alert right now, from data already read from the database. Each alert has a `key` that
// stays the same while the problem lasts (so it is announced once, repeated now and then, and marked
// resolved when it goes away), a `kind`, a `subject` (who or what it is about) and a plain-language `text`. No Electron or pg here
// (tests/alerts.test.js).

const { notSyncedCharacters } = require('../characters/not-synced');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// A database backup made on this PC (Settings → Backups) older than this means the daily backup has stopped.
const BACKUP_STALE_MS = 2 * DAY;

// Problems with the daily database backup made on this PC (backups.json: { settings, last }); nothing when
// backups are not turned on here. The key stays the same while each problem lasts.
function backupAlerts(backup, now, formatTime) {
  if (!backup || !backup.settings || !backup.settings.enabled) return [];
  const last = backup.last;
  if (!last || !last.at) return [];
  const subject = 'database backups';
  if (!last.ok) {
    return [{ key: 'backup:failed', kind: 'Backup', subject, text: `The database backup failed (${formatTime(last.at)}): ${last.message}` }];
  }
  if (now - last.at > BACKUP_STALE_MS) {
    return [{ key: 'backup:stale', kind: 'Backup', subject, text: `No database backup for ${formatDuration(now - last.at)} (the last one was ${formatTime(last.at)}). Check Settings → Backups on this PC.` }];
  }
  if (last.copyError) {
    return [{ key: 'backup:copy', kind: 'Backup', subject, text: `The backup was made, but its second copy failed: ${last.copyError}` }];
  }
  return [];
}

// A PC that has not synced for this long counts as no longer used (retired or renamed, see the PCs tab's
// Remove): its "AutoRetainer not running" alert stops, and its account's "not syncing" alert (if no other PC
// syncs it) says what is wrong instead.
const PC_GONE_AFTER_MS = 2 * DAY;

// "2 h 15 min", "45 min", "3 days".
function formatDuration(ms) {
  const minutes = Math.max(0, Math.floor(ms / MINUTE));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
  return `${Math.floor(hours / 24)} days`;
}

function who(row) {
  return row.world ? `${row.name} (${row.world})` : row.name;
}

// Accounts whose newest plugin data is older than the setting. `characters` are
// { account_label, last_synced_at } rows; an account's newest character counts.
function staleAccounts(characters, settings, now) {
  const newest = new Map();
  for (const c of characters) {
    const at = c.last_synced_at ? new Date(c.last_synced_at).getTime() : NaN;
    if (!Number.isFinite(at)) continue;
    const label = c.account_label || 'Ungrouped';
    if (!newest.has(label) || at > newest.get(label)) newest.set(label, at);
  }
  const stale = [];
  for (const [label, at] of newest) {
    if (now - at >= settings.syncStaleMinutes * MINUTE) stale.push({ label, at });
  }
  return stale.sort((a, b) => a.label.localeCompare(b.label));
}

// data: {
//   dbError: plain message when the database could not be read (then nothing else is checked),
//   characters: [{ cid, name, world, account_label, last_synced_at, ceruleum, repair_kits, subs_built }],
//   subs: [{ cid, sub_name, level, return_time (Unix seconds) }],
//   retainers: [{ owner_cid, name, job, has_venture }],
//   thresholds: { repairKitThreshold, ceruleumThreshold },
//   houses: Free Company rows from fc-directory.js (has_house, house_level, house_days, ...),
//   buildNeeds: the Parts tab's rows (ipc/parts.js): one per part a sub should change at its rank
//     ({ cid, sub_name, rank, slot, needed_class, needed_modified, spare_location }),
//   backup: this PC's backup settings and last result (backups/settings.js), or null,
//   formatTime: (ms) => local time text,
// }
// The Parts tab's rows grouped per built sub (rank above 0; an unbuilt slot is not "ready"), with each
// part (Whale, Modified Shark, ...) and where a spare is held (null: to craft).
function readyForParts(buildNeeds) {
  const subs = new Map();
  for (const need of buildNeeds) {
    if (!(Number(need.rank) > 0)) continue;
    const key = `${need.cid}|${need.sub_name}`;
    if (!subs.has(key)) subs.set(key, { cid: String(need.cid), sub_name: need.sub_name, rank: Number(need.rank), parts: [] });
    subs.get(key).parts.push({ slot: need.slot, part: `${need.needed_modified ? 'Modified ' : ''}${need.needed_class}`, spare: need.spare_location || null });
  }
  return [...subs.values()];
}

// A short fingerprint of a list of strings, so an alert's key changes when what it is about changes.
function fingerprint(parts) {
  let h = 5381;
  for (const c of parts.join('|')) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0;
  return h.toString(36);
}

const gilText = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');

// Listings someone else sells cheaper on the same world (live prices; run.js checks every 30 minutes), one
// message per world. News, said once without the @mention, and again when the undercut listings change.
function undercutAlerts(undercut) {
  const byWorld = new Map();
  for (const l of undercut || []) {
    const world = l.world || 'Unknown world';
    if (!byWorld.has(world)) byWorld.set(world, []);
    byWorld.get(world).push(l);
  }
  const alerts = [];
  for (const [world, list] of [...byWorld.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    list.sort((a, b) => b.undercutBy * b.quantity - a.undercutBy * a.quantity);
    const shown = list.slice(0, 3).map((l) => `${l.item_name}${l.hq ? ' (HQ)' : ''} on ${l.retainer_name || 'a retainer'}${l.owner_name ? ` (${l.owner_name})` : ''}: yours ${gilText(l.unit_price)}, cheapest ${gilText(l.cheapest)}`);
    const more = list.length > 3 ? `, and ${list.length - 3} more` : '';
    alerts.push({
      key: `undercut:${world}:${fingerprint(list.map((l) => `${l.retainer_id}:${l.slot}:${l.item_id}:${l.unit_price}:${l.cheapest}`).sort())}`,
      kind: 'Undercut',
      subject: world,
      text: `${world}: ${list.length} listing${list.length === 1 ? '' : 's'} undercut. ${shown.join('; ')}${more}.`,
      once: true,
    });
  }
  return alerts;
}

function buildAlerts(data, settings, now = Date.now()) {
  const formatTime = data.formatTime || ((ms) => new Date(ms).toLocaleString());
  if (data.dbError) {
    return [{ key: 'database', kind: 'Database', subject: 'the fleet database', text: `Can't read the fleet database: ${data.dbError}` }];
  }
  const alerts = [];
  const characters = data.characters || [];

  // A PC whose AutoRetainer is not running (plugin 0.11.0, on the PCs tab): nothing syncs from it. Said
  // instead of the general "not syncing" alert for its account, which would only guess at why. Only for PCs
  // that synced in the last 2 days (PC_GONE_AFTER_MS).
  const pcRecent = (p) => p.last_sync_at && now - new Date(p.last_sync_at).getTime() < PC_GONE_AFTER_MS;
  const arDown = settings.syncOn ? (data.pcs || []).filter((p) => p.autoretainer_ready === false && pcRecent(p)) : [];
  const arDownLabels = new Set(arDown.map((p) => p.account_label || 'Ungrouped'));
  for (const p of arDown) {
    const where = `${p.pc_name}${p.account_label ? ` (${p.account_label})` : ''}`;
    alerts.push({
      key: `autoretainer:${p.pc_name}|${p.account_label || ''}`,
      kind: 'AutoRetainer not running',
      subject: where,
      text: `${where}: AutoRetainer is not running, so nothing syncs from that PC. Start it in game (or check it is installed and enabled).`,
    });
  }

  const stale = settings.syncOn ? staleAccounts(characters, settings, now) : [];
  for (const s of stale.filter((x) => !arDownLabels.has(x.label))) {
    alerts.push({
      key: `sync:${s.label}`,
      kind: 'Plugin not syncing',
      subject: s.label,
      text: `${s.label}: no new plugin data for ${formatDuration(now - s.at)} (last at ${formatTime(s.at)}). Is the game or AutoRetainer stopped?`,
    });
  }
  // A stopped plugin makes every sub on that account look idle; the sync alert already covers it.
  const staleLabels = new Set([...stale.map((s) => s.label), ...arDownLabels]);
  const byCid = new Map(characters.map((c) => [String(c.cid), c]));

  // A character the plugin no longer syncs (unticked, not removed) keeps its last data, so its subs
  // would look idle and its supplies low forever: it is left out of the other checks and named once.
  const notSynced = notSyncedCharacters(characters, settings.syncStaleMinutes);
  const skip = (character) => !character || staleLabels.has(character.account_label || 'Ungrouped') || notSynced.has(String(character.cid));
  if (settings.syncOn && notSynced.size) {
    const names = characters.filter((c) => notSynced.has(String(c.cid))).map((c) => `${who(c)} for ${formatDuration(notSynced.get(String(c.cid)))}`);
    alerts.push({
      key: 'not-synced',
      kind: 'Not synced',
      subject: 'characters no longer synced',
      text: `not synced while the rest of their account is: ${names.join(', ')}. Untick them in the plugin and remove them on the Roster, or tick them again.`,
    });
  }

  if (settings.subsOn) {
    // A sub whose return time has passed has been in port since then. A built sub with no return time
    // (0) is not on a voyage, but since when is unknown: its alert waits until it has been seen idle
    // for the whole setting (`waitMs`, see plan.js).
    const idleMs = settings.subIdleHours * HOUR;
    const idle = new Map();
    for (const sub of data.subs || []) {
      const character = byCid.get(String(sub.cid));
      if (skip(character)) continue;
      if (!(Number(sub.level) > 0)) continue;
      const back = Number(sub.return_time) * 1000;
      const entry = idle.get(String(sub.cid)) || { character, back: 0, notSent: 0, oldest: Infinity };
      if (!back) entry.notSent++;
      else if (now - back >= idleMs) { entry.back++; entry.oldest = Math.min(entry.oldest, back); }
      else continue;
      idle.set(String(sub.cid), entry);
    }
    const subs = (n) => `${n} sub${n === 1 ? '' : 's'}`;
    for (const [cid, e] of idle) {
      const parts = [];
      if (e.back) parts.push(`${subs(e.back)} back in port for ${formatDuration(now - e.oldest)}`);
      if (e.notSent) parts.push(`${subs(e.notSent)} not on a voyage`);
      alerts.push({
        key: `subs:${cid}`,
        kind: 'Subs idle',
        subject: who(e.character),
        text: `${who(e.character)}: ${parts.join(', ')}`,
        ...(e.back ? {} : { waitMs: idleMs }),
      });
    }
  }

  if (settings.retainersOn) {
    // A retainer with a class but no venture assigned. (A finished venture waiting to be collected still
    // counts as assigned, so it is not reported.) AutoRetainer briefly leaves a retainer without one while
    // it collects and resends, and when that started is unknown, so the alert waits until the retainer
    // has been seen without a venture for the whole setting (`waitMs`, see plan.js).
    const idle = new Map();
    for (const r of data.retainers || []) {
      const character = byCid.get(String(r.owner_cid));
      if (skip(character)) continue;
      if (r.has_venture || !(Number(r.job) > 0)) continue;
      const names = idle.get(String(r.owner_cid)) || [];
      names.push(r.name);
      idle.set(String(r.owner_cid), names);
    }
    for (const [cid, names] of idle) {
      const character = byCid.get(cid);
      alerts.push({
        key: `retainers:${cid}`,
        kind: 'Retainers',
        subject: who(character),
        text: `${who(character)}: ${names.length} retainer${names.length === 1 ? '' : 's'} without a venture (${names.sort().join(', ')})`,
        waitMs: settings.retainerIdleMinutes * MINUTE,
      });
    }
  }

  if (settings.suppliesOn) {
    const { repairKitThreshold = 0, ceruleumThreshold = 0 } = data.thresholds || {};
    for (const c of characters) {
      if (notSynced.has(String(c.cid))) continue;
      if (!(Number(c.subs_built) > 0)) continue; // a character with no subs built yet needs no supplies
      const parts = [];
      if (Number(c.ceruleum) < ceruleumThreshold) parts.push(`ceruleum ${c.ceruleum} (below ${ceruleumThreshold})`);
      if (Number(c.repair_kits) < repairKitThreshold) parts.push(`repair kits ${c.repair_kits} (below ${repairKitThreshold})`);
      if (parts.length) alerts.push({ key: `supplies:${c.cid}`, kind: 'Low supplies', subject: who(c), text: `${who(c)}: ${parts.join(', ')}` });
    }
  }

  if (settings.buildOn) {
    // A sub whose rank now calls for a different build (Sub Rules, or Fight Club's for Craft? subs): the
    // same parts the Parts tab lists. A sub that still needs a part crafted says so. News, not a problem:
    // said once without the @mention (plan.js). The key includes the parts, so a new build is said again.
    for (const sub of readyForParts(data.buildNeeds || [])) {
      const character = byCid.get(String(sub.cid));
      if (skip(character)) continue;
      const parts = sub.parts.map((p) => `${p.slot} ${p.part}${p.spare ? ` (spare in ${p.spare})` : ' (to craft)'}`);
      alerts.push({
        key: `build:${sub.cid}:${sub.sub_name}:${sub.parts.map((p) => `${p.slot}${p.part}`).join(',')}`,
        kind: 'Ready for new parts',
        subject: `${who(character)} ${sub.sub_name}`,
        text: `${who(character)}: ${sub.sub_name} (rank ${sub.rank}) is ready for new parts: ${parts.join(', ')}`,
        once: true,
      });
    }
  }

  if (settings.undercutOn) alerts.push(...undercutAlerts(data.undercut));

  if (settings.backupOn) alerts.push(...backupAlerts(data.backup, now, formatTime));

  if (settings.houseOn) {
    for (const h of data.houses || []) {
      if (!h.has_house || !h.house_level || h.house_level === 'ok') continue;
      const where = `${h.fc_name || 'Free Company'}${h.fc_world ? ` (${h.fc_world})` : ''}, ${h.district_name || `City ${h.house_city}`} W${h.house_ward} P${h.house_plot}`;
      const text = h.house_days === null || h.house_days === undefined
        ? `${where}: FC Tracker has no date for when it was last entered. Check it in game.`
        : `${where}: not entered for ${h.house_days} days, demolition possible ${h.demolition_in_days > 0 ? `in about ${h.demolition_in_days} days` : 'any time now'}`;
      alerts.push({ key: `house:${h.fc_id}`, kind: 'FC house', subject: where, text });
    }
  }

  return alerts;
}

module.exports = { buildAlerts, formatDuration, staleAccounts, readyForParts, undercutAlerts, backupAlerts, PC_GONE_AFTER_MS, BACKUP_STALE_MS };
