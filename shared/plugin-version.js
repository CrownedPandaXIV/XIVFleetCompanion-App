// The oldest plugin this app works fully with. Raise it when an app version needs something only a newer
// plugin sends (the changelog says so). The PCs page flags each PC running an older one.
// 0.14.0: follows a database move (Settings → Database → Move the database to this PC) by itself.
const MIN_PLUGIN_VERSION = '0.14.0';

// One rule for the whole app (shared/versions.js).
const { compareVersions } = require('./versions');

// The PCs (rows of companion_pc_status) whose plugin is older than `min`.
function pcsNeedingUpdate(pcs, min = MIN_PLUGIN_VERSION) {
  return (pcs || []).filter((p) => compareVersions(p.plugin_version, min) < 0);
}

module.exports = { MIN_PLUGIN_VERSION, compareVersions, pcsNeedingUpdate };
