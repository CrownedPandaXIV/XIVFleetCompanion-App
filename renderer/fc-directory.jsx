// Free Companies tab: every Free Company with its members and house.

function HouseCell({ row }) {
  const [hovering, setHovering] = useState(false);
  const showTooltip = !row.has_house && !!row.eligible_at;

  return (
    <td
      style={{ position: 'relative', cursor: showTooltip ? 'help' : 'default' }}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      {row.has_house ? formatHouse(row) : (row.eligibility || '—')}
      {hovering && showTooltip && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            zIndex: 20,
            background: '#1a1d24',
            border: '1px solid #333',
            padding: '8px',
            width: 'max-content',
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)'
          }}
        >
          <div style={{ padding: '2px 6px', whiteSpace: 'nowrap' }}>
            {new Date(row.eligible_at).toLocaleString()}
          </div>
        </div>
      )}
    </td>
  );
}

// The Free Companies tab's own columns. Anything else (members' totals, the FC chest, ...) comes from the master list.
const FC_COLUMN_DEFS = [
  { key: 'fcName', label: 'FC Name', locked: true, cell: (r) => <>{r.fc_name || '—'}{r.fc_id && <TrendDetailLink kind="fc" id={r.fc_id} name={r.fc_name || 'Free Company'} />}</>, sort: (r) => r.fc_name },
  { key: 'leader', label: 'Leader', cell: (r) => r.fc_master || '—', sort: (r) => r.fc_master },
  { key: 'world', label: 'World', cell: (r) => r.fc_world || '—', sort: (r) => r.fc_world },
  { key: 'points', label: 'FC Points', cell: (r) => (typeof r.fc_points === 'number' ? r.fc_points.toLocaleString() : '—'), sort: (r) => (typeof r.fc_points === 'number' ? r.fc_points : null) },
  { key: 'members', label: 'Members', cell: (r) => (typeof r.total_members === 'number' ? r.total_members : '—'), sort: (r) => (typeof r.total_members === 'number' ? r.total_members : null) },
  { key: 'house', label: 'House', td: (r) => <HouseCell row={r} />, sort: (r) => (r.has_house ? 1 : 0) },
  // Unknown dates sort as the oldest, since they are the ones to check.
  { key: 'lastEntered', label: 'Last Entered', cell: (r) => <HouseAge row={r} />, sort: (r) => (!r.has_house ? null : (r.house_days ?? 9999)) }
];
// Master-list columns the Free Companies tab already has of its own: none (the "Rank" and "Account" ones are new here).
const FC_DUPLICATE_EXTRAS = [];

function FCDirectoryView({ refreshKey }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [groupByAccountEnabled, setGroupByAccountEnabled] = useState(true);

  const fcCols = useTableColumns({
    tableKey: 'fcDirectory',
    ownDefs: FC_COLUMN_DEFS,
    subject: 'fc',
    excludeExtras: FC_DUPLICATE_EXTRAS,
    rows,
    idOf: (r) => r.fc_id,
    refreshKey
  });
  const fcSort = useColumnSort();
  const fcSortOnClick = (col) => fcSort.handleSortClick(col, groupByAccountEnabled, setGroupByAccountEnabled);

  useEffect(() => {
    window.api.getFcDirectory().then((result) => {
      if (result.success) {
        setRows(result.rows);
      } else {
        setError(result.error);
      }
    });
  }, [refreshKey]);

  if (error) return <div className="error">Failed to load: {error}</div>;
  if (rows === null) return <div className="status">Loading...</div>;

  const shownRows = fcCols.rows;
  const table = (rowsToShow) => (
    <table>
      <thead>
        <tr><ColumnHeadCells cols={fcCols} sortColumn={fcSort.sortColumn} sortDirection={fcSort.sortDirection} onSortClick={fcSortOnClick} /></tr>
      </thead>
      <tbody>
        {rowsToShow.map((r) => (
          <tr key={r.fc_id}><ColumnBodyCells cols={fcCols} row={r} /></tr>
        ))}
      </tbody>
    </table>
  );

  const fcSorted = applyColumnSort(shownRows, fcSort.sortColumn, fcSort.sortDirection, fcCols.accessors);

  return (
    <div className="fc-directory-view">
      <div className="controls">
        {!fcSort.sortColumn && (
          <label>
            <input
              type="checkbox"
              checked={groupByAccountEnabled}
              onChange={(e) => setGroupByAccountEnabled(e.target.checked)}
            />
            {' '}Group by account
          </label>
        )}
        {fcSort.sortColumn && (
          <button onClick={() => fcSort.resetSort(setGroupByAccountEnabled)}>Reset Sorting</button>
        )}
        <span style={{ marginLeft: '16px' }}><ColumnPicker cols={fcCols} /></span>
      </div>

      <TrendCard title="FC points, all Free Companies (total)" metricKey="fc_points" collapsible storageKey="trendCard:fcPoints" refreshKey={refreshKey} />

      {rows.length === 0 && <div className="status">No Free Companies found.</div>}

      {rows.length > 0 && fcSort.sortColumn && table(fcSorted)}

      {rows.length > 0 && !fcSort.sortColumn && groupByAccountEnabled &&
        groupByAccount(shownRows).map((group) => (
          <div key={group.label} className="account-group">
            <h1 style={{ fontSize: '17px', padding: '16px 24px 4px' }}>{group.label}</h1>
            {table(group.rows)}
          </div>
        ))}

      {rows.length > 0 && !fcSort.sortColumn && !groupByAccountEnabled && table(shownRows)}
    </div>
  );
}
