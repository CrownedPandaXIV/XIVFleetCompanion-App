// Fight Club in the Subs tab (subs/submarine-builds.js): Target Route picks the most gil a day after repair
// kits, and Next Build looks ahead to the first rank where a better-paying build unlocks.
const test = require('node:test');
const assert = require('node:assert');
const { bestFightClubOption, computeTargetRoute, nextFightClubBuild } = require('../subs/submarine-builds');

const letters = new Set(['O', 'J', 'Z', 'M', 'R']);
// Repair kits every 10 voyages. Kits per part: Shark 1, Whale 3, any modified part 6.
const rows = [
  // Most gil an hour, but its four modified parts break 24 kits every 10 days: 300,000 - 24 x 5,000 / 10 = 288,000.
  { route: 'OJZ', hours: 24, repair_times: '10', gil_sub_day: 300000, gil_hr: 12500, rec_build_notes: '85: W+W+W+W+' },
  // Less an hour, but cheap parts: 292,000 - 4 x 5,000 / 10 = 290,000.
  { route: 'OJ', hours: 24, repair_times: '10', gil_sub_day: 292000, gil_hr: 12100, rec_build_notes: '85: SSSS' },
  // Unlocks at 90: 320,000 - 12 x 5,000 / 10 = 314,000.
  { route: 'MROJZ', hours: 24, repair_times: '10', gil_sub_day: 320000, gil_hr: 13300, rec_build_notes: '90: WWWW' },
];

test('Target Route: the most gil a day after repair kits, not the most an hour', () => {
  assert.deepStrictEqual(computeTargetRoute(85, rows, 5000, letters), { route: 'O-J', gilPerDay: 290000 });
  // With free repair kits, the modified build's extra gil wins.
  assert.deepStrictEqual(computeTargetRoute(85, rows, 0, letters), { route: 'O-J-Z', gilPerDay: 300000 });
  assert.deepStrictEqual(computeTargetRoute(90, rows, 5000, letters), { route: 'M-R-O-J-Z', gilPerDay: 314000 });
  assert.deepStrictEqual(computeTargetRoute(84, rows, 5000, letters), { route: '', gilPerDay: '' }, 'Fight Club starts at 85');
  assert.deepStrictEqual(bestFightClubOption(85, rows, 5000).parts, ['S', 'S', 'S', 'S']);
});

test('Next Build from Fight Club: the first rank where a different build makes more than the sub does now', () => {
  const base = { top: 100, fightClubRows: rows, repairKitCost: 5000, validRouteLetters: letters };
  // A rank 85 sub on O-J with SSSS, making 290,000: nothing better until MROJZ at 90.
  assert.deepStrictEqual(nextFightClubBuild({ ...base, rank: 85, currentParts: ['S', 'S', 'S', 'S'], currentNet: 290000 }),
    { rank: 90, build: ['W', 'W', 'W', 'W'], route: 'M-R-O-J-Z', net: 314000, gain: 24000 });
  // Something better already unlocked: now, at its own rank.
  assert.deepStrictEqual(nextFightClubBuild({ ...base, rank: 85, currentParts: ['C', 'C', 'C', 'C'], currentNet: 200000 }),
    { rank: 85, build: ['S', 'S', 'S', 'S'], route: 'O-J', net: 290000, gain: 90000 });
  // Already on the best build there is: nothing.
  assert.strictEqual(nextFightClubBuild({ ...base, rank: 90, currentParts: ['W', 'W', 'W', 'W'], currentNet: 314000 }), null);
  // Making more than anything ahead already: nothing.
  assert.strictEqual(nextFightClubBuild({ ...base, rank: 85, currentParts: ['C', 'C', 'C', 'C'], currentNet: 400000 }), null);
  // Its own gil a day unknown (route not in Fight Club): compared with the best it could run now.
  assert.strictEqual(nextFightClubBuild({ ...base, rank: 85, currentParts: ['U', 'U', 'U', 'U'], currentNet: null }).rank, 90);
  // Past the highest rank there is: nothing.
  assert.strictEqual(nextFightClubBuild({ ...base, top: 89, rank: 85, currentParts: ['S', 'S', 'S', 'S'], currentNet: 290000 }), null);
});
