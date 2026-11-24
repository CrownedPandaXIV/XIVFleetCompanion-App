// The Sub Calculator's daily data (sub-data-update.js, subs/calculator-data.js useFolder/adopt/load): a newer copy that
// passes the checks is kept and used; an older, broken or unreachable one changes nothing; a missed day is made up.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const calculatorData = require('../subs/calculator-data');
const { due, checkNow, DAY } = require('../sub-data-update');

const shipped = JSON.parse(fs.readFileSync(calculatorData.FILE, 'utf8'));
const madeIn = (ms) => ({ ...shipped, about: { ...shipped.about, made: new Date(ms).toISOString() } });
const later = calculatorData.madeAt(shipped) + DAY;

function folder() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sub-data-'));
  calculatorData.useFolder(dir);
  return dir;
}

test('a check is due with none yet, a day after the last, or when the clock went back', () => {
  assert.strictEqual(due(undefined, 1000), true);
  assert.strictEqual(due(1000, 1000 + DAY - 1), false);
  assert.strictEqual(due(1000, 1000 + DAY), true);
  assert.strictEqual(due(5000, 1000), true);
});

test('a newer copy that passes the checks is kept, used, and still used after a restart', async () => {
  const dir = folder();
  const stateFile = path.join(dir, 'sub-data-check.json');
  const done = await checkNow({ get: async () => madeIn(later), stateFile, now: 42 });
  assert.deepStrictEqual(done, { checkedAt: 42, adopted: true, error: null });
  assert.strictEqual(calculatorData.madeAt(calculatorData.load()), later);
  assert.strictEqual(JSON.parse(fs.readFileSync(stateFile, 'utf8')).checkedAt, 42);
  calculatorData.useFolder(dir); // as at the next start
  assert.strictEqual(calculatorData.madeAt(calculatorData.load()), later);
});

test('an older, broken or unreachable copy changes nothing', async () => {
  const dir = folder();
  const stateFile = path.join(dir, 'sub-data-check.json');
  assert.strictEqual((await checkNow({ get: async () => madeIn(later - 2 * DAY), stateFile })).adopted, false);
  assert.strictEqual((await checkNow({ get: async () => ({ ...madeIn(later), sectors: [] }), stateFile })).adopted, false);
  const failed = await checkNow({ get: async () => { throw new Error('HTTP 404'); }, stateFile });
  assert.strictEqual(failed.error, 'HTTP 404');
  assert.strictEqual(calculatorData.load(), calculatorData.load());
  assert.strictEqual(calculatorData.madeAt(calculatorData.load()), calculatorData.madeAt(shipped));
  assert.ok(!fs.existsSync(path.join(dir, 'calculator-data.json')));
});

test('a downloaded copy older than the shipped one (after an update) is left unused', () => {
  const dir = folder();
  fs.writeFileSync(path.join(dir, 'calculator-data.json'), JSON.stringify(madeIn(calculatorData.madeAt(shipped) - DAY)));
  calculatorData.useFolder(dir);
  assert.strictEqual(calculatorData.madeAt(calculatorData.load()), calculatorData.madeAt(shipped));
});
