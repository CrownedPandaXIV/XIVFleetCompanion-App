// Decides how each part a character needs gets covered: a spare already held, the old part another of
// the character's subs gives up when it is upgraded, or crafting. No Electron or pg here, so it can be
// tested on its own (tests/parts-matching.test.js).
//
// Every upgrade takes a part off a sub. That old part can go straight onto another sub that needs it:
// when Sub 3 swaps its Shark bow for an Unkiu bow, the Shark bow can go on the new sub in the empty
// slot, so only three Shark parts need crafting for it, not four.

// needs: [{ subName, rank, slotKey, cls, modified, freed: { cls, modified } | null, ahead }] for one
//        character: the parts needed now, highest rank first, then (with Look ahead on the Parts tab) those of
//        builds coming up, soonest first, marked `ahead`. `freed` is the part on that sub and slot before the
//        need is met, which comes off when it is (none for an empty slot).
// pool:  [{ class, slot, modified, location, qty }] spares the character can use; quantities are used
//        up in place (the FC chest stacks are shared with the other members of the FC).
// Returns one entry per need, in the same order: { location, recycledFrom }. Both are null when the
// part must be crafted.
function matchNeeds(needs, pool) {
  return matchFreed(needs, needs.map((need) => takeSpare(need, pool)));
}

const same = (a, b) => a.class === b.class && a.slot === b.slot && a.modified === b.modified;

// Spares first: they can be fitted straight away. One need's spare from the pool, used up:
// { location, recycledFrom: null }, location null when there is none. Callers go through what is needed now
// before anything coming up, across every character, so a shared FC chest serves the sub that needs it today.
function takeSpare(need, pool) {
  const wanted = { class: need.cls, slot: need.slotKey, modified: need.modified };
  const stack = pool.find((s) => s.qty > 0 && same(s, wanted));
  if (!stack) return { location: null, recycledFrom: null };
  stack.qty -= 1;
  return { location: stack.location, recycledFrom: null };
}

// Then the parts the upgrades free up, for whatever spares did not cover (one character's needs, with
// takeSpare's results). Any upgrade frees its old part, whether the new one is a spare or crafted. A part
// freed by an upgrade coming up only comes off later, so it can only go to a need coming up after it, which
// also keeps a shorter look-ahead's answers the same as the start of a longer one's.
function matchFreed(needs, spares) {
  const results = [...spares];
  const freed = needs
    .map((need, index) => ({ need, index }))
    .filter(({ need }) => need.freed)
    .map(({ need, index }) => ({ class: need.freed.cls, slot: need.slotKey, modified: need.freed.modified, subName: need.subName, ahead: !!need.ahead, index, used: false }));
  needs.forEach((need, i) => {
    if (results[i].location) return;
    const wanted = { class: need.cls, slot: need.slotKey, modified: need.modified };
    const inTime = (f) => !f.ahead || (need.ahead && f.index < i);
    const part = freed.find((f) => !f.used && f.subName !== need.subName && inTime(f) && same(f, wanted));
    if (!part) return;
    part.used = true;
    results[i] = { location: `${part.subName}'s old ${need.slotKey} (once it is upgraded)`, recycledFrom: part.subName };
  });
  return results;
}

module.exports = { matchNeeds, takeSpare, matchFreed };
