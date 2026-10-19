// The daily or weekly Discord summary: one quiet message (no @mention) beside the problem alerts, with
// the gil earned, salvage and loot collected, subs that ranked up, subs ready for new parts and supplies
// running low. When it is due, and its wording; the numbers are gathered by run.js. No Electron or pg
// here, so it can be tested on its own (tests/summary.test.js).

const DAY = 24 * 60 * 60 * 1000;
const LOW_SUPPLY_DAYS = 7;
const MAX_LISTED = 10;

// The latest moment the summary was scheduled for at or before `now` (ms, this PC's local time), or
// null when it is off. Daily: today at summaryTime (or yesterday's, before that time). Weekly: the last
// summaryDay at summaryTime.
function lastScheduled(settings, now = Date.now()) {
  const every = Number(settings.summaryEvery);
  if (every !== 1 && every !== 7) return null;
  const d = new Date(now);
  const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(settings.summaryTime / 60), settings.summaryTime % 60);
  if (every === 1) {
    if (at.getTime() > now) at.setDate(at.getDate() - 1);
    return at.getTime();
  }
  let back = (at.getDay() - settings.summaryDay + 7) % 7;
  if (back === 0 && at.getTime() > now) back = 7;
  at.setDate(at.getDate() - back);
  return at.getTime();
}

// Whether a summary is due: its scheduled moment has passed and none has been sent since. The first
// time (nothing sent yet) it waits for the next scheduled moment rather than posting straight away.
//   lastSentAt: ms of the last summary sent from this PC (null: never); firstSeenAt: when this PC first
//   saw the summary turned on (ms).
function summaryDue(settings, { lastSentAt, firstSeenAt }, now = Date.now()) {
  const moment = lastScheduled(settings, now);
  if (moment === null) return false;
  if (lastSentAt) return lastSentAt < moment;
  return firstSeenAt !== null && firstSeenAt !== undefined && firstSeenAt < moment;
}

const gil = (n) => `${Math.round(Number(n) || 0).toLocaleString('en-US')} gil`;
const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const listed = (items) => (items.length > MAX_LISTED ? [...items.slice(0, MAX_LISTED), `and ${items.length - MAX_LISTED} more`] : items);

// The message. data:
//   every: 1 or 7 (the period it covers)
//   income: the Income tab's totals over the period ({ net, perDay, share, counted (characters) }) or null
//   loot: { voyages, salvage (pieces), gil (all loot at vendor prices) } from SubmarineTracker's loot (null: not recorded)
//   ventures: { count, items } from AutoRetainer's statistics (null: not recorded)
//   rankUps: [{ who, sub, from, to }]
//   buildReady: [{ who, sub, rank }]
//   lowSupplies: [{ who, what, days }]
// " At market prices: …" for loot or ventures (live prices on, ipc/details.js loadLoot's `market`), or why not.
function marketText(market, what) {
  if (!market) return '';
  if (market.error) return ` (Live prices unavailable: ${market.error})`;
  const m = market[what];
  if (!m) return '';
  return ` At market prices: ${gil(m.world.gil)} (world), ${gil(m.dc.gil)} (data center), ${gil(m.region.gil)} (region).`;
}

// data.uses: { subs, retainers } (play-style.js): what the player does not run is left out.
function buildSummary(data) {
  const uses = data.uses || { subs: true, retainers: true };
  const period = data.every === 7 ? 'week' : 'day';
  const lines = [`**Fleet summary for the last ${period}**`];

  if (uses.subs) {
    if (data.income && data.income.counted > 0) {
      const share = typeof data.income.share === 'number' ? `, ${Math.round(data.income.share * 100)}% of expected` : '';
      lines.push(`Gil earned: ${gil(data.income.net)} (${gil(data.income.perDay)} a day${share}), from salvage less repair kits.`);
    } else {
      lines.push('Gil earned: not enough history yet.');
    }
    if (data.loot) {
      lines.push(data.loot.voyages
        ? `Loot: ${count(data.loot.voyages, 'voyage')} brought back ${data.loot.salvage.toLocaleString('en-US')} salvage; all loot worth ${gil(data.loot.gil)} at vendor prices.${marketText(data.market, 'loot')}`
        : 'Loot: no voyages recorded by Submarine Tracker.');
    }
  }
  if (uses.retainers && data.ventures) {
    const worth = typeof data.ventures.gil === 'number' ? `, worth ${gil(data.ventures.gil)} at vendor prices` : '';
    lines.push(`Ventures: ${count(data.ventures.count, 'reward')} collected${worth}.${marketText(data.market, 'ventures')}`);
  }

  if (uses.subs) {
    const ranks = data.rankUps || [];
    lines.push(ranks.length
      ? `Ranked up: ${count(ranks.length, 'sub')}: ${listed(ranks.map((r) => `${r.who} ${r.sub} ${r.from}→${r.to}`)).join(', ')}.`
      : 'Ranked up: no subs.');

    const ready = data.buildReady || [];
    if (ready.length) lines.push(`Ready for new parts: ${listed(ready.map((r) => `${r.who} ${r.sub} (rank ${r.rank})`)).join(', ')}.`);

    const low = data.lowSupplies || [];
    lines.push(low.length
      ? `Running low (under ${LOW_SUPPLY_DAYS} days): ${listed(low.map((l) => `${l.who} ${l.what} (${l.days < 1 ? 'under a day' : `${Math.floor(l.days)} days`})`)).join(', ')}.`
      : `Supplies: nothing runs out within ${LOW_SUPPLY_DAYS} days.`);
  }
  return lines.join('\n');
}

module.exports = { DAY, LOW_SUPPLY_DAYS, lastScheduled, summaryDue, buildSummary };
