// Checks that the app's code files are wired together correctly. main.js and the window's code
// are split into one file per area (ipc/ and renderer/), so these catch a file that was added
// but never loaded, or two files that both declare the same name.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('main.js loads every ipc/ file', () => {
  const main = read('main.js');
  for (const file of fs.readdirSync(path.join(root, 'ipc')).filter((f) => f.endsWith('.js'))) {
    assert.ok(main.includes(`require('./ipc/${file.replace(/\.js$/, '')}')`), `main.js does not load ipc/${file}`);
  }
});

test('every call the window can make has exactly one handler', () => {
  const calls = [...read('preload.js').matchAll(/invoke\('([^']+)'/g)].map((m) => m[1]);
  const handlers = [];
  for (const file of fs.readdirSync(path.join(root, 'ipc')).filter((f) => f.endsWith('.js'))) {
    handlers.push(...[...read(`ipc/${file}`).matchAll(/ipcMain\.handle\('([^']+)'/g)].map((m) => m[1]));
  }
  assert.deepStrictEqual([...new Set(handlers)].sort(), handlers.slice().sort(), 'a call has two handlers');
  assert.deepStrictEqual(calls.filter((c) => !handlers.includes(c)), [], 'calls with no handler');
});

// The window's files are plain scripts sharing one scope, so the page must load every one of them,
// tables.js (shared pieces and the React hooks) first and app.js (which starts the app) last, and
// no two may declare the same top-level name (the page would stop with an error).
test('index.html loads every renderer file, tables first and app last', () => {
  const html = read('renderer/index.html');
  const loaded = [...html.matchAll(/<script src="([\w-]+)\.js"><\/script>/g)].map((m) => m[1]);
  const files = fs.readdirSync(path.join(root, 'renderer')).filter((f) => f.endsWith('.jsx')).map((f) => f.replace(/\.jsx$/, ''));
  assert.deepStrictEqual(loaded.slice().sort(), files.sort());
  assert.strictEqual(loaded[0], 'tables');
  assert.strictEqual(loaded[loaded.length - 1], 'app');
});

test('no two renderer files declare the same top-level name', () => {
  const seen = new Map();
  for (const file of fs.readdirSync(path.join(root, 'renderer')).filter((f) => f.endsWith('.jsx'))) {
    for (const m of read(`renderer/${file}`).matchAll(/^(?:async\s+)?(?:function\*?|const|let|var|class)\s+(?:\{([^}]*)\}|([\w$]+))/gm)) {
      const names = m[1] ? m[1].split(',').map((n) => n.split(':').pop().trim()).filter(Boolean) : [m[2]];
      for (const name of names) {
        assert.ok(!seen.has(name), `${name} is declared in both ${seen.get(name)} and ${file}`);
        seen.set(name, file);
      }
    }
  }
});
