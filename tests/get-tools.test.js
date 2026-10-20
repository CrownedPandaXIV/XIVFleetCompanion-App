// Settings → Backups → Get the backup tools (backups/get-tools.js), with the download, the unpacking and the
// tools themselves pretended. The real download, unpacking and a backup and restore with the tools run on
// Windows in the installer job of .github/workflows/test.yml (tests/windows/backup-tools.js).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { KEEP, REQUIRED, DLL_NOT_FOUND, extractScript, chooseDownload, getTools } = require('../backups/get-tools');
const installers = require('../setup/installers');

const file = { url: 'https://example.com/postgresql-18.6-5-windows-x64-binaries.zip', sha256: 'AB' };

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-get-tools-'));
  return { root, dir: path.join(root, 'postgres-tools'), tempDir: path.join(root, 'downloads') };
}

// What PostgreSQL 18.6's zip has that the tools need (measured with dumpbin), as the pretend unpacking writes.
const UNPACKED = ['pg_dump.exe', 'pg_restore.exe', 'libpq.dll', 'libintl-9.dll', 'libiconv-2.dll', 'libwinpthread-1.dll',
  'liblz4.dll', 'libzstd.dll', 'zlib1.dll', 'libcrypto-3-x64.dll', 'libssl-3-x64.dll', 'commandlinetools_3rd_party_licenses.txt'];

// download writes a pretend zip; powershell "unpacks" by writing UNPACKED.
const deps = ({ leaveOut = [], version = { ok: true, code: 0, stdout: 'pg_dump (PostgreSQL) 18.6\n', stderr: '' } } = {}) => ({
  download: async (f, dest, onProgress) => { onProgress(0.5); fs.writeFileSync(dest, 'zip'); return dest; },
  powershell: async (script) => {
    const dest = /Join-Path '([^']+)'/.exec(script)[1];
    for (const name of UNPACKED) if (!leaveOut.includes(name)) fs.writeFileSync(path.join(dest, name), 'x');
    return { ok: true, stdout: '', stderr: '' };
  },
  version: async () => version,
});

test('gets the tools into the app folder, deletes the download, and says what it is doing', async () => {
  const { dir, tempDir } = setup();
  const said = [];
  const r = await getTools({ file, dir, tempDir, deps: deps(), onProgress: (text) => said.push(text) });
  assert.deepStrictEqual(r, { ok: true, bin: dir, version: 'pg_dump (PostgreSQL) 18.6' });
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), [...UNPACKED].sort());
  assert.deepStrictEqual(fs.readdirSync(tempDir), [], 'the 367 MB download is deleted');
  assert.ok(!fs.existsSync(`${dir}.new`));
  assert.deepStrictEqual(said, ['Downloading...', 'Downloading... 50%', 'Unpacking...', 'Checking they run...']);
});

test('tools that are already there stay until the new ones work', async () => {
  const { dir, tempDir } = setup();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'pg_dump.exe'), 'old');
  const missing = await getTools({ file, dir, tempDir, deps: deps({ leaveOut: ['libpq.dll'] }) });
  assert.strictEqual(missing.ok, false);
  assert.match(missing.message, /couldn't be unpacked \(libpq\.dll not in it\)/);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'pg_dump.exe'), 'utf8'), 'old');
  assert.ok(!fs.existsSync(`${dir}.new`) && fs.readdirSync(tempDir).length === 0, 'nothing left behind');
});

test("Microsoft's Visual C++ runtime missing is said plainly", async () => {
  const { dir, tempDir } = setup();
  for (const code of [DLL_NOT_FOUND, DLL_NOT_FOUND | 0]) {  // Node may give it as 3221225781 or -1073741515
    const r = await getTools({ file, dir, tempDir, deps: deps({ version: { ok: false, code, stdout: '', stderr: '' } }) });
    assert.strictEqual(r.ok, false);
    assert.match(r.message, /Visual C\+\+ runtime/);
  }
  assert.ok(!fs.existsSync(dir), 'tools that do not run are not kept');
});

test('a failed download is reported and leaves nothing behind', async () => {
  const { dir, tempDir } = setup();
  const failing = { ...deps(), download: async () => { throw new Error("Couldn't download it: the download site answered 404"); } };
  const r = await getTools({ file, dir, tempDir, deps: failing });
  assert.deepStrictEqual(r, { ok: false, message: "Couldn't download it: the download site answered 404" });
  assert.ok(!fs.existsSync(dir) && !fs.existsSync(`${dir}.new`));
});

test('the unpacking takes only the tools, their libraries and the licences, in every version', () => {
  // Each version's zip as measured (the names of some libraries change between versions).
  const needed = {
    14: ['libcrypto-1_1-x64.dll', 'libiconv-2.dll', 'libintl-9.dll', 'libpq.dll', 'libssl-1_1-x64.dll', 'libwinpthread-1.dll', 'zlib1.dll'],
    18: ['libcrypto-3-x64.dll', 'libiconv-2.dll', 'libintl-9.dll', 'liblz4.dll', 'libpq.dll', 'libssl-3-x64.dll', 'libwinpthread-1.dll', 'libzstd.dll'],
  };
  for (const names of Object.values(needed)) {
    for (const name of [...names, 'pg_dump.exe', 'pg_restore.exe']) assert.ok(KEEP.test(`pgsql/bin/${name}`), name);
  }
  assert.ok(KEEP.test('pgsql/commandlinetools_3rd_party_licenses.txt'));
  for (const other of ['pgsql/bin/icudt77.dll', 'pgsql/bin/wxmsw3211u_core_vc_x64_custom.dll', 'pgsql/bin/postgres.exe', 'pgsql/bin/psql.exe',
    'pgsql/bin/libxml2.dll', 'pgsql/pgAdmin 4/runtime/pg_dump.exe', 'pgsql/pgAdmin 4/runtime/libpq.dll', 'pgsql/bin/libpq.lib']) {
    assert.ok(!KEEP.test(other), `not ${other}`);
  }
  assert.deepStrictEqual(REQUIRED, ['pg_dump.exe', 'pg_restore.exe', 'libpq.dll']);
});

test('the download matches the version the database runs', () => {
  assert.strictEqual(chooseDownload('140024', installers).file.url, 'https://get.enterprisedb.com/postgresql/postgresql-14.24-4-windows-x64-binaries.zip');
  assert.strictEqual(chooseDownload(180006, installers).file.version, '18.6');
  for (const major of installers.toolsMajors()) {
    const { file } = chooseDownload(major * 10000 + 1, installers);
    assert.ok(file.url.includes(`postgresql-${major}.`) && /^[0-9A-F]{64}$/.test(file.sha256) && file.sizeMb > 300, `${major}: ${file.url}`);
  }
  assert.deepStrictEqual(chooseDownload(130012, installers), { message: 'The database runs PostgreSQL 13. The app can get the backup tools for PostgreSQL 14 to 18 only.' });
});

test('the unpacking script quotes paths for PowerShell', () => {
  const script = extractScript("C:\\Users\\Pat's\\z.zip", "C:\\Users\\Pat's\\tools.new");
  assert.ok(script.includes(`$keep = '${KEEP.source}'`) && script.includes('-cmatch $keep'));
  assert.ok(script.includes("OpenRead('C:\\Users\\Pat''s\\z.zip')") && script.includes("Join-Path 'C:\\Users\\Pat''s\\tools.new'"));
  assert.ok(script.includes('$zip.Dispose()'), 'the zip is closed so it can be deleted');
});
