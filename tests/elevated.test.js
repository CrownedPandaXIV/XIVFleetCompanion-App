// Starting the app again with administrator rights for "Let other PCs connect" (setup/elevated.js).
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');

// setup/elevated.js loads Electron, which these tests don't need.
const load = Module._load;
Module._load = (request, ...rest) => (request === 'electron' ? { app: {} } : load(request, ...rest));
const { elevateScript, describeElevationError } = require('../setup/elevated');
Module._load = load;

test("the installed app starts itself again through Windows' permission prompt and waits", () => {
  assert.strictEqual(elevateScript('C:\\Users\\Me\\AppData\\Local\\Programs\\XIV Fleet Companion\\XIV Fleet Companion.exe', null, 'C:\\Temp\\x\\request.json'),
    "$ErrorActionPreference = 'Stop'; Start-Process -FilePath 'C:\\Users\\Me\\AppData\\Local\\Programs\\XIV Fleet Companion\\XIV Fleet Companion.exe' -ArgumentList '--fleet-setup \"C:\\Temp\\x\\request.json\"' -Verb RunAs -Wait -WindowStyle Hidden");
});

test("run from source, it passes the app's folder first; quotes in paths are escaped for PowerShell", () => {
  const s = elevateScript("C:\\node\\electron.exe", "C:\\Pat's code\\app", 'C:\\T\\r.json');
  assert.ok(s.includes("-ArgumentList '\"C:\\Pat''s code\\app\" --fleet-setup"));
});

test('turning the prompt down says nothing was changed', () => {
  assert.match(describeElevationError('Start-Process : This command cannot be run due to the error: The operation was canceled by the user.'), /turned down, so nothing was changed/);
  assert.match(describeElevationError('something else'), /couldn't start the change: something else/);
});

const { runSteps } = (() => {
  Module._load = (request, ...rest) => (request === 'electron' ? { app: {} } : load(request, ...rest));
  try { return require('../setup/elevated'); } finally { Module._load = load; }
})();

test('the administrator steps run in order with the right commands, and stop at the first that fails', async () => {
  const calls = [];
  const run = async (file, args) => { calls.push([file, ...args].join(' ')); return { ok: true, code: file === 'msiexec.exe' ? 3010 : 0, stdout: '', stderr: '' }; };
  const progress = [];
  const r = await runSteps([
    { kind: 'installPostgres', installer: 'C:\\dl\\pg.exe', optionFile: 'C:\\t\\options.txt' },
    { kind: 'installTailscale', msi: 'C:\\dl\\ts.msi' },
  ], { run, listServices: async () => [] }, (results) => progress.push(results.length));
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(calls, [
    'C:\\dl\\pg.exe --mode unattended --unattendedmodeui none --optionfile C:\\t\\options.txt',
    'msiexec.exe /i C:\\dl\\ts.msi /quiet /norestart',
  ]);
  assert.deepStrictEqual(progress, [1, 2], 'progress after each step');

  const failing = await runSteps([
    { kind: 'installPostgres', installer: 'pg.exe', optionFile: 'o.txt' },
    { kind: 'installTailscale', msi: 'ts.msi' },
  ], { run: async () => ({ ok: false, code: 1, stdout: '', stderr: 'disk full' }), listServices: async () => [] });
  assert.strictEqual(failing.ok, false);
  assert.strictEqual(failing.results.length, 1, 'Tailscale is not tried after PostgreSQL failed');
  assert.match(failing.results[0].message, /stopped with code 1\. disk full/);
});

test('"let other PCs connect" as a step finds PostgreSQL itself; none installed says so', async () => {
  const r = await runSteps([{ kind: 'openConnections', port: 5432, ranges: ['100.64.0.0/10'] }],
    { run: async () => ({ ok: true, code: 0, stdout: '', stderr: '' }), listServices: async () => [] });
  assert.strictEqual(r.ok, false);
  assert.match(r.results[0].message, /Couldn't find the PostgreSQL on this PC that uses port 5432/);
});

// A pretend PostgreSQL install in a temporary folder: <tmp>/PostgreSQL/18 with its uninstaller and data folder.
function fakePostgres() {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-remove-'));
  const installDir = path.join(root, 'PostgreSQL', '18');
  const dataDir = path.join(installDir, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'postgresql.conf'), 'port = 5432\n');
  fs.writeFileSync(path.join(dataDir, 'PG_VERSION'), '18\n');
  fs.writeFileSync(path.join(installDir, 'uninstall-postgresql.exe'), '');
  return { root, installDir, dataDir, services: [{ service: 'postgresql-x64-18', dataDir, installDir }] };
}

test('removing PostgreSQL runs its own uninstaller, then deletes its data and program folders and the firewall rule', async () => {
  const fs = require('fs');
  const pg = fakePostgres();
  const calls = [];
  const run = async (file, args) => {
    calls.push([file, ...args].join(' '));
    // The real uninstaller removes itself and the programs, but leaves the data folder.
    if (file.endsWith('uninstall-postgresql.exe')) fs.rmSync(file);
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };
  const r = await runSteps([{ kind: 'removePostgres', port: 5432 }], { run, listServices: async () => pg.services, wait: async () => {} });
  assert.deepStrictEqual(r.results, [{ kind: 'removePostgres', ok: true, message: 'PostgreSQL and its databases are removed.' }]);
  assert.ok(calls.includes(`${pg.installDir}/uninstall-postgresql.exe --mode unattended`) || calls.some((c) => c.endsWith('uninstall-postgresql.exe --mode unattended')));
  assert.ok(calls[0].startsWith('sc.exe stop postgresql-x64-18'), 'the service is stopped first');
  assert.ok(calls.some((c) => c.includes('firewall delete rule')));
  assert.ok(!fs.existsSync(pg.installDir), 'its folders are gone');
  assert.ok(!fs.existsSync(`${pg.root}/PostgreSQL`), 'and the empty "PostgreSQL" folder around them');
  assert.ok(fs.existsSync(pg.root), 'nothing above that is touched');
});

test('the "PostgreSQL" folder stays when another version is still in it', async () => {
  const fs = require('fs');
  const pg = fakePostgres();
  fs.mkdirSync(`${pg.root}/PostgreSQL/16`);
  const run = async (file) => { if (file.endsWith('uninstall-postgresql.exe')) fs.rmSync(file); return { ok: true, code: 0, stdout: '', stderr: '' }; };
  await runSteps([{ kind: 'removePostgres', port: 5432 }], { run, listServices: async () => pg.services, wait: async () => {} });
  assert.ok(!fs.existsSync(pg.installDir) && fs.existsSync(`${pg.root}/PostgreSQL/16`));
});

test('PostgreSQL already gone is fine; a missing uninstaller or one that fails is reported, and nothing is deleted', async () => {
  const fs = require('fs');
  const ok = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });
  const gone = await runSteps([{ kind: 'removePostgres', port: 5432 }], { run: ok, listServices: async () => [] });
  assert.deepStrictEqual([gone.ok, gone.results[0].message], [true, 'PostgreSQL was already gone.']);

  const pg = fakePostgres();
  fs.rmSync(`${pg.installDir}/uninstall-postgresql.exe`);
  const missing = await runSteps([{ kind: 'removePostgres', port: 5432 }], { run: ok, listServices: async () => pg.services });
  assert.match(missing.results[0].message, /Couldn't find PostgreSQL's uninstaller/);
  assert.ok(fs.existsSync(pg.dataDir));

  const pg2 = fakePostgres();
  const failed = await runSteps([{ kind: 'removePostgres', port: 5432 }], { run: async (file) => ({ ok: false, code: file === 'sc.exe' ? 0 : 5, stdout: 'Access denied', stderr: '' }), listServices: async () => pg2.services });
  assert.match(failed.results[0].message, /uninstaller stopped with code 5\. Access denied/);
  assert.ok(fs.existsSync(pg2.dataDir), 'the databases stay when the uninstaller failed');
});

test('a data folder without PG_VERSION, or a program folder outside a "PostgreSQL" folder, is never deleted', async () => {
  const fs = require('fs');
  const path = require('path');
  const pg = fakePostgres();
  fs.rmSync(path.join(pg.dataDir, 'PG_VERSION'));
  const odd = path.join(pg.root, 'Programs');
  fs.renameSync(path.join(pg.root, 'PostgreSQL'), odd);
  const services = [{ service: 's', dataDir: path.join(odd, '18', 'data'), installDir: path.join(odd, '18') }];
  const r = await runSteps([{ kind: 'removePostgres', port: 5432 }], { run: async () => ({ ok: true, code: 0, stdout: '', stderr: '' }), listServices: async () => services, wait: async () => {} });
  assert.strictEqual(r.ok, true);
  assert.ok(fs.existsSync(services[0].dataDir) && fs.existsSync(services[0].installDir));
});

test('removing Tailscale finds its MSI and removes it quietly; when it is not there, nothing runs', async () => {
  const calls = [];
  const code = '{0C2A35DA-F7B3-4D6E-9A3E-5D4B1C2A7F11}';
  const run = async (file, args) => { calls.push([file, ...args].join(' ')); return { ok: true, code: 0, stdout: file === 'powershell.exe' ? `${code}\r\n` : '', stderr: '' }; };
  const r = await runSteps([{ kind: 'removeTailscale' }], { run, listServices: async () => [] });
  assert.deepStrictEqual(r.results[0], { kind: 'removeTailscale', ok: true, message: 'Tailscale is removed.' });
  assert.strictEqual(calls[1], `msiexec.exe /x ${code} /quiet /norestart`);
  const none = await runSteps([{ kind: 'removeTailscale' }], { run: async () => ({ ok: true, code: 0, stdout: '', stderr: '' }), listServices: async () => [] });
  assert.strictEqual(none.results[0].message, 'Tailscale was already gone.');
});

test('when removing, a failed step does not stop the rest', async () => {
  const run = async (file) => ({ ok: true, code: file === 'msiexec.exe' ? 1603 : 0, stdout: file === 'powershell.exe' ? '{0C2A35DA-F7B3-4D6E-9A3E-5D4B1C2A7F11}' : '', stderr: '' });
  const r = await runSteps([{ kind: 'removeTailscale' }, { kind: 'undoOpenConnections', port: 5432 }], { run, listServices: async () => [] }, () => {}, { keepGoing: true });
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.results.map((x) => x.ok), [false, true]);
});
