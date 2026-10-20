// Settings → Backups → Get the backup tools: for a PC without PostgreSQL (one that only runs the app), so it
// can make the daily backup and restore one. Downloads PostgreSQL's Windows zip from its maker (checksum
// checked, as Set up this PC does), keeps only pg_dump, pg_restore and the files they need in the app's own
// folder (tools.js finds them there), and deletes the download. Nothing is installed and Windows doesn't ask
// for permission. No Electron here, so it can be tested on its own (tests/get-tools.test.js).
const fs = require('fs');
const path = require('path');

// What pg_dump and pg_restore load from the zip's bin folder (measured with dumpbin on GitHub's Windows test
// machine), and the licences of the libraries among them.
const KEEP = [
  'pg_dump.exe', 'pg_restore.exe', 'libpq.dll', 'libintl-9.dll', 'libiconv-2.dll', 'libwinpthread-1.dll',
  'liblz4.dll', 'libzstd.dll', 'zlib1.dll', 'libcrypto-3-x64.dll', 'libssl-3-x64.dll',
].map((name) => `pgsql/bin/${name}`).concat('pgsql/commandlinetools_3rd_party_licenses.txt');

// Windows' "a DLL it needs is missing" (0xC0000135): here, Microsoft's Visual C++ runtime, which comes with
// most games and with PostgreSQL's own installer but isn't in the zip.
const DLL_NOT_FOUND = 0xC0000135;

const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

// The PowerShell that copies the files in KEEP out of the zip into `dest` (Windows' own zip reader, so nothing
// else is unpacked).
function extractScript(zip, dest) {
  return [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -AssemblyName System.IO.Compression.FileSystem',
    `$want = @(${KEEP.map(psQuote).join(', ')})`,
    `$zip = [IO.Compression.ZipFile]::OpenRead(${psQuote(zip)})`,
    'try {',
    '  foreach ($e in $zip.Entries) {',
    `    if ($want -contains $e.FullName) { [IO.Compression.ZipFileExtensions]::ExtractToFile($e, (Join-Path ${psQuote(dest)} $e.Name), $true) }`,
    '  }',
    '} finally { $zip.Dispose() }',
  ].join('\n');
}

// deps: { download(file, dest, onProgress), powershell(script) -> { ok, stderr }, version(dumpExe) -> { ok, code,
// stdout, stderr } }. dir: where the tools go (replaced only once the new ones work); tempDir: where the zip is
// downloaded (deleted afterwards). onProgress(text). Returns { ok, bin, version } or { ok: false, message }.
async function getTools({ file, dir, tempDir, deps, onProgress = () => {} }) {
  const zip = path.join(tempDir, path.basename(new URL(file.url).pathname));
  const fresh = `${dir}.new`;
  try {
    fs.mkdirSync(tempDir, { recursive: true });
    onProgress('Downloading...');
    await deps.download(file, zip, (f) => onProgress(f === null ? 'Downloading...' : `Downloading... ${Math.round(f * 100)}%`));
    onProgress('Unpacking...');
    fs.rmSync(fresh, { recursive: true, force: true });
    fs.mkdirSync(fresh, { recursive: true });
    const unpacked = await deps.powershell(extractScript(zip, fresh));
    const missing = KEEP.map((k) => path.basename(k)).filter((name) => !fs.existsSync(path.join(fresh, name)));
    if (!unpacked.ok || missing.length) {
      return { ok: false, message: `The download couldn't be unpacked${missing.length ? ` (${missing.join(', ')} not in it)` : ''}: ${(unpacked.stderr || '').trim() || 'no reason given'}` };
    }
    onProgress('Checking they run...');
    const v = await deps.version(path.join(fresh, 'pg_dump.exe'));
    if (!v.ok) {
      const code = v.code >>> 0;
      return {
        ok: false,
        message: code === DLL_NOT_FOUND
          ? "The tools need Microsoft's Visual C++ runtime, which isn't on this PC. Install \"Microsoft Visual C++ Redistributable\" (x64) from Microsoft's website, then try again."
          : `The tools didn't run: ${(v.stderr || v.stdout || `code ${code}`).trim()}`,
      };
    }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.renameSync(fresh, dir);
    return { ok: true, bin: dir, version: v.stdout.trim() };
  } catch (err) {
    return { ok: false, message: err.message };
  } finally {
    fs.rmSync(zip, { force: true });
    fs.rmSync(fresh, { recursive: true, force: true });
  }
}

module.exports = { KEEP, DLL_NOT_FOUND, extractScript, getTools };
