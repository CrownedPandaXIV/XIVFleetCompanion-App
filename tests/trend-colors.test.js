// The trend charts draw on a canvas, which can't read CSS variables (var(--...)): a line given one draws as
// nothing useful. Every chart line colour must be a plain #rrggbb.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('every trend line colour is a plain hex colour a canvas can draw', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'trends.jsx'), 'utf8');
  const match = source.match(/const TREND_COLORS = \[([^\]]*)\]/);
  assert.ok(match, 'TREND_COLORS not found in renderer/trends.jsx');
  const colours = match[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
  assert.ok(colours.length >= 1);
  for (const c of colours) assert.match(c, /^#[0-9a-f]{6}$/i, `${c} is not a plain #rrggbb colour`);
});
