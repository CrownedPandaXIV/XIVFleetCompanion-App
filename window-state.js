// Remembers the window's size and place (window.json in the settings folder), so the app opens where it was left.
// A place that's no longer on any screen (a screen unplugged, or set up differently) is not used: the window then
// opens at its usual size, in the middle of the main screen. No Electron here, so it is tested on its own
// (tests/window-state.test.js).
const fs = require('fs');

const DEFAULT = { width: 1000, height: 700 };
const MIN = { width: 640, height: 420 };
// How much of the window's top must be on a screen to use the saved place: enough to grab it and move it.
const VISIBLE = { width: 120, height: 40 };

// { x, y, width, height, maximized } from the file, or null when there's none or it can't be read.
function readWindowState(file) {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    const n = (v) => Number.isFinite(v);
    if (!s || !n(s.width) || !n(s.height)) return null;
    return {
      x: n(s.x) ? Math.round(s.x) : undefined,
      y: n(s.y) ? Math.round(s.y) : undefined,
      width: Math.round(s.width),
      height: Math.round(s.height),
      maximized: s.maximized === true,
    };
  } catch {
    return null;
  }
}

function writeWindowState(file, state) {
  try {
    fs.writeFileSync(`${file}.new`, JSON.stringify(state));
    fs.renameSync(`${file}.new`, file);
  } catch (err) {
    console.error("Couldn't remember the window's size and place:", err.message);
  }
}

// Whether the top of `b` overlaps one of the screens' work areas ([{ x, y, width, height }]) enough to grab it.
function onAScreen(b, areas) {
  return areas.some((a) => {
    const w = Math.min(b.x + b.width, a.x + a.width) - Math.max(b.x, a.x);
    const top = b.y >= a.y && b.y <= a.y + a.height - VISIBLE.height;
    return w >= VISIBLE.width && top;
  });
}

// The BrowserWindow options for the saved state on these screens: { width, height, x?, y? }, and whether to maximize.
function windowOptions(saved, areas) {
  if (!saved) return { bounds: { ...DEFAULT }, maximized: false };
  const largest = areas.reduce((m, a) => Math.max(m, a.width), 0) || DEFAULT.width;
  const tallest = areas.reduce((m, a) => Math.max(m, a.height), 0) || DEFAULT.height;
  const width = Math.min(Math.max(saved.width, MIN.width), largest);
  const height = Math.min(Math.max(saved.height, MIN.height), tallest);
  const bounds = { width, height };
  if (saved.x !== undefined && saved.y !== undefined && onAScreen({ x: saved.x, y: saved.y, width, height }, areas)) {
    bounds.x = saved.x;
    bounds.y = saved.y;
  }
  return { bounds, maximized: saved.maximized };
}

module.exports = { readWindowState, writeWindowState, windowOptions, DEFAULT, MIN };
