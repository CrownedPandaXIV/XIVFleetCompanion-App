// The oldest plugin this app works fully with. Raise it when an app version needs something only a newer
// plugin sends (the changelog says so). The PCs tab flags each PC running an older one.
// 0.14.0: follows a database move (Settings → Database → Move the database to this PC) by itself.
const MIN_PLUGIN_VERSION = '0.14.0';

// Compares "0.10.0"-style versions: negative when a is older than b. A missing version counts as 0.
function compareVersions(a, b) {
  const pa = String(a || '0').split('.').map((n) => Number(n) || 0);
  const pb = String(b || '0').split('.').map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

// The PCs (rows of companion_pc_status) whose plugin is older than `min`.
function pcsNeedingUpdate(pcs, min = MIN_PLUGIN_VERSION) {
  return (pcs || []).filter((p) => compareVersions(p.plugin_version, min) < 0);
}

module.exports = { MIN_PLUGIN_VERSION, compareVersions, pcsNeedingUpdate };
