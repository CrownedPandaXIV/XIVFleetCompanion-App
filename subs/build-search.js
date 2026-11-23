// The Build Finder's search for one request, as ipc/calculator.js findFor asks it (run in subs/calculator-worker.js so
// the app's other pages aren't held up): every build that reaches the goals, the part filter, the sort, and the counts
// the page shows, with only the first `limit` rows sent back. job: findBuilds' arguments (owned: a Set or null) with
// gameParts in place of partRank, and slots, sortBy, limit.
const finder = require('./build-finder');
const { partRanks } = require('./levelling');

function searchBuilds({ gameParts, slots = null, sortBy = 'rank', limit = 200, ...args }) {
  const all = finder.findBuilds({ ...args, partRank: partRanks(gameParts) });
  // The part filter applies before the list is cut, so the counts and rank groups follow it.
  const rows = finder.sortBuilds(finder.filterByParts(all, slots, args.owned), sortBy);
  return {
    unfiltered: all.length,
    total: rows.length, sure: rows.filter((r) => r.sure).length, outOfRange: rows.filter((r) => r.rangeShort > 0).length,
    // How many builds work from each rank (in range), for the page's group headings.
    byRank: rows.reduce((counts, r) => { if (!(r.rangeShort > 0)) counts[r.rank] = (counts[r.rank] || 0) + 1; return counts; }, {}),
    rows: rows.slice(0, Math.max(1, Number(limit) || 200)),
  };
}

module.exports = { searchBuilds };
