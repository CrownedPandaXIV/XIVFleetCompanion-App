// Sub Calculator → Build Finder: pick sectors and what you want from each (a loot tier, optimal retrieval, a double
// dip, items), and see every build that gets it, each at the lowest rank it works (ipc/calculator.js find-sub-builds,
// subs/build-finder.js). Amber: only the lower of XIVStats' and Pepper's figures is met.

const FINDER_SORTS = [['rank', 'Lowest rank'], ['speed', 'Fastest voyage'], ['parts', 'Fewest parts still needed'], ['range', 'Most range to spare']];
const FINDER_SLOTS = ['hull', 'stern', 'bow', 'bridge'];
const finderNeedText = (bp) => (bp.low === bp.high ? plannerN(bp.low) : `${plannerN(bp.low)}–${plannerN(bp.high)}`);

// A stat with how much it has to spare over what the goals need (none asked: just the stat).
function FinderStat({ value, spare }) {
  return <React.Fragment>{plannerN(value)}{spare !== null && spare !== undefined ? <span className="dim"> +{plannerN(spare)}</span> : null}</React.Fragment>;
}

const FINDER_COLUMN_DEFS = [
  { key: 'rank', label: 'Rank', locked: true, td: (r) => (
    <td className={r.sure ? '' : 'tone-warn'} title={r.sure ? 'Sure to reach the goals at this rank' : 'Reaches them by the lower of the two sources\' figures only'}>
      {r.rank}{!r.sure && <div className="dim">{r.sureRank ? `sure from rank ${r.sureRank}` : 'never sure'}</div>}
    </td>), sort: (r) => r.rank },
  { key: 'build', label: 'Build', cell: (r) => r.parts.join(''), sort: (r) => r.parts.join('') },
  { key: 'surveillance', label: 'Surveillance', td: (r) => <td className="num"><FinderStat value={r.stats.surveillance} spare={r.spare.surveillance} /></td>, sort: (r) => r.stats.surveillance },
  { key: 'retrieval', label: 'Retrieval', td: (r) => <td className="num"><FinderStat value={r.stats.retrieval} spare={r.spare.retrieval} /></td>, sort: (r) => r.stats.retrieval },
  { key: 'favor', label: 'Favor', td: (r) => <td className="num"><FinderStat value={r.stats.favor} spare={r.spare.favor} /></td>, sort: (r) => r.stats.favor },
  { key: 'speed', label: 'Speed', td: (r) => <td className="num">{plannerN(r.stats.speed)}</td>, sort: (r) => r.stats.speed },
  { key: 'range', label: 'Range', td: (r) => (r.rangeShort > 0
    ? <td className="tone-danger">{plannerN(r.stats.range)}: needs {plannerN(r.rangeShort)} more for these sectors
      <div className="dim">{r.inRangeFrom ? `in range from rank ${r.inRangeFrom}` : 'not in range at any rank'}</div></td>
    : <td className="num">{plannerN(r.stats.range)}{r.rangeNeeded !== null && <span className="dim"> +{plannerN(r.stats.range - r.rangeNeeded)}</span>}</td>),
  sort: (r) => r.stats.range - (r.rangeNeeded || 0) },
  { key: 'voyage', label: 'Voyage', td: (r) => <td className="num">{r.hours ? plannerHours(r.hours) : '—'}</td>, sort: (r) => r.hours },
  { key: 'parts', label: 'Parts to get', cell: (r) => (!r.missingParts ? '—' : r.missingParts.length === 0 ? <span className="tone-good">All owned</span>
    : r.missingParts.map((p) => `${p.letter} ${FINDER_SLOTS[p.slot]}`).join(', ')), sort: (r) => (r.missingParts ? r.missingParts.length : null) },
  { key: 'planner', label: 'Planner', cell: (r, ctx) => (ctx && ctx.onOpen
    ? <button type="button" className="link-button" onClick={() => ctx.onOpen(r)} title="Open this build and the route in Sub Calculator → Planner.">Open in Planner</button> : null) },
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

  const finderSort = useColumnSort();
  const cols = useTableColumns({ tableKey: 'buildFinder', ownDefs: FINDER_COLUMN_DEFS, rows: found && found.rows ? found.rows : null, idOf: () => null });

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
  const open = (r) => onOpenPlanner({ rank: r.rank, parts: r.parts, route: found.route });

  return (
    <div className="planner finder">
      <div className="account-group planner-panel finder-goals">
        <h2>What you want <span className="count">{goals.length} of 5 sectors</span></h2>
        <div className="planner-fields">
          <label>Map
            <select value={mapId ?? ''} onChange={(e) => { setMapId(Number(e.target.value)); setGoals([]); }}>
              {base.maps.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <label>Add a sector
            <span className="planner-add">
              <select value={adding} onChange={(e) => setAdding(e.target.value)} disabled={goals.length >= 5}>
                {onMap.map((s) => <option key={s.id} value={s.id}>{s.letter}: {s.name} (rank {s.rankReq}){s.hasData ? '' : ', no loot data yet'}</option>)}
              </select>
              <button onClick={add} disabled={goals.length >= 5 || !onMap.length}>Add</button>
            </span>
          </label>
        </div>
        {goals.length === 0 && <div className="dim finder-empty">Add up to 5 sectors, then say what you want from each.</div>}
        {goals.map((g, i) => {
          const s = sectorOf.get(g.sectorId) || { letter: '?', name: `Sector ${g.sectorId}`, items: [] };
          const itemOf = new Map((s.items || []).map((it) => [it.itemId, it]));
          return (
            <div key={g.sectorId} className="finder-goal">
              <div className="finder-goal-name">{s.letter}: {s.name} <span className="dim">(rank {s.rankReq})</span>
                <button className="link-button" onClick={() => setGoals(goals.filter((_, j) => j !== i))}>Remove</button></div>
              {!s.hasData ? <div className="dim">No XIVStats data for this sector yet, so it can't set a goal.</div> : (
                <div className="finder-goal-fields">
                  <label>Loot tier
                    <select value={g.tier} onChange={(e) => change(i, { tier: Number(e.target.value) })}>
                      <option value={0}>Any</option><option value={2}>T2</option><option value={3}>T3</option>
                    </select>
                  </label>
                  <label><input type="checkbox" checked={g.optimal} onChange={(e) => change(i, { optimal: e.target.checked })} /> Optimal retrieval</label>
                  <label><input type="checkbox" checked={g.doubleDip} onChange={(e) => change(i, { doubleDip: e.target.checked })} /> Double dip</label>
                  <label>Items
                    <select value="" onChange={(e) => { const id = Number(e.target.value); if (id && !g.items.includes(id)) change(i, { items: [...g.items, id] }); }}>
                      <option value="">Add an item…</option>
                      {(s.items || []).filter((it) => !g.items.includes(it.itemId)).map((it) => <option key={it.itemId} value={it.itemId}>{it.name} (T{it.tier})</option>)}
                    </select>
                  </label>
                  {g.items.map((id) => (
                    <span key={id} className="planner-chip">{(itemOf.get(id) || {}).name || `Item ${id}`} <span className="dim">T{(itemOf.get(id) || {}).tier}</span>
                      <button title="Remove" onClick={() => change(i, { items: g.items.filter((x) => x !== id) })}>×</button></span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="controls finder-options">
        <label>Sort by{' '}
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            {FINDER_SORTS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </label>
        <label title="Leave out builds that reach the goals only by the lower of XIVStats' and Pepper's figures">
          <input type="checkbox" checked={sureOnly} onChange={(e) => setSureOnly(e.target.checked)} /> Only builds sure to reach it
        </label>
        <label>Parts you own:</label>
        <PlannerSubPicker subs={base.subs} chosen={forSub} onChoose={setForSub} />
        {forSub ? <button className="link-button" onClick={() => setForSub(null)}>Whole fleet</button> : <span className="dim">whole fleet</span>}
      </div>

      {found && found.error && <div className="error">Couldn't find builds: {found.error}</div>}
      {found && found.need && (
        <div className="finder-summary">
          <div>
            Needs {['surveillance', 'retrieval', 'favor'].filter((k) => found.need[k]).map((k) => (
              <span key={k} className="finder-need" title={found.why[k].join(', ')}>{k} {finderNeedText(found.need[k])}{found.need[k].low !== found.need[k].high ? ' (sources differ)' : ''}</span>
            ))}
            {!['surveillance', 'retrieval', 'favor'].some((k) => found.need[k]) && <span className="finder-need">no stat (any build will do)</span>}
            <span className="finder-need">rank {found.minRank}+ for these sectors</span>
            <span className="finder-need">range {plannerN(found.rangeNeeded)} (best order: {found.route.map((id) => (sectorOf.get(id) || {}).letter).join('-')})</span>
          </div>
          {found.missing.length > 0 && <div className="tone-warn">No loot data yet for {found.missing.join(', ')}: its goals are left out.</div>}
          <div className="dim">
            {busy ? 'Working out…' : `${plannerN(found.total)} build${found.total === 1 ? '' : 's'} reach it (${plannerN(found.sure)} sure, ${plannerN(found.outOfRange)} out of range).`}
            {found.total > found.rows.length ? ` Showing the first ${found.rows.length}.` : ''}
            {' '}Each at the lowest rank it works; amber where only the lower of XIVStats' and Pepper's figures is met.
          </div>
        </div>
      )}
      {found && found.rows && found.rows.length > 0 && (
        <div className="account-group">
          <div className="controls"><ColumnPicker cols={cols} /></div>
          <ColumnTable cols={cols} sort={finderSort} rows={cols.rows} rowKey={(r) => r.parts.join('|')} ctx={{ onOpen: open }}
            rowClassName={(r) => (r.rangeShort > 0 ? 'finder-out' : '')} />
        </div>
      )}
      {found && found.rows && found.rows.length === 0 && !busy && (
        <div className="status">No build reaches all of that at any rank{sureOnly ? ' for sure (untick "Only builds sure to reach it" to see the near ones)' : ''}.</div>
      )}

      <div className="planner-foot dim">
        Breakpoints: XIVStats{base.about.pepper ? ", checked against Pepper's FFXIV Ship Guide" : ''}. Every rank and part combination (10,000 builds a
        rank) is checked. Parts you own: fitted on a sub, or spare in a bag, a retainer or the FC chest.
      </div>
    </div>
  );
}
