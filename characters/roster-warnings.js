// The Roster's supply warnings: which characters are below the low-ceruleum and low-repair-kit warnings. No Electron
// or pg here, so the in-game Roster (db/views.sql fleet_roster_view) can be checked against it
// (tests/db/verify-fleet-views.js).
//
// rows: [{ cid, ceruleum, repair_kits, subs_built }]; behind: the characters no longer synced (not-synced.js, a Map
// by cid); thresholds: { ceruleum, repairKits } (0: that warning is off). A character with no built sub is never
// flagged (a fresh account's zeros aren't a real problem), nor is one no longer synced, as on the Summary.
function rosterWarnings(rows, behind, { ceruleum = 0, repairKits = 0 } = {}) {
  return rows.map((r) => {
    const subsBuilt = Number(r.subs_built) > 0;
    const synced = !behind.has(String(r.cid));
    return {
      ...r,
      not_synced_ms: behind.get(String(r.cid)) ?? null,
      low_repair: subsBuilt && synced && r.repair_kits < repairKits,
      low_ceruleum: subsBuilt && synced && r.ceruleum < ceruleum,
      ceruleum_tone: supplyTone(r.ceruleum, ceruleum, subsBuilt && synced),
      repair_tone: supplyTone(r.repair_kits, repairKits, subsBuilt && synced),
    };
  });
}

// A supply's colour against its warning, as the plugin's (MainWindow.Lists.cs SupplyColor): 'danger' under half of
// it, 'warn' under it, 'good' at or above it (or with the warning off), null when it doesn't count (no sub built,
// or no longer synced) or isn't known.
function supplyTone(have, warning, counted) {
  if (!counted || have === null || have === undefined) return null;
  const n = Number(have);
  if (!(warning > 0)) return 'good';
  if (n < warning / 2) return 'danger';
  if (n < warning) return 'warn';
  return 'good';
}

module.exports = { rosterWarnings, supplyTone };
