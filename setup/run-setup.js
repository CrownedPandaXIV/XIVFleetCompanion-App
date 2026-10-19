// Runs "Set up this PC" from start to finish: works out what's already installed, downloads what's missing,
// installs it and lets other PCs connect (one Windows permission prompt), makes the database and the app's
// login, and saves the connection. Each step's progress goes to `report` for the setup screen.
// deps (for the tests): detect, download, runElevated, recordInstalled, connectAdmin, createDatabase, saveConfig, wait,
// platform, arch.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { setupPlan, downloadFor, postgresOptions, DOWNLOADS } = require('./installers');

// The steps the setup screen lists for a plan, in order: [{ id, label }].
function stepsFor(plan) {
  const steps = [];
  if (plan.installPostgres) steps.push({ id: 'downloadPostgres', label: `Download ${DOWNLOADS.postgres.name} (about ${DOWNLOADS.postgres.sizeMb} MB)` });
  if (plan.installTailscale) steps.push({ id: 'downloadTailscale', label: `Download Tailscale (about ${DOWNLOADS.tailscale.sizeMb} MB)` });
  const admin = [plan.installPostgres && 'install PostgreSQL', plan.installTailscale && 'install Tailscale', plan.openConnections && 'let other PCs connect'].filter(Boolean);
  if (admin.length) steps.push({ id: 'admin', label: `${admin.join(', ').replace(/^./, (c) => c.toUpperCase())} (Windows asks for permission)` });
  if (plan.createDatabase) steps.push({ id: 'database', label: 'Make the database and the app\'s login' });
  return steps;
}

// Where downloads are kept until they're installed, so trying again doesn't download them again.
const downloadDir = () => path.join(os.tmpdir(), 'xiv-fleet-downloads');

// input: { role, sameNetwork, masterPassword, appPassword, database, user, port }
async function runSetup(input, deps, report = () => {}) {
  const platform = deps.platform || process.platform;
  if (platform !== 'win32') return { ok: false, error: 'Setting up this PC can only be done on Windows.' };
  const installed = await deps.detect();
  const plan = setupPlan(input.role, { sameNetwork: input.sameNetwork, installed });
  if (!plan) return { ok: false, error: 'Choose what this PC is for first.' };
  const port = Number(input.port) || 5432;
  const steps = stepsFor(plan).map((s) => ({ ...s, state: 'waiting', detail: '' }));
  const set = (id, state, detail = '') => {
    const s = steps.find((x) => x.id === id);
    if (s) { s.state = state; s.detail = detail; }
    report(steps.map((x) => ({ ...x })));
  };
  const fail = (id, message) => { set(id, 'failed', message); return { ok: false, error: message, steps, plan }; };
  report(steps.map((x) => ({ ...x })));

  const dir = deps.downloadDir || downloadDir();
  fs.mkdirSync(dir, { recursive: true });
  const files = {};
  for (const what of ['postgres', 'tailscale']) {
    if (!(what === 'postgres' ? plan.installPostgres : plan.installTailscale)) continue;
    const id = what === 'postgres' ? 'downloadPostgres' : 'downloadTailscale';
    const file = downloadFor(what, deps.arch || process.arch);
    if (!file) return fail(id, `${DOWNLOADS[what].name} has no Windows version for this PC's processor.`);
    set(id, 'working', 'starting...');
    try {
      files[what] = await deps.download(file, path.join(dir, path.basename(new URL(file.url).pathname)),
        (f) => set(id, 'working', f === null ? 'downloading...' : `${Math.round(f * 100)}%`));
      set(id, 'done');
    } catch (err) {
      return fail(id, err.message);
    }
  }

  const adminSteps = [];
  let optionDir = null;
  if (plan.installPostgres) {
    optionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiv-fleet-pg-'));
    const optionFile = path.join(optionDir, 'options.txt');
    fs.writeFileSync(optionFile, postgresOptions(input.masterPassword, port));
    adminSteps.push({ kind: 'installPostgres', installer: files.postgres, optionFile });
  }
  if (plan.installTailscale) adminSteps.push({ kind: 'installTailscale', msi: files.tailscale });
  if (plan.openConnections) adminSteps.push({ kind: 'openConnections', port, ranges: deps.ranges() });
  if (adminSteps.length) {
    set('admin', 'working', 'waiting for Windows\' permission...');
    let r;
    try {
      r = await deps.runElevated(adminSteps, (results) => {
        const lastDone = results[results.length - 1];
        if (lastDone) set('admin', 'working', lastDone.message);
      });
    } finally {
      // The option file holds the master password: gone as soon as PostgreSQL's installer has read it.
      if (optionDir) fs.rmSync(optionDir, { recursive: true, force: true });
    }
    if (!r.results) return fail('admin', r.error);
    // Noted so "Remove everything" knows it may remove them (and never a PostgreSQL that was already here),
    // even when a later step failed.
    const installed = new Set(r.results.filter((x) => x.ok).map((x) => x.kind));
    if (installed.has('installPostgres') || installed.has('installTailscale')) {
      deps.recordInstalled({ postgres: installed.has('installPostgres') ? { port } : undefined, tailscale: installed.has('installTailscale') });
    }
    const failed = r.results.find((x) => !x.ok);
    if (failed) return fail('admin', failed.message);
    set('admin', 'done', r.results.map((x) => x.message).join(' '));
    for (const f of Object.values(files)) fs.rmSync(f, { force: true });
  }

  if (plan.createDatabase) {
    set('database', 'working', 'waiting for PostgreSQL to start...');
    let admin = null;
    let lastError = null;
    for (let i = 0; i < 30 && !admin; i++) {
      try {
        admin = await deps.connectAdmin({ port, password: input.masterPassword });
      } catch (err) {
        lastError = err;
        // A wrong master password won't get better by waiting.
        if (err.code === '28P01') break;
        await deps.wait(2000);
      }
    }
    if (!admin) {
      return fail('database', lastError && lastError.code === '28P01'
        ? "PostgreSQL refused the master password. If PostgreSQL was already on this PC, it's the password chosen when it was installed."
        : `PostgreSQL didn't answer: ${lastError ? lastError.message : 'unknown error'}`);
    }
    try {
      const made = await deps.createDatabase(admin, { database: input.database, user: input.user, password: input.appPassword });
      if (!made.ok) return fail('database', made.error);
    } finally {
      await admin.end().catch(() => {});
    }
    deps.saveConfig({ host: 'localhost', port, database: input.database, user: input.user, password: input.appPassword });
    set('database', 'done', `"${input.database}" is ready.`);
  }
  return { ok: true, steps, plan };
}

module.exports = { stepsFor, runSetup, downloadDir };
