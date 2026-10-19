// "Remove everything from this PC" (setup/remove-everything.js): what it removes and leaves on each kind of
// PC, the order it works in, and that it stops before removing anything when the final backup fails.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const re = require('../setup/remove-everything');
const { productCodeFrom } = require('../setup/installers');

const CONNECTION = { host: 'localhost', port: 5432, database: 'fleet', user: 'fleet_app' };
const facts = (over = {}) => ({
  installed: { postgres: null, tailscale: false },
  connection: CONNECTION,
  dbOnThisPc: true,
  postgresHere: true,
  tailscaleHere: false,
  otherDatabases: [],
  packaged: true,
  ...over,
});

test('what "Set up this PC" installed is noted, kept between runs, and forgotten once removed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'installed-'));
  assert.deepStrictEqual(re.readInstalled(dir), { postgres: null, tailscale: false });
  re.recordInstalled(dir, { postgres: { port: 5432 } });
  re.recordInstalled(dir, { tailscale: true });
  assert.deepStrictEqual(re.readInstalled(dir), { postgres: { port: 5432 }, tailscale: true });
  re.forgetInstalled(dir, { postgres: true, tailscale: false });
  assert.deepStrictEqual(re.readInstalled(dir), { postgres: null, tailscale: true });
});

test('PostgreSQL the app installed is removed whole, with the other databases in it named', () => {
  const plan = re.removalPlan(facts({ installed: { postgres: { port: 5432 }, tailscale: true }, tailscaleHere: true, otherDatabases: ['mine'] }));
  assert.strictEqual(plan.removePostgres, true);
  assert.strictEqual(plan.dropDatabase, false);
  assert.strictEqual(plan.needsMasterPassword, false);
  assert.strictEqual(plan.canRemoveTailscale, true);
  assert.match(plan.removes[0], /^PostgreSQL, with every database in it \("fleet", and also "mine"\)/);
  assert.ok(plan.removes.includes('The app itself'));
  assert.deepStrictEqual(re.removalSteps(plan, { backup: true, removeTailscale: true }).map((s) => s.label), [
    'Make a final backup', 'Remove the backup and alert tasks', 'Remove PostgreSQL, remove Tailscale (Windows asks for permission)',
  ]);
});

test("PostgreSQL that was already on this PC (or on another port) stays: only the app's database, login and access go", () => {
  for (const installed of [{ postgres: null, tailscale: false }, { postgres: { port: 5433 }, tailscale: false }]) {
    const plan = re.removalPlan(facts({ installed, tailscaleHere: true }));
    assert.deepStrictEqual([plan.removePostgres, plan.dropDatabase, plan.undoConnections, plan.needsMasterPassword, plan.canRemoveTailscale], [false, true, true, true, false]);
    assert.ok(plan.removes.includes('The "fleet" database and its login "fleet_app"'));
    assert.ok(plan.keeps.some((k) => k.startsWith('PostgreSQL itself')));
    assert.ok(plan.keeps.includes("Tailscale (the app didn't install it)"));
    assert.deepStrictEqual(re.removalSteps(plan, { backup: false }).map((s) => s.id), ['database', 'tasks', 'admin']);
  }
});

test('a PC that uses a database on another PC leaves it alone and offers no backup', () => {
  const plan = re.removalPlan(facts({ connection: { ...CONNECTION, host: '100.101.102.103' }, dbOnThisPc: false, postgresHere: false }));
  assert.deepStrictEqual([plan.removePostgres, plan.dropDatabase, plan.offerBackup, plan.otherPcsLoseDatabase], [false, false, false, false]);
  assert.ok(plan.keeps.includes("The database on 100.101.102.103 (it's on another PC)"));
  assert.deepStrictEqual(re.removalSteps(plan, { backup: true }).map((s) => s.id), ['tasks']);
  assert.ok(!re.removalPlan(facts({ packaged: false })).removes.includes('The app itself'), 'run from source, the app is not removed');
});

test('after the database moved away: the copy it left goes with PostgreSQL the app installed, never "the app didn\'t install it"', () => {
  const away = { connection: { ...CONNECTION, host: '100.101.102.103' }, dbOnThisPc: false, movedAway: { port: 5432, movedTo: '100.101.102.103:5432' } };
  const ours = re.removalPlan(facts({ ...away, installed: { postgres: { port: 5432 }, tailscale: false } }));
  assert.deepStrictEqual([ours.removePostgres, ours.dropDatabase, ours.undoConnections, ours.needsMasterPassword, ours.offerBackup, ours.otherPcsLoseDatabase], [true, false, false, false, false, false]);
  assert.match(ours.removes[0], /^PostgreSQL, with every database in it \(the copy of "fleet" left here when the database moved to 100\.101\.102\.103:5432\)/);
  assert.ok(!ours.keeps.some((k) => k.startsWith('PostgreSQL')), JSON.stringify(ours.keeps));
  assert.ok(ours.keeps.includes("The database on 100.101.102.103 (it's on another PC)"));

  // PostgreSQL that was already here stays; only the copy, its login and the access the app added go.
  const theirs = re.removalPlan(facts({ ...away }));
  assert.deepStrictEqual([theirs.removePostgres, theirs.dropDatabase, theirs.undoConnections, theirs.needsMasterPassword, theirs.offerBackup], [false, true, true, true, false]);
  assert.ok(theirs.removes.includes('The copy of the "fleet" database left here when it moved to 100.101.102.103:5432 and its login "fleet_app"'));
  assert.deepStrictEqual(re.removalSteps(theirs, {}).map((s) => s.label)[0], 'Remove the copy of the "fleet" database and its login');

  // The copy already tidied away (Leftovers): PostgreSQL the app installed stays, and says how to remove it.
  const tidied = re.removalPlan(facts({ ...away, movedAway: null, installed: { postgres: { port: 5432 }, tailscale: false } }));
  assert.deepStrictEqual([tidied.removePostgres, tidied.dropDatabase, tidied.undoConnections], [false, false, false]);
  assert.ok(tidied.keeps.some((k) => /none of the app's databases is in it now; Settings → Database → Leftovers/.test(k)), JSON.stringify(tidied.keeps));
});

function fakeDeps(over = {}) {
  const log = [];
  const deps = {
    platform: 'win32',
    facts: async () => facts({ installed: { postgres: { port: 5432 }, tailscale: true }, tailscaleHere: true }),
    makeBackup: async (folder) => { log.push(`backup ${folder}`); return { ok: true, file: `${folder}\\fleet.backup` }; },
    connectAdmin: async ({ port, password }) => { log.push(`connect ${port} ${password}`); return { query: async () => { throw new Error('not used'); }, end: async () => log.push('end') }; },
    isMovedAwayCopy: async ({ database }) => { log.push(`check ${database}`); return true; },
    removeTasks: async () => { log.push('tasks'); return { ok: true }; },
    runElevated: async (steps, onProgress) => {
      log.push(`admin ${steps.map((s) => s.kind).join(' ')}`);
      const results = steps.map((s) => ({ kind: s.kind, ok: true, message: `${s.kind} done.` }));
      onProgress(results);
      return { ok: true, results };
    },
    forgetInstalled: (what) => log.push(`forget ${JSON.stringify(what)}`),
    ...over,
  };
  return { deps, log };
}
const INPUT = { backup: true, backupFolder: 'D:\\Final', removeTailscale: true, confirm: 'DELETE' };

test('the whole run: final backup first, then the tasks, then one permission prompt for the rest', async () => {
  const { deps, log } = fakeDeps();
  const reports = [];
  const r = await re.removeEverything(INPUT, deps, (steps) => reports.push(steps.map((s) => `${s.id}:${s.state}`).join(' ')));
  assert.strictEqual(r.ok, true, r.error);
  assert.deepStrictEqual(log, ['backup D:\\Final', 'tasks', 'admin removePostgres removeTailscale', 'forget {"postgres":true,"tailscale":true}']);
  assert.strictEqual(reports[reports.length - 1], 'backup:done tasks:done admin:done');
});

test('nothing is removed without DELETE typed, or when the final backup fails', async () => {
  const typo = fakeDeps();
  assert.match((await re.removeEverything({ ...INPUT, confirm: 'delete' }, typo.deps)).error, /Type DELETE/);
  assert.deepStrictEqual(typo.log, []);

  const failed = fakeDeps({ makeBackup: async () => ({ ok: false, message: 'Drive D:\\ is not available.' }) });
  const r = await re.removeEverything(INPUT, failed.deps);
  assert.match(r.error, /final backup didn't work, so nothing was removed: Drive D/);
  assert.deepStrictEqual(failed.log, []);

  const noFolder = fakeDeps();
  assert.match((await re.removeEverything({ ...INPUT, backupFolder: ' ' }, noFolder.deps)).error, /Choose a folder/);
  assert.match((await re.removeEverything(INPUT, fakeDeps({ platform: 'linux' }).deps)).error, /only be done on Windows/);
});

test("PostgreSQL that stays needs its master password; a wrong one stops before anything else", async () => {
  const keep = async () => facts();
  const none = fakeDeps({ facts: keep });
  assert.match((await re.removeEverything({ ...INPUT, backup: false }, none.deps)).error, /master password/);

  const wrong = fakeDeps({ facts: keep, connectAdmin: async () => { throw Object.assign(new Error('password authentication failed'), { code: '28P01' }); } });
  const r = await re.removeEverything({ ...INPUT, backup: false, masterPassword: 'nope' }, wrong.deps);
  assert.match(r.error, /refused the master password/);
  assert.deepStrictEqual(wrong.log, []);
});

test("PostgreSQL that isn't running says so plainly, and a copy that's in use again is never removed", async () => {
  const keep = async () => facts();
  const down = fakeDeps({ facts: keep, connectAdmin: async () => { throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' }); } });
  const r = await re.removeEverything({ ...INPUT, backup: false, masterPassword: 'pw' }, down.deps);
  assert.match(r.error, /^PostgreSQL isn't running on this PC, so nothing was removed\./);
  assert.ok(!/ECONNREFUSED/.test(r.error));

  const away = async () => facts({ connection: { ...CONNECTION, host: '100.101.102.103' }, dbOnThisPc: false, movedAway: { port: 5432, movedTo: '100.101.102.103:5432' } });
  const inUse = fakeDeps({ facts: away, isMovedAwayCopy: async () => false });
  const r2 = await re.removeEverything({ ...INPUT, backup: false, masterPassword: 'pw' }, inUse.deps);
  assert.match(r2.error, /"fleet" on this PC is no longer a copy left by moving the database, so nothing was removed/);
  assert.deepStrictEqual(inUse.log, ['connect 5432 pw', 'end']);
});

test('a failed removal step is reported, and what was removed is still forgotten only on success', async () => {
  const { deps, log } = fakeDeps({ runElevated: async () => ({ ok: false, results: [{ kind: 'removePostgres', ok: false, message: "PostgreSQL's uninstaller stopped with code 5." }, { kind: 'removeTailscale', ok: true, message: 'Tailscale is removed.' }] }) });
  const r = await re.removeEverything(INPUT, deps);
  assert.match(r.error, /code 5/);
  assert.ok(!log.some((l) => l.startsWith('forget')));
});

test('the last part waits for the app to close, closes what is left of it, runs its uninstaller, then deletes its settings, logging each step', () => {
  const s = re.finishScript({ pid: 4321, installDir: "C:\\Users\\Pat's\\Programs\\xiv-fleet", userData: 'C:\\Users\\Pat\\AppData\\Roaming\\XIV Fleet Companion', log: 'C:\\T\\xiv-fleet-remove.log' });
  const at = (text) => { const i = s.indexOf(text); assert.ok(i >= 0, `missing: ${text}`); return i; };
  assert.ok(at('Wait-Process -Id 4321 -Timeout 60') < at("Stop-Process -Force"));
  assert.ok(at("$_.Path -like 'C:\\Users\\Pat''s\\Programs\\xiv-fleet\\*'") < at('QuietUninstallString'));
  assert.ok(at("DisplayName -like 'XIV Fleet Companion*'") < at("-Filter 'Uninstall*.exe'"), 'Windows\' list of programs first, then the folder');
  assert.ok(at("Log 'The app is removed'") < at("Remove-Item -LiteralPath 'C:\\Users\\Pat\\AppData\\Roaming\\XIV Fleet Companion'"), 'settings go after the app');
  assert.ok(at("$log = 'C:\\T\\xiv-fleet-remove.log'") < at("Log 'Done'"));
  assert.ok(at("Log 'Done'") < at('Remove-Item -LiteralPath $PSCommandPath'), 'the script file goes only once it has finished');
  assert.ok(/^param\(\[switch\]\$Launch\)$/m.test(s) && s.indexOf('param(') < s.indexOf('$log ='), 'param comes first');
  assert.ok(at('if ($Launch) {') < at('Invoke-CimMethod -ClassName Win32_Process') && at('Invoke-CimMethod') < at(`Log '${re.FINISH_RUNNING}`), 'started again through Windows, before any of the work');
  assert.ok(at('Wait-Process -Id 4321') < at("if (Get-Process -Id 4321 -ErrorAction SilentlyContinue) { Log 'The app is still open, so nothing was removed'; exit 1 }"));
  assert.ok(at('The app is still open') < at('Stop-Process -Force'), 'nothing is touched while the app is open');
  const withDownloads = re.finishScript({ pid: 1, installDir: null, userData: 'C:\\x', folders: ['C:\\L\\xiv-fleet-companion-updater', 'C:\\L\\fleet-tier3-updater'], log: 'C:\\l' });
  for (const f of ['xiv-fleet-companion-updater', 'fleet-tier3-updater']) {
    const i = withDownloads.indexOf(`Remove-Item -LiteralPath 'C:\\L\\${f}' -Recurse`);
    assert.ok(i > withDownloads.indexOf("Log 'The settings folder is deleted'") && i < withDownloads.indexOf("Log 'Done'"), `${f} is deleted with the settings`);
  }
  const fromSource = re.finishScript({ pid: 1, installDir: null, userData: 'C:\\x', log: 'C:\\l' });
  assert.ok(!/Uninstall|Stop-Process/.test(fromSource) && fromSource.includes("Remove-Item -LiteralPath 'C:\\x'"), 'run from source, only the settings go');
});

test("Tailscale's product code is read from Windows' list of programs", () => {
  assert.strictEqual(productCodeFrom('\r\n{0C2A35DA-F7B3-4D6E-9A3E-5D4B1C2A7F11}\r\n'), '{0C2A35DA-F7B3-4D6E-9A3E-5D4B1C2A7F11}');
  assert.strictEqual(productCodeFrom(''), null);
});

test('the app closes only once the clean-up says it is running', async () => {
  const wait = async () => {};
  let log = 'starting';
  let reads = 0;
  const running = await re.startFinish({ launch: async () => ({ code: 0, out: '' }), readLog: () => (++reads === 3 ? (log += `\n${re.FINISH_RUNNING}: waiting`) : log), wait });
  assert.deepStrictEqual(running, { ok: true });
  assert.strictEqual(reads, 3);

  const blocked = await re.startFinish({ launch: async () => ({ code: 1, out: 'This script contains malicious content and has been blocked by your antivirus software.' }), readLog: () => '', wait });
  assert.strictEqual(blocked.ok, false);
  assert.match(blocked.error, /couldn't start: This script contains malicious content/);

  const silent = await re.startFinish({ launch: async () => ({ code: 0, out: '' }), readLog: () => 'Windows started the clean-up (process 9)', wait }, { tries: 3 });
  assert.strictEqual(silent.ok, false);
  assert.match(silent.error, /stays open and nothing of it was removed.*Protection history/);
});
