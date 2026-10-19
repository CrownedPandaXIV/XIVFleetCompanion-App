// The app's log (app-log.js): lines with the time and level, never a password, kept to two small files, and
// console output sent to it as well as printed.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { scrub, formatLine, createLog, captureConsole, LOG_NAME, OLD_NAME } = require('../app-log');

const AT = new Date(2026, 9, 19, 8, 5, 9);

test('a line has the time, the level and the message, objects and errors printed as console does', () => {
  assert.strictEqual(formatLine('info', ['Database updated:', 'update 10'], AT), '2026-10-19 08:05:09  info   Database updated: update 10');
  assert.strictEqual(formatLine('error', ['Counts', { a: 1 }], AT), "2026-10-19 08:05:09  error  Counts { a: 1 }");
  const line = formatLine('error', [new Error('boom')], AT);
  assert.match(line, /^2026-10-19 08:05:09  error  Error: boom\n {28} *at /);
});

test('a password never reaches the log, however it is printed', () => {
  for (const [input, expected] of [
    ['{ host: "x", password: "hunter2", user: "fleet" }', '{ host: "x", password: ***, user: "fleet" }'],
    ["{ password: 'hunter2' }", '{ password: *** }'],
    ['PGPASSWORD=secret pg_dump', 'PGPASSWORD=*** pg_dump'],
    ['postgresql://fleet:s3cret@100.64.0.1:5432/db', 'postgresql://fleet:***@100.64.0.1:5432/db'],
  ]) assert.strictEqual(scrub(input), expected);
  assert.strictEqual(scrub('The database moved to 100.64.0.1:5432'), 'The database moved to 100.64.0.1:5432');
  assert.ok(!formatLine('info', [{ host: 'h', password: 'hunter2' }], AT).includes('hunter2'));
});

test('past its size the log becomes app.old.log and a new one starts, so there are never more than two', () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'applog-')), 'logs');
  const log = createLog(dir, { maxBytes: 200, now: () => AT });
  for (let i = 0; i < 12; i++) log.write('info', [`line ${i} ${'x'.repeat(30)}`]);
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), [LOG_NAME, OLD_NAME]);
  const current = fs.readFileSync(path.join(dir, LOG_NAME), 'utf8');
  assert.match(current, /line 11/);
  assert.ok(fs.statSync(path.join(dir, LOG_NAME)).size <= 200 + 100);
  assert.ok(!fs.readFileSync(path.join(dir, OLD_NAME), 'utf8').includes('line 11'));
});

test('a log that cannot be written never stops the app', () => {
  const broken = { mkdirSync: () => { throw new Error('no drive'); }, statSync: () => { throw new Error(); }, renameSync() {}, appendFileSync() { throw new Error(); } };
  assert.doesNotThrow(() => createLog('Z:\\nowhere', { fsys: broken }).write('error', ['x']));
});

test('console output goes to the log as well as being printed', () => {
  const printed = [];
  const fake = { log: (...a) => printed.push(['log', ...a]), info: (...a) => printed.push(['info', ...a]), warn: (...a) => printed.push(['warn', ...a]), error: (...a) => printed.push(['error', ...a]) };
  const written = [];
  captureConsole({ write: (level, args) => written.push([level, ...args]) }, fake);
  fake.log('hello', 1);
  fake.error('Could not update the database:', 'no rights');
  fake.warn('careful');
  assert.deepStrictEqual(printed, [['log', 'hello', 1], ['error', 'Could not update the database:', 'no rights'], ['warn', 'careful']]);
  assert.deepStrictEqual(written, [['info', 'hello', 1], ['error', 'Could not update the database:', 'no rights'], ['warn', 'careful']]);
});

test('the alert check (every 5 minutes, with its own alerts.log) sends only warnings and errors to the log', () => {
  const printed = [];
  const fake = { log: (...a) => printed.push(['log', ...a]), info: (...a) => printed.push(['info', ...a]), warn: (...a) => printed.push(['warn', ...a]), error: (...a) => printed.push(['error', ...a]) };
  const written = [];
  captureConsole({ write: (level, args) => written.push([level, ...args]) }, fake, { onlyProblems: true });
  fake.log('[alerts] Checked: nothing new.');
  fake.info('more');
  fake.error('Alert check failed:', 'no database');
  assert.strictEqual(printed.length, 3);
  assert.deepStrictEqual(written, [['error', 'Alert check failed:', 'no database']]);
});
