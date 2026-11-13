// Starts the app against the scratch database, runs each scenario in tests/ui/scenarios, and
// reports. Needs the database ready (see tests/ui/README.md) and a display (xvfb-run on CI).
//   node tests/ui/run.js [scenario-name ...]
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { connect } = require('./harness');
const { Client } = require('pg');
const { ensureDatabase } = require('../../db/apply-updates');

// A scenario may export before(db) / after(db) to change the scratch database around its run, and
// setup() / teardown() plus env() (extra environment for the app, read after setup) for anything else,
// such as a relay between the app and the database that a scenario can cut.
async function withDb(fn) {
  if (!fn) return;
  const db = new Client();
  await db.connect();
  try { await fn(db); } finally { await db.end(); }
}

const PORT = 9333;
const dir = path.join(__dirname, 'scenarios');
const wanted = process.argv.slice(2);
const scenarios = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort()
  .filter((f) => !wanted.length || wanted.includes(f.replace(/\.js$/, '')));
const shotDir = process.env.UI_TEST_SHOTS || path.join(os.tmpdir(), 'fleet-ui-shots');

function startApp(profile, extraEnv = {}) {
  const electron = require('electron');
  const args = [path.join(__dirname, 'launcher.js'), `--remote-debugging-port=${PORT}`, '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'];
  const child = spawn(electron, args, { env: { ...process.env, ...extraEnv, UI_TEST_PROFILE: profile }, stdio: ['ignore', 'inherit', 'inherit'] });
  return child;
}

// The scratch database is made by db/schema.sql plus the fixtures, which add back the old snapshot table that
// plugins before 0.4.0 wrote (scenarios 12 and 13 read it). With that table there and no version recorded, the app
// won't update the database and shows a banner. A real database at this layout has its version recorded, so record
// it here first, as the app would without the old table, and every scenario starts the same, alone or in a full run.
async function recordDatabaseVersion() {
  await withDb(async (db) => {
    const { rows: [r] } = await db.query(`SELECT count(*)::int AS n FROM companion_schema_version`);
    if (r.n > 0) return;
    await db.query('ALTER TABLE companion_character_snapshot RENAME TO zz_hidden_snapshot');
    try {
      await ensureDatabase(db, { appVersion: require('../../package.json').version });
    } finally {
      await db.query('ALTER TABLE zz_hidden_snapshot RENAME TO companion_character_snapshot');
    }
  });
}

(async () => {
  let failed = 0;
  await recordDatabaseVersion();
  for (const file of scenarios) {
    const scenario = require(path.join(dir, file));
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-ui-'));
    let app;
    let t;
    try {
      await withDb(scenario.before);
      if (scenario.setup) await scenario.setup();
      app = startApp(profile, scenario.env ? scenario.env() : {});
      console.log(`\n=== ${file} ===`);
      t = await connect(PORT, path.join(shotDir, file.replace(/\.js$/, '')));
      t.profile = profile; // the app's data folder for this run (scenarios that start the app again use it)
      t.query = async (sql) => { let rows = []; await withDb(async (db) => { rows = (await db.query(sql)).rows; }); return rows; };
      await t.waitFor(`document.querySelectorAll('.sidebar-button').length>0`, 'the app to load', 60000);
      console.log('  app is up');
      // a stuck scenario must fail, not hang the whole run
      await Promise.race([
        scenario(t),
        new Promise((_, reject) => setTimeout(() => reject(new Error('scenario took longer than 3 minutes')), 180000)),
      ]);
      t.check(t.errors.length === 0, 'no console errors' + (t.errors.length ? ': ' + t.errors.join(' | ') : ''));
      if (t.failures.length) failed++;
    } catch (e) {
      console.log('SCENARIO ERROR:', e.stack.split('\n').slice(0, 4).join(' | '));
      failed++;
    } finally {
      try { t && t.close(); } catch (e) { /* ignore */ }
      if (app) app.kill();
      try { await withDb(scenario.after); } catch (e) { console.log('CLEANUP ERROR:', e.message); failed++; }
      try { if (scenario.teardown) await scenario.teardown(); } catch (e) { console.log('CLEANUP ERROR:', e.message); failed++; }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  console.log(failed ? `\n${failed} scenario(s) FAILED` : '\nALL UI SCENARIOS PASSED');
  process.exit(failed ? 1 : 0);
})();
