// Characters synced by more than one setup of the plugin: each sync stamps a character with the label of the
// setup that sent it and replaces its subs with what that setup's AutoRetainer knows, so two setups that both
// know a character (an old copy left in one AutoRetainer) keep overwriting each other. The database logs every
// account label change (companion_character_changes), and such a character's label keeps going back to one it
// had: Account 1 -> Account 2 -> Account 1. A label renamed once, or renamed twice to new names, is not this.
// No Electron here (tests/shared-sync.test.js).

const WINDOW_DAYS = 3;

// changes: [{ cid, changed_at, old_value, new_value }] account label changes, any order. Returns
// [{ cid, labels (each label it switched between, in the order first seen), switches, last }] for each character
// whose label went back to one it had before, newest switch first.
function sharedCharacters(changes) {
  const byCid = new Map();
  for (const c of changes) {
    const key = String(c.cid);
    if (!byCid.has(key)) byCid.set(key, []);
    byCid.get(key).push(c);
  }
  const found = [];
  for (const [cid, list] of byCid) {
    list.sort((a, b) => new Date(a.changed_at) - new Date(b.changed_at));
    const had = new Set();
    const labels = [];
    let back = false;
    for (const c of list) {
      const from = c.old_value || '';
      const to = c.new_value || '';
      if (!labels.includes(from)) labels.push(from);
      had.add(from);
      if (had.has(to)) back = true;
      if (!labels.includes(to)) labels.push(to);
    }
    if (back) found.push({ cid, labels, switches: list.length, last: new Date(list[list.length - 1].changed_at).toISOString() });
  }
  return found.sort((a, b) => new Date(b.last) - new Date(a.last) || a.cid.localeCompare(b.cid));
}

// The characters synced by more than one setup in the last WINDOW_DAYS days, with their names, from an open pg
// client: [{ cid, name, world, labels, switches, last }]. latestCharacter: snapshotFragments(client)'s.
async function loadSharedCharacters(client, latestCharacter) {
  const { rows: [has] } = await client.query(`SELECT to_regclass('companion_character_changes') IS NOT NULL AS ok`);
  if (!has.ok) return [];
  const { rows } = await client.query(`
    SELECT cid::text AS cid, changed_at, old_value, new_value
    FROM companion_character_changes
    WHERE field = 'account_label' AND changed_at > now() - make_interval(days => $1)`, [WINDOW_DAYS]);
  const shared = sharedCharacters(rows);
  if (!shared.length) return [];
  const { rows: names } = await client.query(
    `SELECT cid::text AS cid, name, world FROM ${latestCharacter} c WHERE c.cid = ANY($1::numeric[])`, [shared.map((s) => s.cid)]);
  const nameOf = new Map(names.map((n) => [n.cid, n]));
  return shared.map((s) => ({ ...s, name: (nameOf.get(s.cid) || {}).name || null, world: (nameOf.get(s.cid) || {}).world || null }));
}

module.exports = { WINDOW_DAYS, sharedCharacters, loadSharedCharacters };
