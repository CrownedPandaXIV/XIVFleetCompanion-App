// Decides how each part a character needs gets covered: a spare already held, the old part another of
// the character's subs gives up when it is upgraded, or crafting. No Electron or pg here, so it can be
// tested on its own (tests/parts-matching.test.js).
//
// Every upgrade takes a part off a sub. That old part can go straight onto another sub that needs it:
// when Sub 3 swaps its Shark bow for an Unkiu bow, the Shark bow can go on the new sub in the empty
// slot, so only three Shark parts need crafting for it, not four.

// needs: [{ subName, rank, slotKey, cls, modified, freed: { cls, modified } | null }] for one character,
//        highest rank first. `freed` is the part on that sub and slot now, which comes off when the
//        need is met (none for an empty slot).
// pool:  [{ class, slot, modified, location, qty }] spares the character can use; quantities are used
//        up in place (the FC chest stacks are shared with the other members of the FC).
// Returns one entry per need, in the same order: { location, recycledFrom }. Both are null when the
// part must be crafted.
function matchNeeds(needs, pool) {
  const same = (a, b) => a.class === b.class && a.slot === b.slot && a.modified === b.modified;

  // Spares first: they can be fitted straight away.
  const results = needs.map((need) => {
    const wanted = { class: need.cls, slot: need.slotKey, modified: need.modified };
    const stack = pool.find((s) => s.qty > 0 && same(s, wanted));
    if (!stack) return { location: null, recycledFrom: null };
    stack.qty -= 1;
    return { location: stack.location, recycledFrom: null };
  });

  // Then the parts the upgrades free up, for whatever spares did not cover. Any upgrade frees its old
  // part, whether the new one is a spare or crafted.
  const freed = needs
    .filter((need) => need.freed)
    .map((need) => ({ class: need.freed.cls, slot: need.slotKey, modified: need.freed.modified, subName: need.subName, used: false }));
  needs.forEach((need, i) => {
    if (results[i].location) return;
    const wanted = { class: need.cls, slot: need.slotKey, modified: need.modified };
    const part = freed.find((f) => !f.used && f.subName !== need.subName && same(f, wanted));
    if (!part) return;
    part.used = true;
    results[i] = { location: `${part.subName}'s old ${need.slotKey} (once it is upgraded)`, recycledFrom: part.subName };
  });

  return results;
}

module.exports = { matchNeeds };
