// .github/scripts/publish-testing.sh against a stand-in for the gh command (nothing is published): what it puts on
// the "testing" release, in what order, and when a normal release leaves a newer test version alone.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '.github', 'scripts', 'publish-testing.sh');

// A folder with a built installer for `version`, and a gh that logs each call; `release` is what the testing
// release already holds ({ assets, latest }) or null.
function run(version, mode, release) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-testing-'));
  fs.mkdirSync(path.join(dir, 'dist'));
  fs.mkdirSync(path.join(dir, 'bin'));
  for (const f of [`XIV-Fleet-Companion-Setup-${version}.exe`, `XIV-Fleet-Companion-Setup-${version}.exe.blockmap`]) fs.writeFileSync(path.join(dir, 'dist', f), 'x');
  fs.writeFileSync(path.join(dir, 'dist', 'latest.yml'), `version: ${version}\n`);
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '# Changelog\n\n## 1.6.0 - unreleased\n\n- Something new.\n\n## 1.5.0 - 2026-10-20\n\n- Older.\n');
  fs.writeFileSync(path.join(dir, 'bin', 'gh'), `#!/usr/bin/env bash
echo "gh $*" | tr '\\n' ' ' >> "${dir}/calls"; echo >> "${dir}/calls"
case "$1 $2" in
  "release view")
    ${release ? '' : 'exit 1'}
    if [[ "$*" == *--json* ]]; then printf '%s\\n' ${(release && release.assets || []).map((a) => `'${a}'`).join(' ')}; fi ;;
  "release download") ${release && release.latest ? `echo "version: ${release.latest}"` : 'exit 1'} ;;
esac
exit 0
`, { mode: 0o755 });
  const r = spawnSync('bash', [SCRIPT, version, ...(mode ? [mode] : [])], { cwd: dir, env: { ...process.env, PATH: `${dir}/bin:${process.env.PATH}` }, encoding: 'utf8' });
  const calls = fs.existsSync(path.join(dir, 'calls')) ? fs.readFileSync(path.join(dir, 'calls'), 'utf8').trim().split('\n') : [];
  fs.rmSync(dir, { recursive: true, force: true });
  return { status: r.status, out: r.stdout + r.stderr, calls };
}

test('a test version: the release is made as a pre-release, the installer goes up before latest.yml, older installers go', () => {
  const r = run('1.6.0-test.4', null, { assets: ['XIV-Fleet-Companion-Setup-1.6.0-test.3.exe', 'XIV-Fleet-Companion-Setup-1.6.0-test.3.exe.blockmap', 'latest.yml'] });
  assert.strictEqual(r.status, 0, r.out);
  const uploads = r.calls.filter((c) => c.startsWith('gh release upload'));
  assert.ok(uploads[0].includes('XIV-Fleet-Companion-Setup-1.6.0-test.4.exe ') && uploads[1].includes('dist/latest.yml'), 'installer first, then latest.yml: ' + uploads.join(' | '));
  const edit = r.calls.find((c) => c.startsWith('gh release edit testing'));
  assert.ok(edit.includes('--prerelease') && edit.includes('--latest=false') && edit.includes('Test version 1.6.0-test.4') && edit.includes('Something new.'), edit);
  const deleted = r.calls.filter((c) => c.startsWith('gh release delete-asset')).map((c) => c.split(' ')[4]);
  assert.deepStrictEqual(deleted, ['XIV-Fleet-Companion-Setup-1.6.0-test.3.exe', 'XIV-Fleet-Companion-Setup-1.6.0-test.3.exe.blockmap']);
  const lastUpload = r.calls.lastIndexOf(uploads[1]);
  assert.ok(r.calls.findIndex((c) => c.startsWith('gh release delete-asset')) > lastUpload, 'older installers go only after latest.yml points at the new one');
});

test('with no testing release yet, it is created as a pre-release that is never "Latest"', () => {
  const r = run('1.6.0-test.1', null, null);
  assert.strictEqual(r.status, 0, r.out);
  const create = r.calls.find((c) => c.startsWith('gh release create testing'));
  assert.ok(create && create.includes('--prerelease') && create.includes('--latest=false'), String(create));
});

test('a normal release goes to the testing release only when it is newer than the test version there', () => {
  const newer = run('1.6.0', '--if-newer', { assets: [], latest: '1.6.0-test.9' });
  assert.strictEqual(newer.status, 0, newer.out);
  assert.ok(newer.calls.some((c) => c.includes('dist/latest.yml')), '1.6.0 replaces 1.6.0-test.9');
  const older = run('1.5.1', '--if-newer', { assets: [], latest: '1.6.0-test.9' });
  assert.strictEqual(older.status, 0, older.out);
  assert.ok(!older.calls.some((c) => c.startsWith('gh release upload')) && /left alone/.test(older.out), 'a newer test version stays');
});

test('a missing installer stops it before anything is published', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-testing-'));
  const r = spawnSync('bash', [SCRIPT, '1.6.0-test.1'], { cwd: dir, encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stdout, /Missing dist\//);
});
