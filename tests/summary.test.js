const test = require('node:test');
const assert = require('node:assert');
const { lastScheduled, summaryDue, buildSummary } = require('../alerts/summary');
const { ALERT_DEFAULTS } = require('../alerts/settings');

const at = (d, h, m = 0) => new Date(2026, 9, d, h, m).getTime(); // October 2026; the 5th is a Monday
const daily = { ...ALERT_DEFAULTS, summaryEvery: 1, summaryTime: 9 * 60 };
const weekly = { ...ALERT_DEFAULTS, summaryEvery: 7, summaryTime: 9 * 60, summaryDay: 1 };

test('the last scheduled moment: today at the time, or yesterday before it; weekly on the chosen day', () => {
  assert.strictEqual(lastScheduled(daily, at(7, 10)), at(7, 9));
  assert.strictEqual(lastScheduled(daily, at(7, 8)), at(6, 9));
  assert.strictEqual(lastScheduled(weekly, at(7, 10)), at(5, 9), 'Wednesday: the Monday before');
  assert.strictEqual(lastScheduled(weekly, at(5, 8)), at(5 - 7, 9), 'Monday before 9: the Monday a week earlier');
  assert.strictEqual(lastScheduled({ ...daily, summaryEvery: 0 }, at(7, 10)), null, 'off');
});

test('due once per scheduled moment, and not straight away when first turned on', () => {
  assert.strictEqual(summaryDue(daily, { lastSentAt: at(6, 9, 5) }, at(7, 9, 1)), true);
  assert.strictEqual(summaryDue(daily, { lastSentAt: at(7, 9, 1) }, at(7, 9, 6)), false, 'already sent today');
  assert.strictEqual(summaryDue(daily, { firstSeenAt: at(7, 12) }, at(7, 13)), false, 'turned on at noon: waits for tomorrow 9:00');
  assert.strictEqual(summaryDue(daily, { firstSeenAt: at(7, 12) }, at(8, 9)), true);
  assert.strictEqual(summaryDue(weekly, { lastSentAt: at(5, 9) }, at(11, 23)), false, 'weekly: not again until next Monday');
});

test('the message: income, loot, ventures, rank-ups, ready subs and low supplies, in plain words', () => {
  const text = buildSummary({
    every: 7,
    income: { net: 12345678.4, perDay: 1763668.3, share: 0.92, counted: 3 },
    loot: { voyages: 42, salvage: 310, gil: 9876543 },
    ventures: { count: 120 },
    rankUps: [{ who: 'Aki (Maduin)', sub: 'Sub-1', from: 88, to: 90 }],
    buildReady: [{ who: 'Aki (Maduin)', sub: 'Sub-1', rank: 90 }],
    lowSupplies: [{ who: 'Bex (Maduin)', what: 'ceruleum', days: 2.7 }, { who: 'Cal (Maduin)', what: 'repair kits', days: 0.4 }],
  });
  assert.match(text, /^\*\*Fleet summary for the last week\*\*/);
  assert.match(text, /Gil earned: 12,345,678 gil \(1,763,668 gil a day, 92% of expected\)/);
  assert.match(text, /Loot: 42 voyages brought back 310 salvage; all loot worth 9,876,543 gil at vendor prices\./);
  assert.match(text, /Ventures: 120 rewards collected\./);
  assert.match(text, /Ranked up: 1 sub: Aki \(Maduin\) Sub-1 88→90\./);
  assert.match(text, /Ready for new parts: Aki \(Maduin\) Sub-1 \(rank 90\)\./);
  assert.match(text, /Running low \(under 7 days\): Bex \(Maduin\) ceruleum \(2 days\), Cal \(Maduin\) repair kits \(under a day\)\./);
});

test('with little history or nothing to report it says so; loot and ventures only once recorded', () => {
  const text = buildSummary({ every: 1, income: { net: 0, perDay: 0, share: null, counted: 0 }, loot: null, ventures: null, rankUps: [], buildReady: [], lowSupplies: [] });
  assert.match(text, /last day/);
  assert.match(text, /Gil earned: not enough history yet\./);
  assert.match(text, /Ranked up: no subs\./);
  assert.match(text, /Supplies: nothing runs out within 7 days\./);
  assert.doesNotMatch(text, /Loot|Ventures|Ready for new parts/);
});

test('the summary leaves out what the player does not run', () => {
  const data = {
    every: 1, income: { net: 1000, perDay: 1000, share: null, counted: 1 }, loot: { voyages: 2, salvage: 3, gil: 9000 }, ventures: { count: 4 },
    rankUps: [], buildReady: [], lowSupplies: [],
  };
  const retainersOnly = buildSummary({ ...data, uses: { subs: false, retainers: true } });
  assert.ok(retainersOnly.includes('Ventures: 4 rewards') && !retainersOnly.includes('Gil earned') && !retainersOnly.includes('Loot')
    && !retainersOnly.includes('Ranked up') && !retainersOnly.includes('Supplies'), retainersOnly);
  const subsOnly = buildSummary({ ...data, uses: { subs: true, retainers: false } });
  assert.ok(!subsOnly.includes('Ventures') && subsOnly.includes('Gil earned') && subsOnly.includes('Loot: 2 voyages'), subsOnly);
});

test('with live prices, the summary gives loot and ventures at market prices too', () => {
  const m = (g) => ({ gil: g });
  const text = buildSummary({
    every: 1, income: { net: 0, perDay: 0, share: null, counted: 0 }, loot: { voyages: 2, salvage: 3, gil: 9000 }, ventures: { count: 4, gil: 1200 },
    rankUps: [], buildReady: [], lowSupplies: [],
    market: { loot: { world: m(12000), dc: m(11000), region: m(10000) }, ventures: { world: m(3000), dc: m(2500), region: m(2000) } },
  });
  assert.ok(text.includes('all loot worth 9,000 gil at vendor prices. At market prices: 12,000 gil (world), 11,000 gil (data center), 10,000 gil (region).'), text);
  assert.ok(text.includes('Ventures: 4 rewards collected, worth 1,200 gil at vendor prices. At market prices: 3,000 gil (world)'), text);
  const down = buildSummary({ every: 1, income: { counted: 0 }, loot: null, ventures: { count: 1, gil: 5 }, rankUps: [], buildReady: [], lowSupplies: [], market: { error: 'Universalis is busy.' } });
  assert.ok(down.includes('(Live prices unavailable: Universalis is busy.)'), down);
});
