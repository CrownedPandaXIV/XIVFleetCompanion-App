// "What's new": reads CHANGELOG.md (shipped with the app) into versions the window can show, and works out which
// versions someone hasn't seen yet. Only the little the changelog uses is understood: paragraphs, "- " list items
// (continued on lines indented by two spaces; "  - " items under one), **bold** and `code`. Everything comes out
// as plain text pieces, never HTML. No Electron here (tests/changelog.test.js).

// "**Bold** and `code`" -> [{ text, bold?, code? }].
function inline(text) {
  const parts = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let at = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > at) parts.push({ text: text.slice(at, m.index) });
    parts.push(m[1] !== undefined ? { text: m[1], bold: true } : { text: m[2], code: true });
    at = re.lastIndex;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts;
}

// The changelog's text -> [{ version, date, blocks: [{ type: 'p' | 'li', parts, sub? }] }], newest first (as
// written); sub: true for an item under another.
function parseChangelog(text) {
  const versions = [];
  let current = null;
  let block = null;
  const finish = () => {
    if (block && current) current.blocks.push({ type: block.type, parts: inline(block.lines.join(' ')), ...(block.sub ? { sub: true } : {}) });
    block = null;
  };
  for (const raw of String(text || '').split(/\r?\n/)) {
    const heading = /^## (\d+\.\d+\.\d+)(?:\s+-\s+(.*))?$/.exec(raw);
    if (heading) {
      finish();
      current = { version: heading[1], date: (heading[2] || '').trim(), blocks: [] };
      versions.push(current);
      continue;
    }
    if (!current) continue;
    if (/^#/.test(raw)) { finish(); continue; }
    if (raw.trim() === '') { finish(); continue; }
    const item = /^(\s*)- (.*)$/.exec(raw);
    if (item) {
      finish();
      block = { type: 'li', lines: [item[2].trim()], sub: item[1].length > 0 };
    } else if (block && /^\s+\S/.test(raw)) {
      block.lines.push(raw.trim());
    } else {
      if (!block || block.type !== 'p') { finish(); block = { type: 'p', lines: [] }; }
      block.lines.push(raw.trim());
    }
  }
  finish();
  return versions;
}

// -1, 0 or 1 for "1.4.10" against "1.5.0". A test version ("1.6.0-test.3") counts as its version number, so it
// shows that version's changes.
function compareVersions(a, b) {
  const parts = (v) => String(v || '0').split('-')[0].split('.').map(Number);
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

// The versions to show someone now on `current` who last saw `seen` (null: unknown, so only `current`): every
// version after `seen` up to `current`, newest first.
function versionsSince(versions, seen, current) {
  return versions.filter((v) => compareVersions(v.version, current) <= 0
    && (seen ? compareVersions(v.version, seen) > 0 : compareVersions(v.version, current) === 0));
}

module.exports = { parseChangelog, compareVersions, versionsSince };
