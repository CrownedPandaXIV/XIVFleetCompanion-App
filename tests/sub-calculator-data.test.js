// The Sub Calculator's data file (subs/calculator-data.json) and a build's five stats (subs/submarine-builds.js).
const test = require('node:test');
const assert = require('node:assert');
const { load, problems } = require('../subs/calculator-data');
const { buildStats, computeStat, STATS } = require('../subs/submarine-builds');

test('the shipped data passes its own checks', () => {
  const data = load();
  assert.deepStrictEqual(problems(data), []);
  assert.ok(data.sectors.length >= 140, `${data.sectors.length} sectors`);
  assert.ok(data.about.xivstats.updated);
});

test("the shipped data has XIVStats' breakpoints and loot by tier", () => {
  const bottom = load().sectors.find((s) => s.id === 28); // the Rimilala Trench Bottom (AB)
  assert.deepStrictEqual(bottom.xivstats, [130, 150, 155, 200, 120]);
  assert.ok(bottom.pools['1'].loot.length && bottom.pools['2'].loot.length);
  for (const item of bottom.pools['1'].loot) assert.ok(item[4] <= item[5] && item[6] <= item[7] && item[8] <= item[9]);
});

test("Pepper's figures sit beside XIVStats', typos left out", () => {
  const sectors = load().sectors;
  assert.ok(sectors.filter((s) => s.pepper).length >= 130, 'most sectors have Pepper figures');
  for (const s of sectors.filter((x) => x.pepper)) {
    s.pepper.forEach((v, i) => assert.ok(Math.abs(v - s.xivstats[i]) <= 20, `${s.name}: ${v} against ${s.xivstats[i]}`));
  }
});

test('problems() names what is wrong', () => {
  assert.deepStrictEqual(problems({ about: { xivstats: { updated: 'x' } }, sectors: [] }), ['It has no sectors.']);
  const bad = { about: { xivstats: { updated: 'x' } }, sectors: [{ id: 5, xivstats: [1, 2, 3], pepper: null, seen: null, pools: { 1: { records: 1, loot: [[1, 2]] } } }] };
  assert.deepStrictEqual(problems(bad), ['Sector 5: no XIVStats breakpoints.', 'Sector 5: Tier 1 has an item that is not 10 numbers.']);
});

// Two ranks and the Whale (class 1) and Syldra (class 5) parts in all four slots.
const ranks = new Map([[100, { surveillance: 80, retrieval: 90, speed: 60, range: 50, favor: 70 }], [101, { speed: 61, range: 51 }]]);
const parts = new Map();
for (let slot = 0; slot < 4; slot++) {
  parts.set(`1|${slot}`, { surveillance: 10 + slot, retrieval: 20, speed: 5, range: 15, favor: 12 });
  parts.set(`5|${slot}`, { surveillance: 30, retrieval: 25 + slot, speed: 8, range: 22, favor: 18 });
}

test("a build's five stats are the rank's bonus plus its four parts'", () => {
  assert.deepStrictEqual(STATS, ['surveillance', 'retrieval', 'speed', 'range', 'favor']);
  assert.deepStrictEqual(buildStats(100, ['W', 'Y', 'W', 'Y'], ranks, parts),
    { surveillance: 80 + 10 + 30 + 12 + 30, retrieval: 90 + 20 + 26 + 20 + 28, speed: 60 + 5 + 8 + 5 + 8, range: 50 + 15 + 22 + 15 + 22, favor: 70 + 12 + 18 + 12 + 18 });
});

test('a stat the game data lacks is unknown, not 0', () => {
  assert.strictEqual(buildStats(101, ['W', 'W', 'W', 'W'], ranks, parts), null);
  assert.strictEqual(computeStat(101, ['W', 'W', 'W', 'W'], 'speed', ranks, parts), 61 + 20);
  assert.strictEqual(computeStat(101, ['W', 'W', 'W', 'W'], 'favor', ranks, parts), '');
  assert.strictEqual(buildStats(100, ['W', 'S', 'W', 'W'], ranks, parts), null); // no Shark parts here
  assert.strictEqual(buildStats(99, ['W', 'W', 'W', 'W'], ranks, parts), null);
});
