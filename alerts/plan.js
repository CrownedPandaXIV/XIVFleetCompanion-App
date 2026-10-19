// What to post to Discord this time, from what was already sent (the saved state) and the alerts found
// now: new problems, problems still going after the repeat time, and problems that went away. A pause
// (or quiet hours set to hold) holds everything back; quiet time can post without the @mention; and at
// most one message goes out every few minutes, so a burst of problems arrives together. No Electron or
// pg here (tests/alerts.test.js).
const { formatDuration } = require('./checks');

const HOUR = 60 * 60 * 1000;
// Discord's limit is 2000 characters per message; stay under it.
const MESSAGE_LIMIT = 1900;

// state: { alerts: { [key]: { kind, subject, text, firstSeen, lastSent, once } }, lastPostAt }
// An alert marked `once` (news, not a problem: a sub ready for new parts) is posted once, without the
// @mention, never repeated, and goes without a "Resolved" line.
// (lastSent null = not posted yet: waiting, held, or found since the last message).
// mode: 'normal', 'silent' (post without the @mention) or 'hold' (post nothing), from alertMode().
// keepMissing: the check could not look at everything (the database could not be read), so alerts
// missing from `alerts` are kept as they were instead of being marked resolved.
// Returns { messages: [text, ...] (empty when nothing to post), mention, heldUntil (ms, when the
// "at most one message every N minutes" gap is what held them back), nextState } — nextState is only
// to be saved once every message was posted.
function planAlerts({ state, alerts, settings, mode = 'normal', keepMissing = false, now = Date.now() }) {
  const previous = (state && state.alerts) || {};
  const lastPostAt = (state && state.lastPostAt) || 0;
  const current = new Map(alerts.map((a) => [a.key, a]));
  const next = {};
  const fresh = [];
  const still = [];
  const resolved = [];

  for (const [key, alert] of current) {
    const before = previous[key];
    const entry = { kind: alert.kind, subject: alert.subject, text: alert.text, firstSeen: before ? before.firstSeen : now, lastSent: before ? before.lastSent : null };
    if (alert.once) entry.once = true;
    next[key] = entry;
    // `waitMs`: only worth saying once it has lasted that long (a sub idle since an unknown time).
    if (!entry.lastSent && alert.waitMs && now - entry.firstSeen < alert.waitMs) continue;
    if (!entry.lastSent) fresh.push(entry);
    else if (!entry.once && now - entry.lastSent >= settings.repeatHours * HOUR) still.push(entry);
  }
  for (const [key, before] of Object.entries(previous)) {
    if (current.has(key)) continue;
    if (keepMissing) next[key] = before;
    else if (before.lastSent && !before.once) resolved.push({ ...before, key });
    // Never posted (it came and went while held or between messages): nothing to say.
  }

  const nothing = (extra = {}) => ({ messages: [], mention: false, heldUntil: null, ...extra, nextState: { alerts: next, lastPostAt } });
  if (!fresh.length && !still.length && !resolved.length) return nothing();

  // Held: paused or quiet hours set to hold, or a message went out less than the gap ago. Everything is
  // kept (including what was posted and has since cleared, so its "Resolved" line goes out later) and
  // goes out together in the next message.
  const gapMs = (settings.minGapMinutes || 0) * 60 * 1000;
  const gapEnds = lastPostAt && gapMs ? lastPostAt + gapMs : 0;
  if (mode === 'hold' || now < gapEnds) {
    for (const r of resolved) next[r.key] = previous[r.key];
    return nothing({ heldUntil: mode === 'hold' ? null : gapEnds });
  }

  for (const entry of [...fresh, ...still]) entry.lastSent = now;
  const mention = !!settings.mentionUserId && mode === 'normal' && (fresh.filter((e) => !e.once).length + still.length) > 0;

  // Each line remembers which alert it is about, so a message that fails to post can be retried (see
  // stateAfterPosting).
  const lines = [];
  const keyOf = new Map([...Object.entries(next)].map(([key, entry]) => [entry, key]));
  const section = (title, entries, line) => {
    if (!entries.length) return;
    lines.push({ text: `**${title}**` });
    for (const e of entries) lines.push({ text: line(e), key: e.key || keyOf.get(e) });
  };
  section('New', fresh, (e) => `• ${e.kind}: ${e.text}`);
  section('Still going', still, (e) => `• ${e.kind}: ${e.text} (for ${formatDuration(now - e.firstSeen)})`);
  section('Resolved', resolved, (e) => `• ${e.kind}: ${e.subject || e.text}`);

  const header = `${mention ? `<@${settings.mentionUserId}> ` : ''}**Fleet alerts**`;
  const { messages, keys } = splitTagged(header, lines);
  return { messages, messageKeys: keys, mention, heldUntil: null, nextState: { alerts: next, lastPostAt: now } };
}

// What to remember when only the first `posted` messages went out (Discord refused the next one): the
// alerts in those are sent; the rest are kept as they were before, so they go out next time and what
// did go out is not repeated.
function stateAfterPosting(plan, previousState, posted) {
  if (posted >= plan.messages.length) return plan.nextState;
  const previous = (previousState && previousState.alerts) || {};
  const alerts = { ...plan.nextState.alerts };
  for (const keys of plan.messageKeys.slice(posted)) {
    for (const key of keys) {
      if (alerts[key]) alerts[key] = { ...alerts[key], lastSent: previous[key] ? previous[key].lastSent : null };
      else if (previous[key]) alerts[key] = previous[key]; // a "Resolved" line not posted yet
    }
  }
  return { alerts, lastPostAt: posted > 0 ? plan.nextState.lastPostAt : (previousState && previousState.lastPostAt) || 0 };
}

// Joins lines ({ text, key }) into messages under Discord's limit; the header (with the @mention) goes
// on the first. Returns the messages and, for each, the alert keys it carries.
function splitTagged(header, lines) {
  const messages = [];
  const keys = [];
  let current = header;
  let currentKeys = [];
  for (const { text: raw, key } of lines) {
    const line = raw.length > MESSAGE_LIMIT - 20 ? raw.slice(0, MESSAGE_LIMIT - 21) + '…' : raw;
    if (current.length + 1 + line.length > MESSAGE_LIMIT) {
      messages.push(current);
      keys.push(currentKeys);
      current = '**Fleet alerts (continued)**';
      currentKeys = [];
    }
    current += '\n' + line;
    if (key) currentKeys.push(key);
  }
  messages.push(current);
  keys.push(currentKeys);
  return { messages, keys };
}

function splitMessages(header, lines) {
  return splitTagged(header, lines.map((text) => ({ text }))).messages;
}

module.exports = { planAlerts, stateAfterPosting, splitMessages, MESSAGE_LIMIT };
