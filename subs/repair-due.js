// When a sub's parts need repairing: from each part's condition as last read in the Free Company's workshop (the
// plugin's companion_sub_part_condition) and how much a voyage on its current route wears it (subs/calculator.js's
// sectorDamage). A part can be sent out while its condition is above 0, as the Sub Calculator counts it.
//
// The readings say when the game takes a voyage's wear: a part's drop read while the sub was out (its return time
// still ahead) is wear taken when it was sent; a drop read once it was back, wear taken on return. wearAtSend() goes
// by the fleet's own drops; with none, the voyage out is counted as not yet worn (the earlier repair date).
const { sectorDamage, FULL_CONDITION } = require('./calculator');

// readings of one part, oldest first: [{ readAt, returnAt, itemId, condition }] (seconds; returnAt 0: not sent out).
// Each drop from the reading before it: true when read while the sub was out.
function dropsOf(readings) {
  const out = [];
  for (let i = 1; i < readings.length; i++) {
    const r = readings[i];
    if (r.itemId === readings[i - 1].itemId && r.condition < readings[i - 1].condition) out.push(r.returnAt > r.readAt);
  }
  return out;
}

// Whether wear is taken when a sub is sent (true), on return (false), or not known yet (null): what most drops say.
function wearAtSend(parts) {
  let sent = 0;
  let back = 0;
  for (const readings of parts) for (const out of dropsOf(readings)) out ? sent++ : back++;
  if (!sent && !back) return null;
  return sent > back;
}

// One part: how many more voyages it can be sent on after the one it is on now (if any), or null when it can't be
// told (no reading of this part, or another part is fitted now).
// last: its latest reading; itemId: the part fitted now; lost: its wear a voyage on the current route;
// returnTime: the sub's return time now (0 or past: in port); atSend: wearAtSend().
function voyagesLeft({ last, itemId, lost, returnTime, atSend }) {
  if (!last || last.itemId !== itemId || !(lost > 0)) return null;
  const outWhenRead = last.returnAt > last.readAt;
  // Sent again since the reading: it is out on a voyage the reading didn't know of.
  const sentSince = returnTime > 0 && returnTime > last.returnAt + 60 && returnTime > last.readAt;
  // Voyages whose wear the reading doesn't hold yet, the one it is on now included.
  const unworn = atSend === true ? (sentSince ? 1 : 0) : (outWhenRead ? 1 : 0) + (sentSince ? 1 : 0);
  const after = last.condition - unworn * lost;
  return after > 0 ? Math.ceil(after / lost) : 0;
}

// A sub: { voyages (the fewest of its parts), slot (that part), condition (its % as last read), readAt } or null.
// parts: per slot 0-3 { readings (oldest first), itemId, rank }; route: the current route's sectors' rank needed.
function repairDue({ parts, route, returnTime, atSend }) {
  if (!route.length) return null;
  let due = null;
  parts.forEach((p, slot) => {
    if (!p || !p.readings.length) return;
    const lost = route.reduce((sum, rankReq) => sum + sectorDamage(rankReq, p.rank), 0);
    const last = p.readings[p.readings.length - 1];
    const voyages = voyagesLeft({ last, itemId: p.itemId, lost, returnTime, atSend });
    if (voyages === null) return;
    if (!due || voyages < due.voyages) due = { voyages, slot, condition: (last.condition / FULL_CONDITION) * 100, readAt: last.readAt };
  });
  return due;
}

module.exports = { dropsOf, wearAtSend, voyagesLeft, repairDue };
