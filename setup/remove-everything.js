// "Remove everything from this PC" (Settings → Setup Help): what it removes and what it leaves, and running it.
// Only what the app set up is removed: PostgreSQL and Tailscale only when "Set up this PC" installed them
// (noted in installed-by-app.json), otherwise just the app's own database and login, and the access "Let other
// PCs connect" added. A final backup can be made first. The app itself and its settings go last, once it has
// closed (ipc/remove-everything.js). No Electron here, so it can be tested on its own (tests/remove-everything.test.js).
const fs = require('fs');
const path = require('path');
const { notRunning } = require('./leftovers');

const INSTALLED_FILE = 'installed-by-app.json';
const CONFIRM_WORD = 'DELETE';

// What "Set up this PC" installed: { postgres: { port } | null, tailscale: bool }.
function readInstalled(dir, fsys = fs) {
  try {
    const saved = JSON.parse(fsys.readFileSync(path.join(dir, INSTALLED_FILE), 'utf8'));
    return { postgres: saved.postgres || null, tailscale: !!saved.tailscale };
  } catch {
    return { postgres: null, tailscale: false };
  }
}

// Notes what was just installed, keeping earlier notes. what: { postgres?: { port }, tailscale?: true }.
function recordInstalled(dir, what, fsys = fs) {
  const now = readInstalled(dir, fsys);
  if (what.postgres) now.postgres = what.postgres;
  if (what.tailscale) now.tailscale = true;
  fsys.writeFileSync(path.join(dir, INSTALLED_FILE), JSON.stringify(now, null, 2));
}

// After removing them: what's no longer there. what: { postgres, tailscale } (true for removed).
function forgetInstalled(dir, what, fsys = fs) {
  const now = readInstalled(dir, fsys);
  if (what.postgres) now.postgres = null;
  if (what.tailscale) now.tailscale = false;
  fsys.writeFileSync(path.join(dir, INSTALLED_FILE), JSON.stringify(now, null, 2));
}

// facts: { installed (readInstalled), connection: { host, port, database, user } | null, dbOnThisPc,
// postgresHere, tailscaleHere, otherDatabases: [names] (in the same PostgreSQL), packaged, movedAway }.
// movedAway: { port, movedTo } when the app's database moved away from this PC and its old copy is still in this
// PC's PostgreSQL (its note says 'moved'), otherwise null. That copy is removed like the app's own database.
function removalPlan(facts) {
  const c = facts.connection;
  const local = !!c && facts.dbOnThisPc;
  const movedAway = !local && !!c && facts.movedAway ? facts.movedAway : null;
  const here = local || !!movedAway;
  const port = (movedAway && Number(movedAway.port)) || (c && Number(c.port)) || 5432;
  const installedPort = facts.installed.postgres && Number(facts.installed.postgres.port);
  const ours = installedPort === port;
  const removePostgres = here && facts.postgresHere && !!ours;
  const dropDatabase = here && !removePostgres;
  const undoConnections = here && facts.postgresHere && !removePostgres;
  const canRemoveTailscale = facts.installed.tailscale && facts.tailscaleHere;
  const what = movedAway ? `the copy of "${c.database}" left here when the database moved to ${movedAway.movedTo}` : `"${c && c.database}"`;
  const removes = [];
  const keeps = [];
  if (removePostgres) {
    const others = facts.otherDatabases || [];
    removes.push(`PostgreSQL, with every database in it (${what}${others.length ? `, and also ${others.map((d) => `"${d}"`).join(', ')}` : ''})`);
  }
  // PostgreSQL's own administrator login is never removed, so it isn't listed.
  if (dropDatabase) {
    const login = c.user !== 'postgres' ? ` and its login "${c.user}"` : '';
    removes.push(movedAway ? `The copy of the "${c.database}" database left here when it moved to ${movedAway.movedTo}${login}` : `The "${c.database}" database${login}`);
  }
  if (undoConnections) removes.push('Other PCs\' access to this PC\'s PostgreSQL (the firewall rule and the lines the app added)');
  removes.push('The daily backup and Discord alert tasks');
  removes.push('The app\'s settings, including the saved connection');
  if (facts.packaged) removes.push('The app itself');
  if (facts.postgresHere && !removePostgres) {
    keeps.push(installedPort && !here
      ? 'PostgreSQL itself (none of the app\'s databases is in it now; Settings → Database → Leftovers from moving the database can remove it)'
      : 'PostgreSQL itself (the app didn\'t install it, so other things may use it)');
  }
  if (c && !facts.dbOnThisPc) keeps.push(`The database on ${c.host} (it's on another PC)`);
  if (facts.tailscaleHere && !canRemoveTailscale) keeps.push('Tailscale (the app didn\'t install it)');
  keeps.push('Your backup files');
  keeps.push('The plugin (remove it in the game\'s plugin list)');
  return {
    removePostgres, dropDatabase, undoConnections, canRemoveTailscale, port,
    database: here ? c.database : null,
    user: here ? c.user : null,
    movedAway: !!movedAway,
    offerBackup: local,
    needsMasterPassword: dropDatabase,
    otherPcsLoseDatabase: local,
    removes, keeps,
  };
}

// The steps the screen lists, in order: [{ id, label }]. choices: { backup, removeTailscale }.
function removalSteps(plan, choices = {}) {
  const steps = [];
  if (plan.offerBackup && choices.backup) steps.push({ id: 'backup', label: 'Make a final backup' });
  if (plan.dropDatabase) steps.push({ id: 'database', label: `Remove ${plan.movedAway ? 'the copy of ' : ''}the "${plan.database}" database and its login` });
  steps.push({ id: 'tasks', label: 'Remove the backup and alert tasks' });
  const admin = [
    plan.removePostgres && 'remove PostgreSQL',
    plan.canRemoveTailscale && choices.removeTailscale && 'remove Tailscale',
    plan.undoConnections && 'stop letting other PCs in',
  ].filter(Boolean);
  if (admin.length) steps.push({ id: 'admin', label: `${admin.join(', ').replace(/^./, (ch) => ch.toUpperCase())} (Windows asks for permission)` });
  return steps;
}

// Drops the app's database and its login. admin: a connected client logged in as PostgreSQL's administrator.
// PostgreSQL's own databases and administrator logins are never dropped. Returns { ok } or { ok: false, error }.
const NAME = /^[a-z_][a-z0-9_]{0,62}$/;
async function dropDatabase(admin, { database, user }) {
  if (!NAME.test(database || '') || ['postgres', 'template0', 'template1'].includes(database)) return { ok: false, error: `"${database}" isn't a database the app can remove.` };
  const me = (await admin.query('SELECT rolsuper FROM pg_roles WHERE rolname = current_user')).rows[0];
  if (!me || !me.rolsuper) return { ok: false, error: "That login isn't PostgreSQL's administrator. Use the password chosen when PostgreSQL was installed." };
  const formatted = async (template, value) => (await admin.query(`SELECT format('${template}', $1::text) AS s`, [value])).rows[0].s;
  const version = Number((await admin.query('SHOW server_version_num')).rows[0].server_version_num);
  // Other PCs (and the plugin) may still be connected: PostgreSQL 13 and later can drop it anyway.
  if (version >= 130000) {
    await admin.query(await formatted('DROP DATABASE IF EXISTS %I WITH (FORCE)', database));
  } else {
    await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [database]);
    await admin.query(await formatted('DROP DATABASE IF EXISTS %I', database));
  }
  const role = (await admin.query('SELECT rolsuper FROM pg_roles WHERE rolname = $1', [user])).rows[0];
  if (role && !role.rolsuper && NAME.test(user) && user !== 'postgres') {
    try {
      await admin.query(await formatted('DROP ROLE %I', user));
    } catch (err) {
      return { ok: true, note: `The database is removed, but its login "${user}" couldn't be: ${err.message}` };
    }
  }
  return { ok: true, note: role && role.rolsuper ? `The login "${user}" is one of PostgreSQL's administrators, so it was left.` : null };
}

// Runs it. input: { backup, backupFolder, removeTailscale, masterPassword, confirm }. deps (for the tests):
// platform, facts(), makeBackup(folder), connectAdmin({ port, password }), isMovedAwayCopy({ port, password, database }), removeTasks(), runElevated(steps,
// onProgress), forgetInstalled({ postgres, tailscale }). report(steps) as it goes. Stops at the first step that fails, so nothing is
// removed without the final backup the user asked for.
async function removeEverything(input, deps, report = () => {}) {
  if ((deps.platform || process.platform) !== 'win32') return { ok: false, error: 'Removing everything can only be done on Windows.' };
  if (String(input.confirm || '').trim() !== CONFIRM_WORD) return { ok: false, error: `Type ${CONFIRM_WORD} to confirm.` };
  const plan = removalPlan(await deps.facts());
  if (plan.needsMasterPassword && !input.masterPassword) return { ok: false, error: "Enter PostgreSQL's master password, so the database and its login can be removed." };
  if (plan.offerBackup && input.backup && !String(input.backupFolder || '').trim()) return { ok: false, error: 'Choose a folder for the final backup.' };
  const steps = removalSteps(plan, input).map((s) => ({ ...s, state: 'waiting', detail: '' }));
  const set = (id, state, detail = '') => {
    const s = steps.find((x) => x.id === id);
    if (s) { s.state = state; s.detail = detail; }
    report(steps.map((x) => ({ ...x })));
  };
  const fail = (id, message) => { set(id, 'failed', message); return { ok: false, error: message, steps, plan }; };
  report(steps.map((x) => ({ ...x })));

  if (steps.some((s) => s.id === 'backup')) {
    set('backup', 'working', 'backing up...');
    const b = await deps.makeBackup(input.backupFolder.trim());
    if (!b.ok) return fail('backup', `The final backup didn't work, so nothing was removed: ${b.message}`);
    set('backup', 'done', b.file ? `Saved as ${b.file}` : '');
  }

  if (plan.dropDatabase) {
    set('database', 'working', 'removing...');
    let admin;
    try {
      admin = await deps.connectAdmin({ port: plan.port, password: input.masterPassword });
    } catch (err) {
      if (err.code === '28P01') return fail('database', 'PostgreSQL refused the master password. It\'s the password chosen when PostgreSQL was installed.');
      if (notRunning(err)) return fail('database', "PostgreSQL isn't running on this PC, so nothing was removed. Start it again (restarting the PC does that) and try again.");
      return fail('database', `Couldn't reach PostgreSQL: ${err.message}`);
    }
    try {
      // Only a copy the move left behind: never a database that is in use again.
      if (plan.movedAway && !(await deps.isMovedAwayCopy({ port: plan.port, password: input.masterPassword, database: plan.database }))) {
        return fail('database', `"${plan.database}" on this PC is no longer a copy left by moving the database, so nothing was removed.`);
      }
      const r = await dropDatabase(admin, { database: plan.database, user: plan.user });
      if (!r.ok) return fail('database', r.error);
      set('database', 'done', r.note || '');
    } catch (err) {
      return fail('database', `The database couldn't be removed: ${err.message}`);
    } finally {
      await admin.end().catch(() => {});
    }
  }

  set('tasks', 'working');
  const t = await deps.removeTasks();
  if (!t.ok) return fail('tasks', t.error);
  set('tasks', 'done');

  const adminSteps = [];
  if (plan.removePostgres) adminSteps.push({ kind: 'removePostgres', port: plan.port });
  if (plan.canRemoveTailscale && input.removeTailscale) adminSteps.push({ kind: 'removeTailscale' });
  if (plan.undoConnections) adminSteps.push({ kind: 'undoOpenConnections', port: plan.port });
  if (adminSteps.length) {
    set('admin', 'working', 'waiting for Windows\' permission...');
    const r = await deps.runElevated(adminSteps, (results) => {
      const last = results[results.length - 1];
      if (last) set('admin', 'working', last.message);
    });
    if (!r.results) return fail('admin', r.error);
    const failed = r.results.filter((x) => !x.ok);
    if (failed.length) return fail('admin', failed.map((x) => x.message).join(' '));
    set('admin', 'done', r.results.map((x) => x.message).join(' '));
    deps.forgetInstalled({ postgres: plan.removePostgres, tailscale: plan.canRemoveTailscale && !!input.removeTailscale });
  }
  return { ok: true, steps, plan };
}

// The line the script writes first once it's running, which the app waits for before it closes.
const FINISH_RUNNING = 'The clean-up is running';

// The PowerShell that finishes once the app has closed: closes anything of the app's still running, runs
// its uninstaller (found in Windows' list of installed programs, as Installed apps does; none when run from
// source), waits until its program folder is gone, and deletes its settings folder. Each step is written to
// `log` (%TEMP%\xiv-fleet-remove.log), so a removal that didn't finish can be looked into. `folders`: other folders
// of the app's to delete with its settings (where it downloads new versions).
// Run with -Launch, it only starts itself again through Windows' process service (WMI), hidden, and says so in
// the log. Started that way it isn't one of the app's own processes, which Windows may stop along with the app.
// installDir: the app's program folder (null when run from source).
function finishScript({ pid, installDir, userData, folders = [], log }) {
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const lines = [
    '# XIV Fleet Companion: Remove everything from this PC, the last part. Once the app has closed, this',
    '# uninstalls it and deletes its settings folder, writing each step to the log below.',
    'param([switch]$Launch)',
    `$log = ${q(log)}`,
    "function Log($m) { Add-Content -LiteralPath $log -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  ' + $m) }",
    'if ($Launch) {',
    "  $startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }",
    "  $command = '\"' + (Join-Path $PSHOME 'powershell.exe') + '\" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File \"' + $PSCommandPath + '\"'",
    '  $r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $command; ProcessStartupInformation = $startup }',
    "  if ($r.ReturnValue -ne 0) { Log ('Windows could not start the clean-up (code ' + $r.ReturnValue + ')'); [Console]::Error.WriteLine('Windows could not start the clean-up (code ' + $r.ReturnValue + ').'); exit 1 }",
    "  Log ('Windows started the clean-up (process ' + $r.ProcessId + ')')",
    '  exit 0',
    '}',
    "trap { Log ('The clean-up stopped: ' + $_); [Console]::Error.WriteLine('' + $_); exit 1 }",
    `Log '${FINISH_RUNNING}: waiting for the app to close'`,
    `Wait-Process -Id ${Number(pid)} -Timeout 60 -ErrorAction SilentlyContinue`,
    // Never remove anything from under an app that is still open.
    `if (Get-Process -Id ${Number(pid)} -ErrorAction SilentlyContinue) { Log 'The app is still open, so nothing was removed'; exit 1 }`,
  ];
  if (installDir) {
    const exe = `${installDir}\\*`;
    lines.push(
      `Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -like ${q(exe)} } | Stop-Process -Force -ErrorAction SilentlyContinue`,
      'Start-Sleep -Seconds 2',
      "$entry = Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall' -ErrorAction SilentlyContinue | Get-ItemProperty -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like 'XIV Fleet Companion*' } | Select-Object -First 1",
      // QuietUninstallString: "C:\\...\\Uninstall XIV Fleet Companion.exe" /currentuser /S
      "if ($entry -and $entry.QuietUninstallString -match '^\\s*\"([^\"]+)\"\\s*(.*)$') { $file = $Matches[1]; $args2 = @($Matches[2] -split ' ' | Where-Object { $_ }); if (-not $args2) { $args2 = @('/S') }; Log ('Running ' + $file + ' ' + ($args2 -join ' ')); Start-Process -FilePath $file -ArgumentList $args2 -Wait }",
      `elseif ($u = Get-ChildItem -LiteralPath ${q(installDir)} -Filter 'Uninstall*.exe' -ErrorAction SilentlyContinue | Select-Object -First 1) { Log ('Running ' + $u.FullName + ' /S'); Start-Process -FilePath $u.FullName -ArgumentList '/S' -Wait }`,
      "else { Log 'No uninstaller found' }",
      // The uninstaller hands over to a copy of itself and returns early: wait (up to 3 minutes) for it to finish.
      `for ($i = 0; $i -lt 90 -and (Get-ChildItem -LiteralPath ${q(installDir)} -Filter '*.exe' -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Seconds 2 }`,
      `if (Get-ChildItem -LiteralPath ${q(installDir)} -Filter '*.exe' -ErrorAction SilentlyContinue) { Log 'The app is still installed' } else { Log 'The app is removed'; Remove-Item -LiteralPath ${q(installDir)} -Recurse -Force -ErrorAction SilentlyContinue }`,
    );
  }
  lines.push(
    // A moment for anything still holding a file there to let go.
    `for ($i = 0; $i -lt 10 -and (Test-Path -LiteralPath ${q(userData)}); $i++) { Remove-Item -LiteralPath ${q(userData)} -Recurse -Force -ErrorAction SilentlyContinue; if (Test-Path -LiteralPath ${q(userData)}) { Start-Sleep -Seconds 2 } }`,
    `if (Test-Path -LiteralPath ${q(userData)}) { Log ('Could not delete ' + ${q(userData)}) } else { Log 'The settings folder is deleted' }`,
    ...folders.map((f) => `if (Test-Path -LiteralPath ${q(f)}) { Remove-Item -LiteralPath ${q(f)} -Recurse -Force -ErrorAction SilentlyContinue; if (Test-Path -LiteralPath ${q(f)}) { Log ('Could not delete ' + ${q(f)}) } else { Log ('Deleted ' + ${q(f)}) } }`),
    "Log 'Done'",
    // Only once it has finished: if anything stops it on the way, this file stays to be looked at.
    'Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue',
  );
  return lines.join('\n');
}

// Starts the script (saved by the caller) and waits until it says it's running, so the app closes only then.
// deps: launch() runs it with -Launch and gives { code, out }; readLog() gives the log so far; wait(ms).
async function startFinish(deps, { tries = 60 } = {}) {
  const r = await deps.launch();
  if (r.code !== 0) return { ok: false, error: `The removal couldn't start: ${r.out || `PowerShell stopped with code ${r.code}`}` };
  for (let i = 0; i < tries; i++) {
    if (deps.readLog().includes(FINISH_RUNNING)) return { ok: true };
    await deps.wait(500);
  }
  return {
    ok: false,
    error: "The removal was started but didn't get going, so the app stays open and nothing of it was removed. "
      + 'Windows Security may have stopped it: look in its Protection history. What happened is in %TEMP%\\xiv-fleet-remove.log.',
  };
}

module.exports = {
  INSTALLED_FILE, CONFIRM_WORD, readInstalled, recordInstalled, forgetInstalled, removalPlan, removalSteps, dropDatabase, removeEverything, finishScript,
  FINISH_RUNNING, startFinish,
};
