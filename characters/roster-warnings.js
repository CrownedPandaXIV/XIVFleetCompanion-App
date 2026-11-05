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
    };
  });
}

module.exports = { rosterWarnings };
