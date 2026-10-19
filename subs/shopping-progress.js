// Shopping List progress: how many of each sub part on the list have been crafted, ticked off by hand
// and remembered in the database (shared by every PC). Once a crafted part reaches bags, a retainer or
// the FC chest, the plugin sees it, the Parts tab counts it as a spare and the list asks for fewer; the
// ticks it already covered are then taken back off, so nothing is counted twice. No Electron or pg here,
// so it can be tested on its own (tests/shopping-progress.test.js).

// stored: { [itemId]: { made, outOf } } (outOf: how many the list asked for when last ticked)
// parts:  [{ itemId, crafts }] the list now
// Returns { [itemId]: { made, outOf } } for the parts still on the list.
function reconcileProgress(stored, parts) {
  const next = {};
  for (const p of parts) {
    const entry = stored && stored[p.itemId];
    if (!entry) continue;
    const seen = Math.max(0, (Number(entry.outOf) || 0) - p.crafts); // made parts now held
    const made = Math.min(p.crafts, Math.max(0, (Number(entry.made) || 0) - seen));
    if (made > 0) next[p.itemId] = { made, outOf: p.crafts };
  }
  return next;
}

// The stored progress after ticking `made` of `crafts` for one part (0 removes it).
function setProgress(stored, itemId, made, crafts) {
  const next = { ...(stored || {}) };
  const n = Math.max(0, Math.min(Number(crafts) || 0, Math.round(Number(made) || 0)));
  if (n > 0) next[itemId] = { made: n, outOf: Number(crafts) || 0 };
  else delete next[itemId];
  return next;
}

// Reads the saved JSON safely ({} when missing or broken).
function parseProgress(text) {
  try {
    const value = JSON.parse(text || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

module.exports = { reconcileProgress, setProgress, parseProgress };
