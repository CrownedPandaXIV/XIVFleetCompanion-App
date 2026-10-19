// Route Optimization tab: subs whose current route is not the best one for their rank.

// Route Optimization: subs at rank 85+ whose current route doesn't
// match their computed Target Route. Route mismatch is the primary
// signal (not just a gil/day comparison), since a sub can be on a
// suboptimal route even with no Fight Club data for its current route
// (current_gil_day blank) - it should still show up here as worth
// switching. Gil/Day Gain is shown when both values are computable,
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

// The Route Optimization tab's own columns (rows are subs that are not on their Target Route).
const ROUTE_OPT_COLUMN_DEFS = [
  { key: 'character', label: 'Character', locked: true, cell: (r) => r.character_name, sort: (r) => r.character_name },
  { key: 'world', label: 'World', cell: (r) => r.world, sort: (r) => r.world },
  { key: 'sub', label: 'Sub', cell: (r) => r.sub_name, sort: (r) => r.sub_name },
  { key: 'currentRoute', label: 'Current Route', cell: (r) => r.current_route || '—', sort: (r) => r.current_route || null },
  { key: 'currentGilDay', label: 'Current Gil/Day', cell: (r) => formatGilDay(r.current_gil_day), sort: (r) => (typeof r.current_gil_day === 'number' ? r.current_gil_day : null) },
  { key: 'targetRoute', label: 'Target Route', cell: (r) => r.target_route, sort: (r) => r.target_route || null },
  { key: 'targetGilDay', label: 'Target Gil/Day', cell: (r) => formatGilDay(r.target_gil_day), sort: (r) => (typeof r.target_gil_day === 'number' ? r.target_gil_day : null) },
  { key: 'gain', label: 'Gil/Day Gain', cell: (r) => (r.gain === null ? '—' : `+${r.gain.toLocaleString()}`), sort: (r) => r.gain }
];
const ROUTE_OPT_DUPLICATE_EXTRAS = ['x_world'];

function RouteOptimizationView({ refreshKey }) {
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
      } else {
        setError(result.error);
      }
    });
  }, [refreshKey]);

  if (error) return <div className="error">Failed to load: {error}</div>;
  if (rows === null) return <div className="status">Loading...</div>;

  const suboptimal = computeSuboptimalSubs(routeOptCols.rows);

  const table = (rowsToShow) => (
    <table>
      <thead>
        <tr><ColumnHeadCells cols={routeOptCols} sortColumn={routeOptSort.sortColumn} sortDirection={routeOptSort.sortDirection} onSortClick={routeOptSortOnClick} /></tr>
      </thead>
      <tbody>
        {rowsToShow.map((r) => (
          <tr key={`${r.cid}-${r.sub_name}`}><ColumnBodyCells cols={routeOptCols} row={r} /></tr>
        ))}
      </tbody>
    </table>
  );

  const routeOptSorted = routeOptSort.sortColumn
    ? applyColumnSort(suboptimal, routeOptSort.sortColumn, routeOptSort.sortDirection, routeOptCols.accessors)
    : suboptimal;

  return (
    <div>
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
        <div className="status">Every rank-85+ sub is already on its Target Route.</div>
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
