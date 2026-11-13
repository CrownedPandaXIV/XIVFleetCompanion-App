// The window opens where it was left (window-state.js), unless that place is no longer on a screen.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readWindowState, writeWindowState, windowOptions, DEFAULT, MIN } = require('../window-state');

const oneScreen = [{ x: 0, y: 0, width: 1920, height: 1040 }];
const twoScreens = [...oneScreen, { x: 1920, y: 0, width: 2560, height: 1400 }];

test('the first time, the usual size, placed by Windows', () => {
  assert.deepStrictEqual(windowOptions(null, oneScreen), { bounds: { ...DEFAULT }, maximized: false });
});

test('a saved size and place on a screen are used, maximized too', () => {
  const saved = { x: 2000, y: 100, width: 1600, height: 900, maximized: true };
  assert.deepStrictEqual(windowOptions(saved, twoScreens), { bounds: { x: 2000, y: 100, width: 1600, height: 900 }, maximized: true });
});

test('a place on a screen that is gone opens on the main screen instead, at the saved size', () => {
  const saved = { x: 2000, y: 100, width: 1600, height: 900, maximized: false };
  assert.deepStrictEqual(windowOptions(saved, oneScreen), { bounds: { width: 1600, height: 900 }, maximized: false });
});

test('a window whose title bar is off the top or bottom of the screen is not put back there', () => {
  assert.deepStrictEqual(windowOptions({ x: 100, y: -300, width: 1000, height: 700 }, oneScreen).bounds, { width: 1000, height: 700 });
  assert.deepStrictEqual(windowOptions({ x: 100, y: 1030, width: 1000, height: 700 }, oneScreen).bounds, { width: 1000, height: 700 });
  // Mostly off to the side, but enough of the top still on the screen to grab it.
  assert.deepStrictEqual(windowOptions({ x: -800, y: 50, width: 1000, height: 700 }, oneScreen).bounds, { x: -800, y: 50, width: 1000, height: 700 });
});

test('a size bigger than any screen, or too small to use, is brought within reason', () => {
  assert.deepStrictEqual(windowOptions({ x: 0, y: 0, width: 5000, height: 3000 }, oneScreen).bounds, { x: 0, y: 0, width: 1920, height: 1040 });
  assert.deepStrictEqual(windowOptions({ x: 0, y: 0, width: 10, height: 10 }, oneScreen).bounds, { x: 0, y: 0, width: MIN.width, height: MIN.height });
});

test('saved and read back; a missing or damaged file reads as none', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'window-state-'));
  try {
    const file = path.join(dir, 'window.json');
    assert.strictEqual(readWindowState(file), null);
    writeWindowState(file, { x: 10.4, y: 20, width: 1200, height: 800, maximized: true });
    assert.deepStrictEqual(readWindowState(file), { x: 10, y: 20, width: 1200, height: 800, maximized: true });
    assert.ok(!fs.existsSync(`${file}.new`));
    fs.writeFileSync(file, '{not json');
    assert.strictEqual(readWindowState(file), null);
    fs.writeFileSync(file, JSON.stringify({ width: 'wide' }));
    assert.strictEqual(readWindowState(file), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
