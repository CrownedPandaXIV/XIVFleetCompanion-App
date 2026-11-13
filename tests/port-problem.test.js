// The port typed on a database tool (New database, Move, Leftovers) is a whole number from 1 to 65535, refused before
// anything starts: a move installs PostgreSQL on it. The plugin's DatabaseAdmin.PortProblem is the same.
const test = require('node:test');
const assert = require('node:assert');
const { portProblem } = require('../setup/create-database');

test('a whole number from 1 to 65535 is a port', () => {
  for (const ok of ['5432', 5432, ' 5433 ', '1', '65535']) assert.strictEqual(portProblem(ok), null, JSON.stringify(ok));
});

test('anything else is refused in plain words', () => {
  for (const bad of ['0', '65536', '70000', '-1', '54.32', 'abc', '', null, undefined]) {
    assert.strictEqual(portProblem(bad), "The port must be a whole number from 1 to 65535 (PostgreSQL's usual one is 5432).", JSON.stringify(bad));
  }
});
