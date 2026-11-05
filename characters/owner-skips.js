// Characters no setup of the plugin syncs: the setup a character last logged in on is the only one that syncs it
// (plugin 1.0.2, companion_character_login), so when that setup keeps syncing but leaves the character out (it is
// unticked in that setup's plugin settings, or its AutoRetainer no longer has it), nobody sends it. No Electron here
// (tests/owner-skips.test.js).

// How far behind its setup's last sync a character must be to count: well over any sync interval.
const GRACE_MS = 60 * 60 * 1000;
// Only setups that have synced in this long count as still syncing.
const ACTIVE_MS = 24 * 60 * 60 * 1000;

// characters: [{ cid, name, world, last_synced_at, login_pc, login_label }]; setups: [{ pc_name, account_label,
// last_sync_at }] (the PCs tab's rows). Returns [{ cid, name, world, pc, label }] for each character whose setup
// is syncing without it, by name.
function ownerSkips(characters, setups, now = Date.now()) {
  const lastSync = new Map(setups.map((s) => [`${s.pc_name}\u0000${s.account_label || ''}`, s.last_sync_at ? new Date(s.last_sync_at).getTime() : 0]));
  const found = [];
  for (const c of characters) {
    if (!c.login_pc) continue;
    const setupAt = lastSync.get(`${c.login_pc}\u0000${c.login_label || ''}`) || 0;
    const charAt = c.last_synced_at ? new Date(c.last_synced_at).getTime() : 0;
    if (setupAt && now - setupAt <= ACTIVE_MS && setupAt - charAt > GRACE_MS) {
      found.push({ cid: String(c.cid), name: c.name, world: c.world, pc: c.login_pc, label: c.login_label || '' });
    }
  }
  return found.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

// The same, from an open pg client: every character's last sync and login, and every setup's last sync.
async function loadOwnerSkips(client, latestCharacter) {
  const { rows: [has] } = await client.query(
    `SELECT to_regclass('companion_character_login') IS NOT NULL AND to_regclass('companion_pc_status') IS NOT NULL AS ok`);
  if (!has.ok) return [];
  const { rows: characters } = await client.query(`
    SELECT c.cid::text AS cid, c.name, c.world, c.snapshot_at AS last_synced_at, l.pc_name AS login_pc, l.account_label AS login_label
    FROM ${latestCharacter} c JOIN companion_character_login l ON l.cid = c.cid`);
  const { rows: setups } = await client.query('SELECT pc_name, account_label, last_sync_at FROM companion_pc_status');
  return ownerSkips(characters, setups);
}

module.exports = { GRACE_MS, ACTIVE_MS, ownerSkips, loadOwnerSkips };
