// The Summary's Retainers section: how the retainers with a class are doing right now. No Electron or pg
// here, so it can be tested on its own (tests/retainer-summary.test.js).

const HOUR = 60 * 60 * 1000;

// rows: [{ owner_cid, owner_name, world, account_label, sort_index, retainer_name, job, job_abbreviation,
// has_venture, venture_ends_at (Unix seconds) }] for retainers with a class. A finished venture waiting
// to be collected still counts as on a venture (as in the Discord alert).
function retainerSummary(rows, now = Date.now()) {
  const idle = [];
  let away = 0;
  let ready = 0;
  let soon = 0;
  for (const r of rows) {
    if (!r.has_venture) { idle.push(r); continue; }
    const ends = Number(r.venture_ends_at) * 1000;
    if (ends && ends <= now) ready += 1;
    else {
      away += 1;
      if (ends && ends - now <= HOUR) soon += 1;
    }
  }
  idle.sort((a, b) => (a.sort_index ?? 1e9) - (b.sort_index ?? 1e9)
    || String(a.owner_name).localeCompare(String(b.owner_name)) || String(a.retainer_name).localeCompare(String(b.retainer_name)));
  return { total: rows.length, idle, away, ready, soon };
}

module.exports = { retainerSummary };
