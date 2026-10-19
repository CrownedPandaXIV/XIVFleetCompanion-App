// SQL fragments that yield the latest row per character (and per Free Company member): from the
// current-state table when the plugin keeps it, otherwise from the append-only
// companion_character_snapshot history. Kept free of Electron so it can be tested against a database.

const SNAPSHOT_COLUMNS = `cid, name, world, gil, retainer_count, submarine_count,
  account_label, snapshot_at, repair_kits, ceruleum, fc_id, num_sub_slots`;

// From the current-state table (database version 4): one row per character
// already, so nothing needs searching. A character is listed under its current Free Company only.
const CURRENT_FRAGMENTS = {
  latestCharacter: `(
  SELECT cid, name, world, gil, retainer_count, submarine_count, account_label,
         last_synced_at AS snapshot_at, repair_kits, ceruleum, fc_id, num_sub_slots
  FROM companion_character_current
)`,
  latestFcMember: `(
  SELECT fc_id, cid, name, world, account_label
  FROM companion_character_current
  WHERE fc_id IS NOT NULL
)`,
};

function buildSnapshotFragments({ useCurrent = false, hasCidIndex, hasFcIndex }) {
  if (useCurrent) return CURRENT_FRAGMENTS;
  const latestCharacter = hasCidIndex
    ? `(
  WITH RECURSIVE cids AS (
    (SELECT cid FROM companion_character_snapshot ORDER BY cid LIMIT 1)
    UNION ALL
    SELECT (SELECT cid FROM companion_character_snapshot WHERE cid > c.cid ORDER BY cid LIMIT 1)
    FROM cids c WHERE c.cid IS NOT NULL
  )
  SELECT l.* FROM cids
  CROSS JOIN LATERAL (
    SELECT ${SNAPSHOT_COLUMNS}
    FROM companion_character_snapshot WHERE cid = cids.cid
    ORDER BY snapshot_at DESC LIMIT 1
  ) l
  WHERE cids.cid IS NOT NULL
)`
    : `(
  SELECT DISTINCT ON (cid) ${SNAPSHOT_COLUMNS}
  FROM companion_character_snapshot
  ORDER BY cid, snapshot_at DESC
)`;

  // Latest row per (Free Company, character) pair, so a character is listed under
  // every FC they have ever been recorded in.
  const latestFcMember = hasFcIndex
    ? `(
  WITH RECURSIVE pairs AS (
    (SELECT fc_id, cid FROM companion_character_snapshot
     WHERE fc_id IS NOT NULL ORDER BY fc_id, cid LIMIT 1)
    UNION ALL
    SELECT n.fc_id, n.cid FROM pairs p
    CROSS JOIN LATERAL (
      SELECT fc_id, cid FROM companion_character_snapshot
      WHERE fc_id IS NOT NULL AND (fc_id, cid) > (p.fc_id, p.cid)
      ORDER BY fc_id, cid LIMIT 1
    ) n
  )
  SELECT l.* FROM pairs
  CROSS JOIN LATERAL (
    SELECT fc_id, cid, name, world, account_label
    FROM companion_character_snapshot
    WHERE fc_id = pairs.fc_id AND cid = pairs.cid
    ORDER BY snapshot_at DESC LIMIT 1
  ) l
)`
    : `(
  SELECT DISTINCT ON (fc_id, cid) fc_id, cid, name, world, account_label
  FROM companion_character_snapshot
  WHERE fc_id IS NOT NULL
  ORDER BY fc_id, cid, snapshot_at DESC
)`;

  return { latestCharacter, latestFcMember };
}

// Which source the app reads characters from. The current-state table is used once it exists and the
// plugin keeps it up to date: its newest sync is no more than CURRENT_GRACE older than the snapshot
// history's newest row (or the history table is gone). Otherwise (the SQL script has run but the
// plugin is still an older version) the snapshot history is used, through its indexes when they exist.
const CURRENT_GRACE = '10 minutes';

async function chooseSnapshotSource(client) {
  const tables = (await client.query(
    `SELECT to_regclass('companion_character_current') IS NOT NULL AS has_current,
            to_regclass('companion_character_snapshot') IS NOT NULL AS has_snapshot`
  )).rows[0];
  let useCurrent = false;
  if (tables.has_current && !tables.has_snapshot) {
    useCurrent = true;
  } else if (tables.has_current) {
    // Newest snapshot per current character, found through the (cid, snapshot_at) index when present.
    const r = await client.query(`
      SELECT (SELECT max(last_synced_at) FROM companion_character_current)
             >= coalesce((SELECT max(s.snapshot_at) FROM companion_character_current c
                          CROSS JOIN LATERAL (SELECT snapshot_at FROM companion_character_snapshot
                                              WHERE cid = c.cid ORDER BY snapshot_at DESC LIMIT 1) s), '-infinity')
                - interval '${CURRENT_GRACE}' AS fresh`);
    useCurrent = r.rows[0].fresh === true;
  }
  let hasCidIndex = false;
  let hasFcIndex = false;
  if (!useCurrent && tables.has_snapshot) {
    const result = await client.query(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'companion_character_snapshot'`
    );
    for (const row of result.rows) {
      if (/\(cid, snapshot_at DESC\)/.test(row.indexdef)) hasCidIndex = true;
      if (/\(fc_id, cid, snapshot_at DESC\)/.test(row.indexdef)) hasFcIndex = true;
    }
  }
  return { useCurrent, hasCidIndex, hasFcIndex };
}

module.exports = { SNAPSHOT_COLUMNS, buildSnapshotFragments, chooseSnapshotSource };
