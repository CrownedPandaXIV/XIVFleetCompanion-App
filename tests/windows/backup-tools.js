// Get the backup tools for real, on GitHub's Windows test machine (installer job of .github/workflows/test.yml):
// asks the database its version, downloads PostgreSQL's zip in that version from its maker (checksum checked),
// keeps only the backup tools, then with only those backs up a database, test-loads the backup and restores it.
// The database is the test machine's own PostgreSQL (started by the workflow), an older one than the newest.
// Reads PGPORT, PGUSER, PGPASSWORD.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client } = require('pg');
const { chooseDownload, getTools } = require('../../backups/get-tools');
const installers = require('../../setup/installers');
const { findTools, run } = require('../../backups/tools');
const { backupNow, testBackup, restoreBackup } = require('../../backups/run');

const fail = (message) => { console.error(`FAILED: ${message}`); process.exit(1); };

(async () => {
  const base = { host: '127.0.0.1', port: Number(process.env.PGPORT || 5432), user: process.env.PGUSER, password: process.env.PGPASSWORD };
  const admin = new Client({ ...base, database: 'postgres' });
  await admin.connect();
  const versionNum = (await admin.query('SHOW server_version_num')).rows[0].server_version_num;
  const chosen = chooseDownload(versionNum, installers);
  if (!chosen.file) fail(chosen.message);
  console.log(`Server ${versionNum}: getting ${chosen.file.name} (${chosen.file.url})`);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-tools-'));
  const dir = path.join(root, 'postgres-tools');
  let last = '';
  const got = await getTools({
    file: chosen.file,
    dir,
    tempDir: path.join(root, 'downloads'),
    deps: {
      download: installers.downloadOnce,
      powershell: (script) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]),
      version: (dump) => run(dump, ['--version']),
    },
    onProgress: (text) => { if (text.replace(/\d+%$/, '') !== last.replace(/\d+%$/, '')) console.log(text); last = text; },
  });
  if (!got.ok) fail(got.message);
  console.log(`Got ${got.version}: ${fs.readdirSync(dir).join(', ')}`);
  if (fs.readdirSync(path.join(root, 'downloads')).length) fail('the download was not deleted');

  const tools = await findTools(dir);
  if (!tools.found || tools.bin !== dir) fail(`the tools were not found in ${dir}: ${tools.error}`);
  await admin.query('DROP DATABASE IF EXISTS fleet_tools_ci');
  await admin.query('CREATE DATABASE fleet_tools_ci');
  await admin.end();
  const config = { ...base, database: 'fleet_tools_ci' };
  const db = new Client(config);
  await db.connect();
  await db.query('CREATE TABLE companion_settings (k text PRIMARY KEY, v text); INSERT INTO companion_settings VALUES (\'a\', \'1\'), (\'b\', \'2\'), (\'c\', \'3\')');

  const folder = path.join(root, 'backups');
  fs.mkdirSync(folder);
  const settings = { folder, copyFolder: '', keep: 5 };
  const backup = await backupNow({ tools, config, settings });
  if (!backup.ok) fail(`backup: ${backup.message}`);
  console.log(`Backed up: ${path.basename(backup.file)} (${backup.size} bytes)`);
  const tested = await testBackup({ tools, config, file: backup.file });
  if (!tested.ok) fail(`test: ${tested.message}`);
  console.log(`Tested: ${tested.message}`);
  await db.query('INSERT INTO companion_settings VALUES (\'d\', \'4\')');
  const restored = await restoreBackup({ tools, config, settings, file: backup.file });
  if (!restored.ok) fail(`restore: ${restored.message}`);
  const n = Number((await db.query('SELECT count(*) AS n FROM companion_settings')).rows[0].n);
  await db.end();
  if (n !== 3) fail(`after restoring, ${n} rows instead of 3`);
  console.log('Backed up, tested and restored with only the downloaded tools.');
})().catch((err) => fail(err.stack));
