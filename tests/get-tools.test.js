// Settings → Backups → Get the backup tools (backups/get-tools.js), with the download, the unpacking and the
// tools themselves pretended. The real download, unpacking and a backup and restore with the tools run on
// Windows in the installer job of .github/workflows/test.yml (tests/windows/backup-tools.js).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { KEEP, DLL_NOT_FOUND, extractScript, getTools } = require('../backups/get-tools');

const file = { url: 'https://example.com/postgresql-18.6-5-windows-x64-binaries.zip', sha256: 'AB' };

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-get-tools-'));
  return { root, dir: path.join(root, 'postgres-tools'), tempDir: path.join(root, 'downloads') };
}

// download writes a pretend zip; powershell "unpacks" by writing the files named in the script.
const deps = ({ leaveOut = [], version = { ok: true, code: 0, stdout: 'pg_dump (PostgreSQL) 18.6\n', stderr: '' } } = {}) => ({
  download: async (f, dest, onProgress) => { onProgress(0.5); fs.writeFileSync(dest, 'zip'); return dest; },
  powershell: async (script) => {
    const dest = /Join-Path '([^']+)'/.exec(script)[1];
    for (const k of KEEP) if (!leaveOut.includes(path.basename(k))) fs.writeFileSync(path.join(dest, path.basename(k)), 'x');
    return { ok: true, stdout: '', stderr: '' };
  },
  version: async () => version,
});

test('gets the tools into the app folder, deletes the download, and says what it is doing', async () => {
  const { dir, tempDir } = setup();
  const said = [];
  const r = await getTools({ file, dir, tempDir, deps: deps(), onProgress: (text) => said.push(text) });
  assert.deepStrictEqual(r, { ok: true, bin: dir, version: 'pg_dump (PostgreSQL) 18.6' });
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), KEEP.map((k) => path.basename(k)).sort(), 'pg_dump, pg_restore, their libraries and the licences, nothing else');
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

test('the unpacking takes only those files, with paths quoted for PowerShell', () => {
  const script = extractScript("C:\\Users\\Pat's\\z.zip", "C:\\Users\\Pat's\\tools.new");
  for (const k of KEEP) assert.ok(script.includes(`'${k}'`), k);
  assert.ok(script.includes("OpenRead('C:\\Users\\Pat''s\\z.zip')") && script.includes("Join-Path 'C:\\Users\\Pat''s\\tools.new'"));
  assert.ok(script.includes('$zip.Dispose()'), 'the zip is closed so it can be deleted');
});
