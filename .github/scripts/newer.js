// Exits 0 when the first version is newer than the second ("1.6.0" is newer than "1.6.0-test.4"), 1 otherwise.
// Usage: node newer.js <version> <than>      (uses semver, installed with the app's packages)
const semver = require('semver');
const [a, b] = process.argv.slice(2);
process.exit(semver.valid(a) && semver.valid(b) && semver.gt(a, b) ? 0 : 1);
