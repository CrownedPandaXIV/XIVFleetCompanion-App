// Sub Calculator → Build Finder: pick sectors and what you want from each (a loot tier, optimal retrieval, a double
// dip, items), and see every build that gets it, each at the lowest rank it works (ipc/calculator.js find-sub-builds,
// subs/build-finder.js). Laid out in three parts: what you want, the options, and the builds, grouped by rank.
// Colours: a part you own green and one to get amber; a goal met only by the lower of XIVStats' and Pepper's
// figures amber ("might not"); out of range red.

const FINDER_SORTS = [['rank', 'Lowest rank'], ['speed', 'Fastest voyage'], ['parts', 'Fewest parts still needed'], ['range', 'Most range to spare']];
const FINDER_SLOTS = ['hull', 'stern', 'bow', 'bridge'];
const FINDER_NEEDED = [['surveillance', 'Surveillance'], ['retrieval', 'Retrieval'], ['favor', 'Favor']];
const finderNeedText = (bp) => (bp.low === bp.high ? plannerN(bp.low) : `${plannerN(bp.low)}–${plannerN(bp.high)}`);

// The four parts as tags: green you own it, amber still to get (no colour when ownership isn't known).
function FinderParts({ row }) {
  const missing = new Set((row.missingParts || []).map((p) => p.slot));
  return (
    <span className="finder-parts">
      {row.parts.map((letter, slot) => (
        <span key={slot} className={`finder-part ${!row.missingParts ? '' : missing.has(slot) ? 'get' : 'own'}`}
          title={`${FINDER_SLOTS[slot][0].toUpperCase()}${FINDER_SLOTS[slot].slice(1)}: ${partNameOf(letter)}${!row.missingParts ? '' : missing.has(slot) ? ', still to get' : ', you own it'}`}>
          {letter}
        </span>
      ))}
    </span>
  );
}
const FINDER_CLASS_NAMES = { S: 'Shark', U: 'Unkiu', W: 'Whale', C: 'Coelacanth', Y: 'Syldra' };
const partNameOf = (letter) => (letter.endsWith('+') ? `Modified ${FINDER_CLASS_NAMES[letter[0]]}` : FINDER_CLASS_NAMES[letter]);

// "might not": only the lower of the two sources' figures is met at this rank.
function FinderMaybe({ row }) {
  if (row.sure) return null;
  return <span className="finder-maybe" title={`Reaches the lower of XIVStats' and Pepper's figures, not the higher. ${row.sureRank ? `Sure from rank ${row.sureRank}.` : 'Never sure.'}`}>might not</span>;
}

// A stat: the ones the goals ask for in full with what they have to spare (green; amber at exactly 0), the rest greyed.
function finderStatCell(key) {
  return (r, ctx) => {
    const asked = ctx && ctx.need && ctx.need[key];
    if (!asked) return <td className="num dim">{plannerN(r.stats[key])}</td>;
    return <td className="num">{plannerN(r.stats[key])}<span className={`finder-spare${r.spare[key] === 0 ? ' zero' : ''}`}>+{plannerN(r.spare[key])}</span></td>;
  };
}

const FINDER_COLUMN_DEFS = [
  // Shown in front only while the list isn't grouped by rank.
  { key: 'rank', label: 'Rank', default: false, td: (r) => <td className="num">{r.rank}</td>, sort: (r) => r.rank },
  { key: 'build', label: 'Build', locked: true, td: (r) => <td><FinderParts row={r} /><FinderMaybe row={r} /></td>, sort: (r) => r.parts.join('') },
  { key: 'surveillance', label: 'Surveillance', td: finderStatCell('surveillance'), sort: (r) => r.stats.surveillance },
  { key: 'retrieval', label: 'Retrieval', td: finderStatCell('retrieval'), sort: (r) => r.stats.retrieval },
  { key: 'favor', label: 'Favor', td: finderStatCell('favor'), sort: (r) => r.stats.favor },
  { key: 'speed', label: 'Speed', td: (r) => <td className="num dim">{plannerN(r.stats.speed)}</td>, sort: (r) => r.stats.speed },
  { key: 'range', label: 'Range', td: (r) => (r.rangeShort > 0
    ? <td className="finder-range-out"><span className="finder-out-tag">needs {plannerN(r.rangeShort)} more range</span>
      <span className="dim"> {r.inRangeFrom ? `in range from rank ${r.inRangeFrom}` : 'not in range at any rank'}</span></td>
    : <td className="num">{plannerN(r.stats.range)}{r.rangeNeeded !== null && <span className="finder-spare">+{plannerN(r.stats.range - r.rangeNeeded)}</span>}</td>),
  sort: (r) => r.stats.range - (r.rangeNeeded || 0) },
  { key: 'voyage', label: 'Voyage', td: (r) => <td className="num">{r.hours ? plannerHours(r.hours) : '—'}</td>, sort: (r) => r.hours },
  { key: 'parts', label: 'To get', td: (r) => (!r.missingParts ? <td className="dim">—</td> : r.missingParts.length === 0
    ? <td className="tone-good">All owned</td>
    : <td title={r.missingParts.map((p) => `${partNameOf(p.letter)} ${FINDER_SLOTS[p.slot]}`).join(', ')}>{r.missingParts.length} part{r.missingParts.length === 1 ? '' : 's'}</td>),
  sort: (r) => (r.missingParts ? r.missingParts.length : null) },
  { key: 'planner', label: 'Planner', sortable: false, cell: (r, ctx) => (ctx && ctx.onOpen
    ? <button type="button" className="finder-open" onClick={() => ctx.onOpen(r)} title="Open this build and the route in Sub Calculator → Planner.">Open in Planner</button> : null) },
];

function BuildFinderView({ refreshKey, onOpenPlanner }) {
  const [base, setBase] = useState(null);
  const [error, setError] = useState(null);
  const [mapId, setMapId] = useState(null);
  const [goals, setGoals] = useState([]); // [{ sectorId, tier, optimal, doubleDip, items }]
  const [adding, setAdding] = useState('');
  const [sortBy, setSortBy] = useState('rank');
  const [sureOnly, setSureOnly] = useState(false);
  const [forSub, setForSub] = useState(null);
  const [found, setFound] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    window.api.getSubCalculator().then((r) => {
      if (!r.success) { setError(r.error); return; }
      setError(null);
      setBase(r);
      setMapId((m) => m ?? (r.maps.length ? r.maps[r.maps.length - 1].id : null));
    });
  }, [refreshKey]);

  // Worked out again a moment after each change (the newest answer only).
  const latest = useRef(0);
  useEffect(() => {
    if (!base || base.missingGameData) return undefined;
    if (!goals.length) { setFound(null); return undefined; }
    const call = ++latest.current;
    setBusy(true);
    const timer = setTimeout(() => {
      window.api.findSubBuilds({ goals, sortBy, sureOnly, forCid: forSub ? forSub.cid : null, limit: 200 }).then((r) => {
        if (call !== latest.current) return;
        setBusy(false);
        setFound(r.success ? r : { error: r.error });
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [base, goals, sortBy, sureOnly, forSub, refreshKey]);

  // Grouped by rank while sorted by lowest rank and no column is clicked; otherwise one list with a Rank column.
  const finderSort = useColumnSort();
  const grouped = sortBy === 'rank' && !finderSort.sortColumn;
  const cols = useTableColumns({ tableKey: 'buildFinder', ownDefs: FINDER_COLUMN_DEFS, rows: found && found.rows ? found.rows : null, idOf: () => null,
    contextKeys: ['rank'], contextActive: !grouped });

  if (error && !base) return <div className="error">Failed to load: {error}</div>;
  if (!base) return <div className="status">Loading...</div>;
  if (base.missingGameData) {
    return <div className="status">The Build Finder needs the game data's sub tables. Update them in Settings → Data → Game Data.</div>;
  }

  const sectorOf = new Map(base.sectors.map((s) => [s.id, s]));
  const chosen = goals.map((g) => g.sectorId);
  const onMap = base.sectors.filter((s) => s.map === mapId && !chosen.includes(s.id)).sort((a, b) => a.id - b.id);
  const change = (i, patch) => setGoals(goals.map((g, j) => (j === i ? { ...g, ...patch } : g)));
  const add = () => {
    const id = Number(adding || (onMap[0] && onMap[0].id));
    if (id && goals.length < 5) { setGoals([...goals, { sectorId: id, tier: 0, optimal: false, doubleDip: false, items: [] }]); setAdding(''); }
  };
  const ctx = { onOpen: (r) => onOpenPlanner({ rank: r.rank, parts: r.parts, route: found.route }), need: found && found.need };
  const rows = found && found.rows ? (finderSort.sortColumn ? applyColumnSort(cols.rows, finderSort.sortColumn, finderSort.sortDirection, cols.accessors) : cols.rows) : [];
  const groupOf = (r) => (r.rangeShort > 0 ? 'out' : r.rank);

  return (
    <div className="finder">
      <section className="finder-band">
        <h2 className="finder-heading">What you want <span className="count">{goals.length} of 5 sectors</span></h2>
        <div className="finder-row">
          <label className="finder-field">Map
            <select value={mapId ?? ''} onChange={(e) => { setMapId(Number(e.target.value)); setGoals([]); }}>
              {base.maps.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <label className="finder-field">Add a sector
            <select value={adding} onChange={(e) => setAdding(e.target.value)} disabled={goals.length >= 5}>
              {onMap.map((s) => <option key={s.id} value={s.id}>{s.letter}: {s.name} (rank {s.rankReq}){s.hasData ? '' : ', no loot data yet'}</option>)}
            </select>
          </label>
          <button onClick={add} disabled={goals.length >= 5 || !onMap.length}>Add</button>
        </div>
        {goals.length === 0 && <div className="dim">Add up to 5 sectors, then say what you want from each.</div>}
        {goals.map((g, i) => {
          const s = sectorOf.get(g.sectorId) || { letter: '?', name: `Sector ${g.sectorId}`, items: [] };
          const itemOf = new Map((s.items || []).map((it) => [it.itemId, it]));
          return (
            <div key={g.sectorId} className="finder-goal">
              <div className="finder-goal-head">
                <span className="finder-letter">{s.letter}</span><span className="finder-goal-name">{s.name}</span>
                <span className="dim">rank {s.rankReq}</span>
                <button className="link-button" onClick={() => setGoals(goals.filter((_, j) => j !== i))}>Remove</button>
              </div>
              {!s.hasData ? <div className="dim">No XIVStats data for this sector yet, so it can't set a goal.</div> : (
                <div className="finder-row">
                  <label className="finder-field">Loot tier
                    <select value={g.tier} onChange={(e) => change(i, { tier: Number(e.target.value) })}>
                      <option value={0}>Any</option><option value={2}>T2</option><option value={3}>T3</option>
                    </select>
                  </label>
                  <label className="finder-check"><input type="checkbox" checked={g.optimal} onChange={(e) => change(i, { optimal: e.target.checked })} /> Optimal retrieval</label>
                  <label className="finder-check"><input type="checkbox" checked={g.doubleDip} onChange={(e) => change(i, { doubleDip: e.target.checked })} /> Double dip</label>
                  <label className="finder-field">Items
                    <select value="" onChange={(e) => { const id = Number(e.target.value); if (id && !g.items.includes(id)) change(i, { items: [...g.items, id] }); }}>
                      <option value="">Add an item…</option>
                      {(s.items || []).filter((it) => !g.items.includes(it.itemId)).map((it) => <option key={it.itemId} value={it.itemId}>{it.name} (T{it.tier})</option>)}
                    </select>
                  </label>
                  {g.items.map((id) => (
                    <span key={id} className="planner-chip">{(itemOf.get(id) || {}).name || `Item ${id}`} <span className="finder-tier">T{(itemOf.get(id) || {}).tier}</span>
                      <button title="Remove" onClick={() => change(i, { items: g.items.filter((x) => x !== id) })}>×</button></span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </section>

      <div className="finder-row finder-options">
        <label className="finder-field">Sort by
          <select value={sortBy} onChange={(e) => { setSortBy(e.target.value); finderSort.resetSort(() => {}); }}>
            {FINDER_SORTS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </label>
        <label className="finder-check" title="Leave out builds that reach the goals only by the lower of XIVStats' and Pepper's figures">
          <input type="checkbox" checked={sureOnly} onChange={(e) => setSureOnly(e.target.checked)} /> Only builds sure to reach it
        </label>
        <span className="finder-field">Parts you own
          <PlannerSubPicker subs={base.subs} chosen={forSub} onChoose={setForSub} />
          {forSub ? <button className="link-button" onClick={() => setForSub(null)}>Whole fleet</button> : <span className="dim">whole fleet</span>}
        </span>
      </div>

      {found && found.error && <div className="error">Couldn't find builds: {found.error}</div>}
      {found && found.need && (
        <section className="finder-band">
          <h2 className="finder-heading">Builds that get it {busy && <span className="count">working out…</span>}</h2>
          <div className="finder-needs">
            {FINDER_NEEDED.filter(([k]) => found.need[k]).map(([k, label]) => {
              const bp = found.need[k];
              const differ = bp.low !== bp.high;
              return (
                <span key={k} className={`finder-need${differ ? ' warn' : ''}`} title={found.why[k].join(', ')}>
                  <span className="k">{label}</span><span className="v">{finderNeedText(bp)}</span>
                  <span className="why">for {found.why[k].join(', ')}{differ ? ' · sources differ' : ''}</span>
                </span>
              );
            })}
            {!FINDER_NEEDED.some(([k]) => found.need[k]) && (
              <span className="finder-need"><span className="k">Stats</span><span className="v">any</span><span className="why">no goal needs a stat</span></span>
            )}
            <span className="finder-need"><span className="k">Rank</span><span className="v">{found.minRank}+</span><span className="why">for {found.sectorLetters.join(', ')}</span></span>
            <span className="finder-need"><span className="k">Range</span><span className="v">{plannerN(found.rangeNeeded)}</span>
              <span className="why">route {found.route.map((id) => (sectorOf.get(id) || {}).letter).join('-')}</span></span>
          </div>
          {found.missing.length > 0 && <div className="tone-warn">No loot data yet for {found.missing.join(', ')}: its goals are left out.</div>}
          <div className="finder-tally">
            <span><b>{plannerN(found.total)}</b> build{found.total === 1 ? '' : 's'}</span>
            <span className="good"><b>{plannerN(found.sure)}</b> sure</span>
            {found.total - found.sure > 0 && <span className="warn"><b>{plannerN(found.total - found.sure)}</b> might not</span>}
            <span className={found.outOfRange ? 'bad' : ''}><b>{plannerN(found.outOfRange)}</b> out of range</span>
          </div>
          <div className="finder-legend">
            <span className="finder-parts"><span className="finder-part own">C</span></span> you own it
            <span className="finder-parts"><span className="finder-part get">C+</span></span> still to get
            <span className="finder-maybe">might not</span> only the lower of the two sources' figures is met
          </div>

          {rows.length > 0 && (
            <React.Fragment>
              <div className="controls finder-columns"><ColumnPicker cols={cols} /></div>
              <div className="finder-table">
                <table>
                  <thead><tr><ColumnHeadCells cols={cols} sortColumn={finderSort.sortColumn} sortDirection={finderSort.sortDirection} onSortClick={(k) => finderSort.handleSortClick(k)} /></tr></thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const g = groupOf(r);
                      const heading = grouped && (i === 0 || groupOf(rows[i - 1]) !== g);
                      return (
                        <React.Fragment key={r.parts.join('|')}>
                          {heading && (
                            <tr className="finder-group"><td colSpan={cols.visibleDefs.length}>
                              {g === 'out' ? <React.Fragment>Out of range <span className="sub">{plannerN(found.outOfRange)} builds</span></React.Fragment>
                                : <React.Fragment>Rank {g} <span className="sub">{plannerN(found.byRank[g] || 0)} build{found.byRank[g] === 1 ? '' : 's'}</span></React.Fragment>}
                            </td></tr>
                          )}
                          <tr className={r.rangeShort > 0 ? 'finder-out' : ''}><ColumnBodyCells cols={cols} row={r} ctx={ctx} /></tr>
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {found.total > found.rows.length && <div className="finder-more dim">Showing the first {found.rows.length} of {plannerN(found.total)}, by {FINDER_SORTS.find(([k]) => k === sortBy)[1].toLowerCase()}.</div>}
            </React.Fragment>
          )}
          {rows.length === 0 && !busy && (
            <div className="status">No build reaches all of that at any rank{sureOnly ? ' for sure (untick "Only builds sure to reach it" to see the near ones)' : ''}.</div>
          )}
        </section>
      )}

      <div className="planner-foot dim">
        Breakpoints: XIVStats{base.about.pepper ? ", checked against Pepper's FFXIV Ship Guide" : ''}. Every rank and part combination (10,000 builds a
        rank) is checked. Parts you own: fitted on a sub, or spare in a bag, a retainer or the FC chest.
      </div>
    </div>
  );
}
