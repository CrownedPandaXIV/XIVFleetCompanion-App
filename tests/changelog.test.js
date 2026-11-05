// "What's new" (shared/changelog.js): the changelog read into versions, and which ones someone hasn't seen.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { parseChangelog, compareVersions, versionsSince } = require('../shared/changelog');

const SAMPLE = `# Changelog

All notable changes to the app are recorded here.

## 1.5.0 - 2026-10-20

No database or plugin change.

- **Any PC can make the backups.** Backups need
  PostgreSQL's own tools, kept in \`postgres-tools\`.
- A second item.
  - Under it, **bold
  over two lines**.

## 1.4.10 - 2026-10-19

- Fixed something.

## 1.4.9

Only a line.
`;

test('reads each version: paragraphs, list items continued over lines, bold and code', () => {
  const versions = parseChangelog(SAMPLE);
  assert.deepStrictEqual(versions.map((v) => [v.version, v.date]), [['1.5.0', '2026-10-20'], ['1.4.10', '2026-10-19'], ['1.4.9', '']]);
  assert.deepStrictEqual(versions[0].blocks, [
    { type: 'p', parts: [{ text: 'No database or plugin change.' }] },
    { type: 'li', parts: [{ text: 'Any PC can make the backups.', bold: true }, { text: " Backups need PostgreSQL's own tools, kept in " }, { text: 'postgres-tools', code: true }, { text: '.' }] },
    { type: 'li', parts: [{ text: 'A second item.' }] },
    { type: 'li', parts: [{ text: 'Under it, ' }, { text: 'bold over two lines', bold: true }, { text: '.' }], sub: true },
  ]);
  assert.deepStrictEqual(versions[2].blocks, [{ type: 'p', parts: [{ text: 'Only a line.' }] }]);
});

test('what to show: every version since the one last seen, or only this one when that is unknown', () => {
  const versions = parseChangelog(SAMPLE);
  assert.deepStrictEqual(versionsSince(versions, '1.4.9', '1.5.0').map((v) => v.version), ['1.5.0', '1.4.10'], '1.4.10 is after 1.4.9');
  assert.deepStrictEqual(versionsSince(versions, '1.5.0', '1.5.0'), []);
  assert.deepStrictEqual(versionsSince(versions, null, '1.5.0').map((v) => v.version), ['1.5.0']);
  assert.deepStrictEqual(versionsSince(versions, '1.4.9', '1.4.10').map((v) => v.version), ['1.4.10'], 'nothing newer than the running version');
  assert.strictEqual(compareVersions('1.4.10', '1.5.0'), -1);
  assert.strictEqual(compareVersions('2.0.0', '1.99.99'), 1);
});

test("the app's own changelog reads, with this version in it", () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8');
  const versions = parseChangelog(text);
  const { version } = require('../package.json');
  assert.strictEqual(versions[0].version, version, 'the newest entry is this version');
  assert.ok(versions.length > 50 && versions.every((v) => v.blocks.length > 0), 'every version has something');
  assert.ok(versions.every((v) => v.blocks.every((b) => b.parts.every((p) => !/^\s*-\s|\*\*/.test(p.text)))), 'no list marks or ** left in the text');
});
