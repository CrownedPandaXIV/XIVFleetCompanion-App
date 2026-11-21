// Comparing version numbers, one rule for the whole app: -1, 0 or 1 for "1.4.10" against "1.5.0". Every number counts
// (the plugin's "2.5.0.65" is newer than "2.5.0"); a test version ("1.6.0-test.3") counts as its version number; a
// missing version counts as 0. No Electron here (tests/plugin-version.test.js, tests/changelog.test.js).
function compareVersions(a, b) {
  const parts = (v) => String(v || '0').split('-')[0].split('.').map((n) => Number(n) || 0);
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

module.exports = { compareVersions };
