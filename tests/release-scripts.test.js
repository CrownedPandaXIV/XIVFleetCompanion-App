// .github/scripts/published.sh, publish-installer.sh and tag-release.sh against a stand-in for the gh command that
// keeps the releases in a file (nothing is published): when a version counts as published, that a release left half
// done is finished, and the release notes.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPTS = path.join(__dirname, '..', '.github', 'scripts');

// The stand-in gh: releases are { tag: { draft, assets: [names], notes, target } } in state.json.
const FAKE_GH = `#!/usr/bin/env node
const fs = require('fs');
const file = process.env.FAKE_GH_STATE;
const state = JSON.parse(fs.readFileSync(file, 'utf8'));
const save = () => fs.writeFileSync(file, JSON.stringify(state));
const args = process.argv.slice(2);
fs.appendFileSync(file + '.calls', args.join(' ') + '\\n');
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const [cmd, sub, tag] = args;
if (cmd !== 'release') { console.error('fake gh: no ' + cmd); process.exit(2); }
const files = args.slice(3).filter((a, i, all) => !a.startsWith('-') && !['-R', '--notes', '--title', '--target', '--json', '--jq'].includes(all[i - 1]));
const r = state[tag];
if (sub === 'view') {
  if (!r) { console.error('release not found'); process.exit(1); }
  const json = flag('--json');
  if (json) {
    const all = { body: r.notes, isDraft: r.draft, assets: r.assets.map((name) => ({ name })) };
    const out = Object.fromEntries(json.split(',').map((k) => [k, all[k]]));
    console.log(flag('--jq') === '.body' ? out.body : JSON.stringify(out));
  }
} else if (sub === 'create') {
  // As the real one: a release with files is made as a draft, the files go up, then it's published. FAKE_GH_DROP
  // names a file whose upload fails (the network dropping), leaving the draft.
  state[tag] = { draft: files.length > 0, assets: [], notes: flag('--notes') || '', target: flag('--target') };
  for (const f of files) {
    if (process.env.FAKE_GH_DROP && f.endsWith(process.env.FAKE_GH_DROP)) { save(); console.error('upload failed'); process.exit(1); }
    state[tag].assets.push(path.basename(f));
  }
  state[tag].draft = false;
} else if (sub === 'upload') {
  for (const f of files) if (!r.assets.includes(path.basename(f))) r.assets.push(path.basename(f));
} else if (sub === 'edit') {
  if (flag('--notes') !== undefined) r.notes = flag('--notes');
  if (args.includes('--draft=false')) r.draft = false;
}
save();
`.replace("const fs = require('fs');", "const fs = require('fs'); const path = require('path');");

function setup(releases = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-scripts-'));
  fs.mkdirSync(path.join(dir, 'dist'));
  fs.mkdirSync(path.join(dir, 'bin'));
  fs.writeFileSync(path.join(dir, 'bin', 'gh'), FAKE_GH, { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(releases));
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '# Changelog\n\n## 1.11.0 - 2026-11-21\n\n- **New** things.\n\n## 1.10.6 - 2026-11-20\n\n- Older.\n');
  const run = (script, args, env = {}) => {
    const r = spawnSync('bash', [path.join(SCRIPTS, script), ...args], {
      cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: `${dir}/bin:${process.env.PATH}`, FAKE_GH_STATE: path.join(dir, 'state.json'), ...env },
    });
    return { status: r.status, out: (r.stdout + r.stderr).trim() };
  };
  const state = () => JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
  const build = (v) => {
    for (const f of [`XIV-Fleet-Companion-Setup-${v}.exe`, `XIV-Fleet-Companion-Setup-${v}.exe.blockmap`]) fs.writeFileSync(path.join(dir, 'dist', f), 'x');
    fs.writeFileSync(path.join(dir, 'dist', 'latest.yml'), `version: ${v}\n`);
  };
  return { dir, run, state, build, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const ALL = ['XIV-Fleet-Companion-Setup-1.11.0.exe', 'XIV-Fleet-Companion-Setup-1.11.0.exe.blockmap', 'latest.yml'];

test('a version counts as published only when its release is out of draft with all three files', () => {
  const cases = [
    [{}, 'no'],
    [{ 'v1.11.0': { draft: false, assets: ALL } }, 'yes'],
    [{ 'v1.11.0': { draft: true, assets: ALL } }, 'no'],
    [{ 'v1.11.0': { draft: false, assets: ['latest.yml'] } }, 'no'],
    [{ 'v1.11.0': { draft: false, assets: ALL.slice(0, 2) } }, 'no'],
  ];
  for (const [releases, want] of cases) {
    const s = setup(releases);
    const r = s.run('published.sh', ['1.11.0']);
    s.done();
    assert.strictEqual(r.out, want, JSON.stringify(releases));
  }
});

test('a release cut off while the installer went up is finished by the next run', () => {
  const s = setup();
  s.build('1.11.0');
  const cut = s.run('publish-installer.sh', ['1.11.0'], { FAKE_GH_DROP: '.exe' });
  assert.notStrictEqual(cut.status, 0);
  assert.strictEqual(s.state()['v1.11.0'].draft, true, 'left as a draft');
  assert.strictEqual(s.run('published.sh', ['1.11.0']).out, 'no', 'so the next run publishes it');
  const again = s.run('publish-installer.sh', ['1.11.0']);
  assert.strictEqual(again.status, 0, again.out);
  const r = s.state()['v1.11.0'];
  assert.deepStrictEqual([r.draft, [...r.assets].sort()], [false, [...ALL].sort()]);
  assert.strictEqual(r.notes, '- **New** things.');
  assert.strictEqual(s.run('published.sh', ['1.11.0']).out, 'yes');
  s.done();
});

test('the installer is not published without all three files built', () => {
  const s = setup();
  const r = s.run('publish-installer.sh', ['1.11.0']);
  assert.notStrictEqual(r.status, 0);
  assert.match(r.out, /Missing dist\/XIV-Fleet-Companion-Setup-1\.11\.0\.exe/);
  assert.deepStrictEqual(s.state(), {});
  s.done();
});

test('tag-release makes the release once, with the changelog section as its notes, and fills in an empty one', () => {
  const s = setup();
  assert.strictEqual(s.run('tag-release.sh', ['1.11.0', 'abc123']).status, 0);
  assert.deepStrictEqual(s.state()['v1.11.0'], { draft: false, assets: [], notes: '- **New** things.', target: 'abc123' });
  assert.strictEqual(s.run('tag-release.sh', ['1.11.0', 'abc123']).out, 'v1.11.0 is already released; nothing to do.');
  const st = s.state(); st['v1.11.0'].notes = '';
  fs.writeFileSync(path.join(s.dir, 'state.json'), JSON.stringify(st));
  s.run('tag-release.sh', ['1.11.0', 'abc123']);
  assert.strictEqual(s.state()['v1.11.0'].notes, '- **New** things.');
  s.run('tag-release.sh', ['1.12.0', 'def456']);
  assert.strictEqual(s.state()['v1.12.0'].notes, 'Version 1.12.0', 'a version with no changelog section says only its number');
  s.done();
});
