// Route Optimization page: subs whose current route is not the best one for their rank.

// Route Optimization: subs at rank 85+ whose current route doesn't
// match their computed Target route. Route mismatch is the primary
// signal (not just a gil/day comparison), since a sub can be on a
// suboptimal route even with no Fight Club data for its current route
// (current_gil_day blank) - it should still show up here as worth
// switching. Gil/day gain is shown when both values are computable,
// otherwise left blank rather than guessed.
// Shared with SummaryView's count, so the two never disagree - subs at
// rank 85+ whose current route doesn't match their computed Target
// Route.
function computeSuboptimalSubs(rows) {
  return rows
    .filter((r) => r.target_route && r.target_route !== r.current_route)
    .map((r) => {
      const bothNumeric = typeof r.current_gil_day === 'number' && typeof r.target_gil_day === 'number';
      return { ...r, gain: bothNumeric ? r.target_gil_day - r.current_gil_day : null };
    })
    .sort((a, b) => {
      if (a.gain !== null && b.gain !== null) return b.gain - a.gain;
      if (a.gain !== null) return -1;
      if (b.gain !== null) return 1;
      return 0;
    });
}

// When no sub is off its Target route: why, so "all on target" isn't said when there was nothing to compare
// (as the plugin's SubRoutes.NothingToSwitch).
function routesNothingText(subs) {
  const from85 = subs.filter((s) => Number(s.rank) >= 85);
  if (from85.length === 0) return 'No sub is rank 85 yet: Target routes start at rank 85, as in Fight Club.';
  if (!from85.some((s) => s.target_route)) {
    return "No sub from rank 85 has a Target route: Fight Club Data isn't imported (Settings → Data → Fight Club Data), or lists nothing for their ranks.";
  }
  return 'Every sub from rank 85 is on its Target route.';
}

// The Route Optimization page's own columns (rows are subs that are not on their Target route).
const ROUTE_OPT_COLUMN_DEFS = [
  { key: 'character', label: 'Character', locked: true, cell: (r) => <CharacterName name={r.character_name} world={r.world} />, sort: (r) => r.character_name },
  { key: 'sub', label: 'Sub', cell: (r) => r.sub_name, sort: (r) => r.sub_name },
  { key: 'currentRoute', label: 'Current route', cell: (r) => r.current_route || '—', sort: (r) => r.current_route || null },
  { key: 'currentGilDay', label: 'Current gil/day', cell: (r) => <GilDay value={r.current_gil_day} />, sort: (r) => (typeof r.current_gil_day === 'number' ? r.current_gil_day : null) },
  { key: 'targetRoute', label: 'Target route', cell: (r) => <React.Fragment>{r.target_route}<FightClubBlocked blocked={r.target_blocked} /></React.Fragment>, sort: (r) => r.target_route || null },
  { key: 'targetGilDay', label: 'Target gil/day', cell: (r) => <GilDay value={r.target_gil_day} />, sort: (r) => (typeof r.target_gil_day === 'number' ? r.target_gil_day : null) },
  // Green for more gil a day, red for less (as the plugin).
  { key: 'gain', label: 'Gil/day gain', cell: (r) => (r.gain === null ? <span className="dim">—</span>
    : <span className={r.gain > 0 ? 'tone-good' : r.gain < 0 ? 'tone-danger' : ''}>{r.gain > 0 ? '+' : r.gain < 0 ? '−' : ''}{Math.abs(r.gain).toLocaleString()}</span>), sort: (r) => r.gain },
  { key: 'planner', label: 'Voyage Planner', cell: (r, ctx) => (ctx && ctx.onOpenPlanner
    ? <button type="button" className="link-button" onClick={() => ctx.onOpenPlanner(r.cid, r.sub_name)} title="Open this sub's build and route in Sub Calculator → Voyage Planner.">Open in Voyage Planner</button>
    : null) }
];
const ROUTE_OPT_DUPLICATE_EXTRAS = ['x_world'];

function RouteOptimizationView({ refreshKey, onOpenPlanner }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [groupByAccountEnabled, setGroupByAccountEnabled] = useState(true);
  const routeOptSort = useColumnSort();
  const routeOptCols = useTableColumns({
    tableKey: 'routeOpt',
    ownDefs: ROUTE_OPT_COLUMN_DEFS,
    subject: 'character',
    excludeExtras: ROUTE_OPT_DUPLICATE_EXTRAS,
    rows,
    idOf: (r) => r.cid,
    refreshKey
  });
  const routeOptSortOnClick = (col) => routeOptSort.handleSortClick(col, groupByAccountEnabled, setGroupByAccountEnabled);

  useEffect(() => {
    window.api.getSubmarines().then((result) => {
      if (result.success) {
        setRows(sortRows(result.rows));
        setError(null);
      } else {
        setError(result.error);
      }
    });
  }, [refreshKey]);

  if (error && rows === null) return <div className="error">Failed to load: {error}</div>;
  if (rows === null) return <div className="status">Loading...</div>;

  const suboptimal = computeSuboptimalSubs(routeOptCols.rows);

  const table = (rowsToShow) => (
    <table>
      <thead>
        <tr><ColumnHeadCells cols={routeOptCols} sortColumn={routeOptSort.sortColumn} sortDirection={routeOptSort.sortDirection} onSortClick={routeOptSortOnClick} /></tr>
      </thead>
      <tbody>
        {rowsToShow.map((r) => (
          <tr key={`${r.cid}-${r.sub_name}`}><ColumnBodyCells cols={routeOptCols} row={r} ctx={{ onOpenPlanner }} /></tr>
        ))}
      </tbody>
    </table>
  );

  const routeOptSorted = routeOptSort.sortColumn
    ? applyColumnSort(suboptimal, routeOptSort.sortColumn, routeOptSort.sortDirection, routeOptCols.accessors)
    : suboptimal;

  return (
    <div>
      {error && <div className="error">Could not update: {error}. Showing what was loaded before.</div>}
      <div className="controls">
        {!routeOptSort.sortColumn && (
          <label>
            <input
              type="checkbox"
              checked={groupByAccountEnabled}
              onChange={(e) => setGroupByAccountEnabled(e.target.checked)}
            />
            {' '}Group by account
          </label>
        )}
        {routeOptSort.sortColumn && (
          <button onClick={() => routeOptSort.resetSort(setGroupByAccountEnabled)}>Reset Sorting</button>
        )}
        <span style={{ marginLeft: '16px' }}><ColumnPicker cols={routeOptCols} /></span>
      </div>

      {suboptimal.length === 0 && (
        <div className="status">{routesNothingText(rows)}</div>
      )}

      {suboptimal.length > 0 && routeOptSort.sortColumn && table(routeOptSorted)}

      {suboptimal.length > 0 && !routeOptSort.sortColumn && groupByAccountEnabled &&
        groupByAccount(suboptimal).map((group) => (
          <div key={group.label} className="account-group">
            <h2>{group.label} <span className="count">({group.rows.length})</span></h2>
            {table(group.rows)}
          </div>
        ))}

      {suboptimal.length > 0 && !routeOptSort.sortColumn && !groupByAccountEnabled && table(suboptimal)}
    </div>
  );
}
