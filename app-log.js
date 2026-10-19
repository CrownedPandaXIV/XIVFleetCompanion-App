// The app's log: what it prints (database updates, a move, Remove everything, update checks, errors) also goes
// to logs\app.log in its settings folder, so a problem can be looked into afterwards (Settings → Setup Help →
// Found a problem? → Open the log folder). Kept small: past MAX_BYTES the log becomes app.old.log and a new one
// starts, so there are never more than two. No Electron here, so it can be tested on its own
// (tests/app-log.test.js).
const fs = require('fs');
const path = require('path');
const util = require('util');

const LOG_NAME = 'app.log';
const OLD_NAME = 'app.old.log';
const MAX_BYTES = 1024 * 1024;

const pad = (n) => String(n).padStart(2, '0');
const stamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

// Never a password in the log, even if something prints one by mistake.
function scrub(text) {
  return text
    .replace(/(password|PGPASSWORD)(["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;}]+)/gi, '$1$2***')
    .replace(/(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s]+@/gi, '$1***@');
}

// One line of the log: the time, the level and the message (each value as console would print it).
function formatLine(level, args, now = new Date()) {
  const text = args.map((a) => (typeof a === 'string' ? a : util.inspect(a, { depth: 3, breakLength: Infinity }))).join(' ');
  return `${stamp(now)}  ${level.padEnd(5)}  ${scrub(text).replace(/\r?\n/g, '\n                            ')}`;
}

// A log in `folder`. write(level, args) adds a line; it never throws (the log is a help, never a reason to fail).
function createLog(folder, { fsys = fs, maxBytes = MAX_BYTES, now = () => new Date() } = {}) {
  const file = path.join(folder, LOG_NAME);
  const old = path.join(folder, OLD_NAME);
  return {
    folder,
    file,
    write(level, args) {
      try {
        fsys.mkdirSync(folder, { recursive: true });
        let size = 0;
        try { size = fsys.statSync(file).size; } catch { /* a new log */ }
        if (size > maxBytes) fsys.renameSync(file, old);
        fsys.appendFileSync(file, `${formatLine(level, args, now())}\r\n`);
      } catch { /* nothing to do about it */ }
    },
  };
}

// A run of steps (Set up this PC, moving the database, Remove everything) as one log line.
function stepsText(what, result) {
  const steps = (result.steps || []).map((x) => `${x.label}: ${x.state}${x.detail ? ` (${x.detail})` : ''}`).join('; ');
  return `${what} ${result.ok ? 'finished' : `stopped: ${result.error || 'no reason given'}`}${steps ? `. Steps: ${steps}` : ''}`;
}

// Sends console.log/info/warn/error to the log too (they still print as before). Returns the log. With
// onlyProblems, only warnings and errors go to the log (the alert check every 5 minutes keeps the rest in
// alerts.log).
function captureConsole(log, target = console, { onlyProblems = false } = {}) {
  for (const [method, level] of [['log', 'info'], ['info', 'info'], ['warn', 'warn'], ['error', 'error']]) {
    if (onlyProblems && level === 'info') continue;
    const original = target[method].bind(target);
    target[method] = (...args) => {
      log.write(level, args);
      original(...args);
    };
  }
  return log;
}

module.exports = { LOG_NAME, OLD_NAME, MAX_BYTES, scrub, formatLine, stepsText, createLog, captureConsole };
