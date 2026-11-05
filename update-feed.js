// Where the installed app looks for new versions (updater.js). Normally the public Releases repository's newest
// release, like everyone else. With "Get test versions" on (Settings → General → Updates), the "testing" release
// there instead: it holds the newest test version, or the newest normal version once that is newer (the release
// workflow keeps it so), so a tester never misses a normal update. Kept free of Electron (tests/update-feed.test.js).

const OWNER = 'CrownedPandaXIV';
const REPO = 'XIVFleetCompanion-Releases';
const TESTING_URL = `https://github.com/${OWNER}/${REPO}/releases/download/testing`;

// "1.6.0-test.12" is a test version (built by .github/workflows/test-release.yml).
const isTestVersion = (version) => /^\d+\.\d+\.\d+-test\.\d+$/.test(String(version || ''));

// Whether this PC gets test versions: what was chosen in Settings; when nothing was chosen yet, yes on a test
// version (someone who installed one wants the next), no otherwise.
function testingWanted(saved, version) {
  if (saved && typeof saved.testing === 'boolean') return saved.testing;
  return isTestVersion(version);
}

// What electron-updater's setFeedURL is given.
function feedFor(testing) {
  return testing
    ? { provider: 'generic', url: TESTING_URL }
    : { provider: 'github', owner: OWNER, repo: REPO, releaseType: 'release' };
}

module.exports = { TESTING_URL, isTestVersion, testingWanted, feedFor };
