// A Free Company chest belongs to the FC, not to each member: when several tracked characters share
// an FC, its chest must be counted once. Kept free of Electron so it can be unit tested.

// fc_id -> the cid of the one member whose row carries that FC's chest: the FC's leader when the
// leader is one of the tracked characters, otherwise the first member in roster order (saved
// position, then name, then cid). Characters without an FC are skipped.
//   characters: [{ cid, name, fc_id, fc_master, sort_index }]
function chestHolders(characters) {
  const byFc = new Map();
  for (const c of characters) {
    if (c.fc_id == null || String(c.fc_id) === '0') continue;
    const key = String(c.fc_id);
    if (!byFc.has(key)) byFc.set(key, []);
    byFc.get(key).push(c);
  }
  const isLeader = (c) => !!c.fc_master && !!c.name && c.name.toLowerCase() === String(c.fc_master).toLowerCase();
  const rosterOrder = (a, b) => {
    const sa = a.sort_index == null ? Infinity : Number(a.sort_index);
    const sb = b.sort_index == null ? Infinity : Number(b.sort_index);
    if (sa !== sb) return sa - sb;
    const byName = String(a.name || '').localeCompare(String(b.name || ''));
    if (byName !== 0) return byName;
    return String(a.cid).localeCompare(String(b.cid));
  };
  const holders = new Map();
  for (const [fcId, members] of byFc) {
    const holder = members.find(isLeader) || members.slice().sort(rosterOrder)[0];
    holders.set(fcId, String(holder.cid));
  }
  return holders;
}

// fc_id -> cids of every tracked member, for sharing one chest between them.
function membersByFc(characters) {
  const byFc = new Map();
  for (const c of characters) {
    if (c.fc_id == null || String(c.fc_id) === '0') continue;
    const key = String(c.fc_id);
    if (!byFc.has(key)) byFc.set(key, []);
    byFc.get(key).push(String(c.cid));
  }
  return byFc;
}

module.exports = { chestHolders, membersByFc };
