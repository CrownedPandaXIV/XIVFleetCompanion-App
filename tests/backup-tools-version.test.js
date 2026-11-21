// backups/tools.js findTools with the database's version: pg_dump refuses a newer server, so tools at least that
// version are taken, passing over an older PostgreSQL installed on the PC; none new enough says so.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const tools = require('../backups/tools');

function fakeTools(dir, version) {
  fs.mkdirSync(dir, { recursive: true });
  for (const name of ['pg_dump', 'pg_restore']) {
    fs.writeFileSync(path.join(dir, name), `#!/bin/sh\necho "${name} (PostgreSQL) ${version}"\n`, { mode: 0o755 });
  }
}

test('the tools at least the database\'s version are taken, else it says they are too old', { skip: process.platform === 'win32' }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pgtools-'));
  fakeTools(path.join(root, 'Program Files', 'PostgreSQL', '14', 'bin'), '14.12');
  fakeTools(path.join(root, 'downloaded'), '17.4');
  const before = process.env.ProgramFiles;
  process.env.ProgramFiles = path.join(root, 'Program Files');
  tools.useAppTools(path.join(root, 'downloaded'));
  try {
    assert.strictEqual(tools.toolsMajor('pg_dump (PostgreSQL) 16.4'), 16);
    assert.strictEqual((await tools.findTools('', { serverMajor: 14 })).bin, path.join(root, 'Program Files', 'PostgreSQL', '14', 'bin'), 'the first, when new enough');
    const for17 = await tools.findTools('', { serverMajor: 17 });
    assert.deepStrictEqual([for17.bin, for17.fromApp], [path.join(root, 'downloaded'), true], 'the older one passed over');
    assert.strictEqual((await tools.findTools('')).bin, path.join(root, 'Program Files', 'PostgreSQL', '14', 'bin'), 'with no version known, the first');
    const for18 = await tools.findTools('', { serverMajor: 18 });
    assert.strictEqual(for18.found, false);
    assert.match(for18.error, /PostgreSQL 17, older than the database's PostgreSQL 18/);
    const chosen = await tools.findTools(path.join(root, 'Program Files', 'PostgreSQL', '14', 'bin'), { serverMajor: 16 });
    assert.match(chosen.error, /PostgreSQL 14, older than the database's PostgreSQL 16.*choose a newer PostgreSQL's "bin" folder/);
  } finally {
    if (before === undefined) delete process.env.ProgramFiles; else process.env.ProgramFiles = before;
    tools.useAppTools(null);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a refused password with letters outside English is said so; a temp folder the tools can open is used", { skip: process.platform === 'win32' }, async () => {
  const fail = ['-c', 'echo "pg_dump: error: FATAL:  password authentication failed for user \\"fleet\\"" >&2; exit 1'];
  const accented = await tools.run('sh', fail, { env: { ...process.env, PGPASSWORD: 'Café-2026' } });
  const plain = await tools.run('sh', fail, { env: { ...process.env, PGPASSWORD: 'Cafe-2026' } });
  assert.ok(accented.stderr.endsWith(tools.PASSWORD_HINT) && !plain.stderr.includes('letters outside English'));
  assert.strictEqual(tools.toolTempDir('/tmp/x'), '/tmp/x');
  assert.strictEqual(tools.toolTempDir('C:\\Users\\José\\AppData\\Local\\Temp', 'C:\\ProgramData'), path.join('C:\\ProgramData', 'XIV Fleet Companion', 'temp'));
});
