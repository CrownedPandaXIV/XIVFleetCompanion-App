// Salvage tab: salvage counts and gil value per character.

function SalvageBreakdownCell({ total, breakdown }) {
  const [hovering, setHovering] = useState(false);

  return (
    <td
      style={{ position: 'relative', cursor: breakdown.length > 0 ? 'help' : 'default' }}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      {total}
      {hovering && breakdown.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            zIndex: 20,
            background: '#1a1d24',
            border: '1px solid #333',
            padding: '8px',
            minWidth: '260px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)'
          }}
        >
          <table style={{ width: '100%' }}>
            <thead>
              <tr>
                <th style={{ padding: '2px 6px' }}>Piece</th>
                <th style={{ padding: '2px 6px' }}>Qty</th>
                <th style={{ padding: '2px 6px' }}>Price</th>
                <th style={{ padding: '2px 6px' }}>Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.map((item) => (
                <tr key={item.item_id}>
                  <td style={{ padding: '2px 6px' }}>{item.name}</td>
                  <td style={{ padding: '2px 6px' }}>{item.qty}</td>
                  <td style={{ padding: '2px 6px' }}>{item.price.toLocaleString()}</td>
                  <td style={{ padding: '2px 6px' }}>{item.subtotal.toLocaleString()}</td>
                </tr>
              ))}
              <tr style={{ borderTop: '1px solid #333' }}>
                <td style={{ padding: '4px 6px', fontWeight: 600 }} colSpan={3}>Total</td>
                <td style={{ padding: '4px 6px', fontWeight: 600 }}>
                  {breakdown.reduce((sum, item) => sum + item.subtotal, 0).toLocaleString()}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </td>
  );
}

// The Salvage tab's own columns (rows are characters).
const SALVAGE_COLUMN_DEFS = [
  { key: 'character', label: 'Character', locked: true, cell: (r) => <>{r.character_name}<TrendDetailLink kind="character" id={r.cid} name={r.character_name} /></>, sort: (r) => r.character_name },
  { key: 'world', label: 'World', cell: (r) => r.world, sort: (r) => r.world },
  { key: 'standard', label: 'Standard Salvage', td: (r) => <SalvageBreakdownCell total={r.standard_total} breakdown={r.standard_breakdown} />, sort: (r) => r.standard_total },
  { key: 'extravagant', label: 'Extravagant Salvage', td: (r) => <SalvageBreakdownCell total={r.extravagant_total} breakdown={r.extravagant_breakdown} />, sort: (r) => r.extravagant_total },
  { key: 'value', label: 'Value', cell: (r) => Number(r.calculated_gil).toLocaleString(), sort: (r) => Number(r.calculated_gil) }
];
// Master-list columns the Salvage tab already has of its own.
const SALVAGE_DUPLICATE_EXTRAS = ['x_world'];

function SalvageView({ refreshKey }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [groupByAccountEnabled, setGroupByAccountEnabled] = useState(true);

  const salvageSort = useColumnSort();
  const salvageCols = useTableColumns({
    tableKey: 'salvage',
    ownDefs: SALVAGE_COLUMN_DEFS,
    subject: 'character',
    excludeExtras: SALVAGE_DUPLICATE_EXTRAS,
    rows,
    idOf: (r) => r.cid,
    refreshKey
  });
  const salvageSortOnClick = (col) => salvageSort.handleSortClick(col, groupByAccountEnabled, setGroupByAccountEnabled);

  useEffect(() => {
    window.api.getSalvage().then((result) => {
      if (result.success) {
        setRows(sortRows(result.rows));
      } else {
        setError(result.error);
      }
    });
  }, [refreshKey]);

  if (error) return <div className="error">Failed to load: {error}</div>;
  if (rows === null) return <div className="status">Loading...</div>;

  const fleetTotal = rows.reduce((sum, r) => sum + Number(r.calculated_gil), 0);

  const table = (rowsToShow) => (
    <table>
      <thead>
        <tr><ColumnHeadCells cols={salvageCols} sortColumn={salvageSort.sortColumn} sortDirection={salvageSort.sortDirection} onSortClick={salvageSortOnClick} /></tr>
      </thead>
      <tbody>
        {rowsToShow.map((r) => (
          <tr key={r.cid}><ColumnBodyCells cols={salvageCols} row={r} /></tr>
        ))}
      </tbody>
    </table>
  );

  const salvageSorted = salvageSort.sortColumn
    ? applyColumnSort(salvageCols.rows, salvageSort.sortColumn, salvageSort.sortDirection, salvageCols.accessors)
    : salvageCols.rows;

  return (
    <div>
      <div className="controls">
        {!salvageSort.sortColumn && (
          <label>
            <input
              type="checkbox"
              checked={groupByAccountEnabled}
              onChange={(e) => setGroupByAccountEnabled(e.target.checked)}
            />
            {' '}Group by account
          </label>
        )}
        {salvageSort.sortColumn && (
          <button onClick={() => salvageSort.resetSort(setGroupByAccountEnabled)}>Reset Sorting</button>
        )}
        <span style={{ marginLeft: '16px' }}><ColumnPicker cols={salvageCols} /></span>
      </div>

      <h2 style={{ padding: '8px 24px' }}>Fleet Total: {fleetTotal.toLocaleString()} gil</h2>

      <TrendCard title="Salvage value, whole fleet (gil)" metricKey="salvage_value" collapsible storageKey="trendCard:salvage" refreshKey={refreshKey} />

      {rows.length === 0 && <div className="status">No salvage found.</div>}

      {rows.length > 0 && salvageSort.sortColumn && table(salvageSorted)}

      {rows.length > 0 && !salvageSort.sortColumn && groupByAccountEnabled &&
        groupByAccount(salvageCols.rows).map((group) => (
          <div key={group.label} className="account-group">
            <h1 style={{ fontSize: '17px', padding: '16px 24px 4px' }}>{group.label}</h1>
            {table(group.rows)}
          </div>
        ))}

      {rows.length > 0 && !salvageSort.sortColumn && !groupByAccountEnabled && table(salvageCols.rows)}
    </div>
  );
}
