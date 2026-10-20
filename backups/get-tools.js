// Settings → Backups → Get the backup tools: for a PC without PostgreSQL (one that only runs the app), so it
// can make the daily backup and restore one. Downloads PostgreSQL's Windows zip from its maker (checksum
// checked, as Set up this PC does), keeps only pg_dump, pg_restore and the files they need in the app's own
// folder (tools.js finds them there), and deletes the download. Nothing is installed and Windows doesn't ask
// for permission. No Electron here, so it can be tested on its own (tests/get-tools.test.js).
const fs = require('fs');
const path = require('path');

// What pg_dump and pg_restore load from the zip's bin folder (measured with dumpbin on GitHub's Windows test
// machine for each version; the numbers in some names change between versions), and the licences of those
// libraries when the zip has them. REQUIRED must all be there.
const KEEP = /^pgsql\/(bin\/(pg_dump\.exe|pg_restore\.exe|libpq\.dll|libintl-\d+\.dll|libiconv-\d+\.dll|libwinpthread-\d+\.dll|liblz4\.dll|libzstd\.dll|zlib1\.dll|libcrypto-[\w-]+\.dll|libssl-[\w-]+\.dll)|commandlinetools_3rd_party_licenses\.txt)$/;
const REQUIRED = ['pg_dump.exe', 'pg_restore.exe', 'libpq.dll'];

// Windows' "a DLL it needs is missing" (0xC0000135): here, Microsoft's Visual C++ runtime, which comes with
// most games and with PostgreSQL's own installer but isn't in the zip.
const DLL_NOT_FOUND = 0xC0000135;

const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

// The PowerShell that copies the files KEEP matches out of the zip into `dest` (Windows' own zip reader, so nothing
// else is unpacked).
function extractScript(zip, dest) {
  return [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -AssemblyName System.IO.Compression.FileSystem',
    `$keep = ${psQuote(KEEP.source)}`,
    `$zip = [IO.Compression.ZipFile]::OpenRead(${psQuote(zip)})`,
    'try {',
    '  foreach ($e in $zip.Entries) {',
    `    if ($e.FullName -cmatch $keep) { [IO.Compression.ZipFileExtensions]::ExtractToFile($e, (Join-Path ${psQuote(dest)} $e.Name), $true) }`,
    '  }',
    '} finally { $zip.Dispose() }',
  ].join('\n');
}

// Which download to get for a database whose `SHOW server_version_num` is versionNum: { file } (from
// toolsDownloadFor, setup/installers.js) or { message } when there is none for its version. The tools match the
// database's version, as on the PC that has it: a newer pg_restore sends settings an older server doesn't know.
function chooseDownload(versionNum, { toolsDownloadFor, toolsMajors }) {
  const major = Math.floor(Number(versionNum) / 10000);
  const file = toolsDownloadFor(major);
  if (file) return { file };
  const majors = toolsMajors();
  return { message: `The database runs PostgreSQL ${major || 'of an unknown version'}. The app can get the backup tools for PostgreSQL ${Math.min(...majors)} to ${Math.max(...majors)} only.` };
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
    const missing = REQUIRED.filter((name) => !fs.existsSync(path.join(fresh, name)));
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

module.exports = { KEEP, REQUIRED, DLL_NOT_FOUND, extractScript, chooseDownload, getTools };
