// Runs setup steps that need administrator rights: installing PostgreSQL and Tailscale (setup/installers.js),
// "Let other PCs connect" (setup/remote-access.js), and removing them again (Remove everything). The app starts a second copy of itself with --fleet-setup
// through Windows' permission prompt (one prompt for all the steps), hands it the steps in a small file, and
// reads back how each went while it works. That copy opens no window and quits when done.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');
const { run } = require('../backups/tools');
const { parseServices, instanceForPort, firewallDeleteArgs, applyRemoteAccess, undoRemoteAccess } = require('./remote-access');
const {
  postgresCommand, tailscaleCommand, installSucceeded, TAILSCALE_PRODUCT, productCodeFrom, tailscaleUninstallCommand, postgresUninstallCommand,
} = require('./installers');

const FLAG = '--fleet-setup';

const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;
const powershell = (script) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]);
const LIST_SERVICES = "Get-CimInstance Win32_Service -Filter \"Name LIKE 'postgresql%'\" | ForEach-Object { $_.Name + '|' + $_.PathName }";

// The PowerShell that starts this app again with administrator rights and waits for it.
// appDir: the app's folder when run from source (electron.exe <folder>); null for the installed app.
function elevateScript(exePath, appDir, requestFile) {
  const args = `${appDir ? `"${appDir}" ` : ''}${FLAG} "${requestFile}"`;
  // Stop on any error, so a turned-down prompt is reported as a failure.
  return `$ErrorActionPreference = 'Stop'; Start-Process -FilePath ${psQuote(exePath)} -ArgumentList ${psQuote(args)} -Verb RunAs -Wait -WindowStyle Hidden`;
}

// What the user sees when Windows' prompt was turned down or failed.
function describeElevationError(output) {
  if (/cancel/i.test(output)) return "Windows' permission prompt was turned down, so nothing was changed.";
  return `Windows couldn't start the change: ${String(output).trim()}`;
}

// PostgreSQL's Windows services: [{ service, dataDir }].
async function postgresServices() {
  return parseServices((await powershell(LIST_SERVICES)).stdout);
}

// The non-administrator side. steps: [{ kind: 'installPostgres', installer, optionFile } |
// { kind: 'installTailscale', msi } | { kind: 'openConnections', port, ranges } | { kind: 'removePostgres', port } |
// { kind: 'removeTailscale' } | { kind: 'undoOpenConnections', port }]. keepGoing: carry on after a step fails
// (removing). onProgress(results so far) is called as steps finish. Returns { ok, results: [{ kind, ok,
// message, changed? }] } or { ok: false, error }.
async function runElevated(steps, { exePath, appDir, onProgress = () => {}, workDir, keepGoing = false } = {}) {
  if (process.platform !== 'win32') return { ok: false, error: 'This can only be done on Windows.' };
  const dir = workDir || fs.mkdtempSync(path.join(os.tmpdir(), 'xiv-fleet-'));
  const requestFile = path.join(dir, 'request.json');
  const resultFile = path.join(dir, 'result.json');
  const progressFile = path.join(dir, 'progress.json');
  fs.writeFileSync(requestFile, JSON.stringify({ steps, keepGoing, resultFile, progressFile }));
  let last = '';
  const poll = setInterval(() => {
    try {
      const text = fs.readFileSync(progressFile, 'utf8');
      if (text !== last) { last = text; onProgress(JSON.parse(text)); }
    } catch { /* not written yet */ }
  }, 1000);
  try {
    const started = await powershell(elevateScript(exePath, appDir, requestFile));
    const output = `${started.stderr}${started.stdout}`;
    if (!started.ok || /cancel/i.test(output)) return { ok: false, error: describeElevationError(output) };
    if (!fs.existsSync(resultFile)) return { ok: false, error: 'The setup finished without saying how it went. Try again.' };
    return JSON.parse(fs.readFileSync(resultFile, 'utf8'));
  } finally {
    clearInterval(poll);
    if (!workDir) fs.rmSync(dir, { recursive: true, force: true });
  }
}

// "Let other PCs connect" on its own (Setup Help).
async function letOtherPcsConnect({ port, ranges, exePath, appDir }) {
  if (process.platform !== 'win32') return { ok: false, error: 'This can only be done on Windows.' };
  if (!(await postgresServices()).length) return { ok: false, error: "PostgreSQL isn't installed on this PC as a Windows service, so there's nothing here to set up." };
  const r = await runElevated([{ kind: 'openConnections', port, ranges }], { exePath, appDir });
  if (!r.results) return r;
  const step = r.results[0];
  return step.ok ? { ok: true, changed: step.changed } : { ok: false, error: step.message, changed: step.changed || [] };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Removes the PostgreSQL that uses step.port with its own uninstaller, then its data folder (the databases),
// which the uninstaller leaves behind, and the firewall rule. Only folders that are plainly PostgreSQL's are
// deleted: the data folder must hold PG_VERSION, and the program folder must sit in a "PostgreSQL" folder.
async function removePostgres(step, deps) {
  const fsys = deps.fs || fs;
  const wait = deps.wait || sleep;
  const instance = instanceForPort(await deps.listServices(), Number(step.port) || 5432, fsys);
  if (!instance) return { kind: step.kind, ok: true, message: 'PostgreSQL was already gone.' };
  const [uninstaller, args] = instance.installDir ? postgresUninstallCommand(instance.installDir) : [null];
  if (!uninstaller || !fsys.existsSync(uninstaller)) {
    return { kind: step.kind, ok: false, message: `Couldn't find PostgreSQL's uninstaller, so it wasn't removed. Remove "PostgreSQL" in Windows' Installed apps instead.` };
  }
  await deps.run('sc.exe', ['stop', instance.service]);
  const r = await deps.run(uninstaller, args);
  if (!installSucceeded(r.code)) {
    return { kind: step.kind, ok: false, message: `PostgreSQL's uninstaller stopped with code ${r.code}. ${(r.stderr || r.stdout).trim()}`.trim() };
  }
  // The uninstaller may hand over to a copy of itself and return early: wait (up to 3 minutes) until it's done.
  for (let i = 0; i < 90 && fsys.existsSync(uninstaller); i++) await wait(2000);
  if (fsys.existsSync(path.join(instance.dataDir, 'PG_VERSION'))) fsys.rmSync(instance.dataDir, { recursive: true, force: true });
  const parent = path.dirname(instance.installDir);
  if (/^postgresql$/i.test(path.basename(parent))) {
    if (fsys.existsSync(instance.installDir)) fsys.rmSync(instance.installDir, { recursive: true, force: true });
    // The "PostgreSQL" folder around it, once nothing else is in it.
    if (fsys.existsSync(parent) && fsys.readdirSync(parent).length === 0) fsys.rmdirSync(parent);
  }
  await deps.run('netsh.exe', firewallDeleteArgs());
  return { kind: step.kind, ok: true, message: 'PostgreSQL and its databases are removed.' };
}

// One step, with administrator rights. deps (for the tests): run, listServices, and for removing, fs and wait.
async function runStep(step, deps) {
  if (step.kind === 'installPostgres') {
    const [file, args] = postgresCommand(step.installer, step.optionFile);
    const r = await deps.run(file, args);
    return installSucceeded(r.code)
      ? { kind: step.kind, ok: true, message: 'PostgreSQL is installed.' }
      : { kind: step.kind, ok: false, message: `PostgreSQL's installer stopped with code ${r.code}. ${(r.stderr || r.stdout).trim()}`.trim() };
  }
  if (step.kind === 'installTailscale') {
    const [file, args] = tailscaleCommand(step.msi);
    const r = await deps.run(file, args);
    return installSucceeded(r.code)
      ? { kind: step.kind, ok: true, message: 'Tailscale is installed.' }
      : { kind: step.kind, ok: false, message: `Tailscale's installer stopped with code ${r.code}.` };
  }
  if (step.kind === 'openConnections') {
    const services = await deps.listServices();
    const r = await applyRemoteAccess({ port: step.port, ranges: step.ranges, services }, { run: deps.run });
    return r.ok
      ? { kind: step.kind, ok: true, message: 'Other PCs can connect.', changed: r.changed }
      : { kind: step.kind, ok: false, message: r.error, changed: r.changed || [] };
  }
  if (step.kind === 'removePostgres') return removePostgres(step, deps);
  if (step.kind === 'removeTailscale') {
    const code = productCodeFrom((await deps.run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', TAILSCALE_PRODUCT])).stdout);
    if (!code) return { kind: step.kind, ok: true, message: 'Tailscale was already gone.' };
    const [file, args] = tailscaleUninstallCommand(code);
    const r = await deps.run(file, args);
    return installSucceeded(r.code)
      ? { kind: step.kind, ok: true, message: 'Tailscale is removed.' }
      : { kind: step.kind, ok: false, message: `Tailscale's uninstaller stopped with code ${r.code}.` };
  }
  if (step.kind === 'undoOpenConnections') {
    const r = await undoRemoteAccess({ port: step.port, services: await deps.listServices() }, { run: deps.run, fs: deps.fs });
    return r.ok
      ? { kind: step.kind, ok: true, message: r.changed.length ? 'Other PCs are no longer let in.' : 'Other PCs weren\'t let in, so nothing to undo.', changed: r.changed }
      : { kind: step.kind, ok: false, message: r.error, changed: r.changed || [] };
  }
  return { kind: step.kind, ok: false, message: `Unknown step "${step.kind}".` };
}

// Runs the steps in order, stopping at the first that fails unless keepGoing. report(results) after each.
async function runSteps(steps, deps, report = () => {}, { keepGoing = false } = {}) {
  const results = [];
  for (const step of steps) {
    let result;
    try {
      result = await runStep(step, deps);
    } catch (err) {
      result = { kind: step.kind, ok: false, message: err.message };
    }
    results.push(result);
    report(results);
    if (!result.ok && !keepGoing) break;
  }
  return { ok: results.length === steps.length && results.every((r) => r.ok), results };
}

// The administrator side, started with --fleet-setup <request file>.
async function runFromCommandLine() {
  const requestFile = process.argv[process.argv.indexOf(FLAG) + 1];
  let request = null;
  let result;
  try {
    request = JSON.parse(fs.readFileSync(requestFile, 'utf8'));
    const report = (results) => { try { fs.writeFileSync(request.progressFile, JSON.stringify(results)); } catch { /* best effort */ } };
    result = await runSteps(request.steps, { run, listServices: postgresServices }, report, { keepGoing: !!request.keepGoing });
  } catch (err) {
    result = { ok: false, error: err.message, results: [] };
  }
  try {
    if (request && request.resultFile) fs.writeFileSync(request.resultFile, JSON.stringify(result));
  } catch (err) {
    console.error('Could not write the result:', err.message);
  }
  app.exit(result.ok ? 0 : 1);
}

module.exports = { FLAG, elevateScript, describeElevationError, runElevated, letOtherPcsConnect, runStep, runSteps, postgresServices, runFromCommandLine };
