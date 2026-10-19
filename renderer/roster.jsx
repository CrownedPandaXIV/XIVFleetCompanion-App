// Character Roster tab: the roster table's columns and drag-to-reorder rows.

// The Character Roster's own columns. `cell` draws a row's cell, `sort` gives the value to sort by, and
// `cellStyle` is optional. Anything else comes from the master list (column-catalog.js).
// Roster columns only for subs, and only for retainers (Settings → What do you run?).
const ROSTER_SUB_COLUMNS = ['ceruleum', 'repairKits', 'submarines'];
const ROSTER_RETAINER_COLUMNS = ['retainers'];

const ROSTER_COLUMN_DEFS = [
  { key: 'name', label: 'Name', locked: true, cell: (row) => <>{row.name}<NotSyncedTag behindMs={row.not_synced_ms} /><TrendDetailLink kind="character" id={row.cid} name={row.name} /></>, sort: (r) => r.name },
  { key: 'world', label: 'World', cell: (row) => row.world, sort: (r) => r.world },
  { key: 'fc', label: 'FC', cell: (row) => row.fc_name || '—', sort: (r) => r.fc_name || '' },
  { key: 'fcPoints', label: 'FC Points', cell: (row) => (row.fc_points === null || row.fc_points === undefined ? '—' : Number(row.fc_points).toLocaleString()), sort: (r) => (r.fc_points === null || r.fc_points === undefined ? null : Number(r.fc_points)) },
  { key: 'house', label: 'House', cell: (row) => formatHouse(row), sort: (r) => formatHouse(r) },
  { key: 'gil', label: 'Gil', cell: (row) => Number(row.gil).toLocaleString(), sort: (r) => Number(r.gil) },
  { key: 'ceruleum', label: 'Ceruleum', cell: (row) => row.ceruleum, sort: (r) => Number(r.ceruleum), cellStyle: (row) => ({ color: row.low_ceruleum ? '#e57373' : undefined }) },
  { key: 'repairKits', label: 'Repair Kits', cell: (row) => row.repair_kits, sort: (r) => Number(r.repair_kits), cellStyle: (row) => ({ color: row.low_repair ? '#e57373' : undefined }) },
  { key: 'retainers', label: 'Retainers', cell: (row) => row.retainer_count, sort: (r) => r.retainer_count },
  { key: 'submarines', label: 'Submarines', cell: (row) => row.submarine_count, sort: (r) => r.submarine_count },
  { key: 'lastSynced', label: 'Last Synced', cell: (row) => new Date(row.snapshot_at).toLocaleString(), sort: (r) => new Date(r.snapshot_at).getTime() }
];
// Master-list columns the Roster already has of its own.
const ROSTER_DUPLICATE_EXTRAS = ['x_world', 'x_gil', 'x_ceruleum', 'x_repair_kits', 'x_retainers', 'x_submarines', 'x_last_synced', 'x_house', 'x_fc_name', 'x_fc_points'];

// One sortable <tbody>. Each RosterTable manages its own SortableJS instance
// via a ref, since with "Group by account" on there are several independent
// lists (one per account) that must not let items drag between groups.
// A small × that opens a confirmation box; nothing is removed until "Yes, remove" is clicked. `what` names the
// thing ("Gus Kitteh (Maduin)"), `children` explain what removing it does. onRemove() resolves to true when it
// was removed. Also used on the PCs tab.
// label: a labelled button instead of the small ×.
function RemoveButton({ what, title, onRemove, children, label = null }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef(null);

  useEffect(() => {
    if (!confirming) return undefined;
    if (cancelRef.current) cancelRef.current.focus();
    const onKey = (e) => { if (e.key === 'Escape' && !busy) setConfirming(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirming, busy]);

  const remove = async () => {
    setBusy(true);
    const removed = await onRemove();
    if (!removed) {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <>
      {label
        ? <button className="remove-labelled" title={title} onClick={() => setConfirming(true)}>{label}</button>
        : <button className="remove-character" title={title} aria-label={`Remove ${what}`} onClick={() => setConfirming(true)}>×</button>}
      {confirming && ReactDOM.createPortal(
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) setConfirming(false); }}>
          <div className="modal remove-confirm" role="dialog" aria-label={`Remove ${what}`}>
            <h2>Remove {what}?</h2>
            {children}
            <div className="modal-actions">
              <button ref={cancelRef} disabled={busy} onClick={() => setConfirming(false)}>No</button>
              <button className="danger" disabled={busy} onClick={remove}>{busy ? 'Removing...' : 'Yes, remove'}</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

// The small × at the start of each roster row, beside the drag handle (so it is always on screen however
// wide the columns are). onRemove(row) resolves to true when the character was removed.
function RemoveCharacterButton({ row, onRemove }) {
  return (
    <RemoveButton what={`${row.name} (${row.world})`} title={`Remove ${row.name} from the app`} onRemove={() => onRemove(row)}>
      <p>
        This removes the character and what is stored for it: subs, retainers, inventory and Free Company
        details. Its chart history is kept but left out of Trends.
      </p>
      <p>
        If the plugin still syncs it, it comes back at the next sync (with its chart history), so untick it
        in the plugin's Characters list first.
      </p>
    </RemoveButton>
  );
}

function RosterTable({ rows, onReorder, onRemove, cols, sortColumn, sortDirection, onSortClick }) {
  const tbodyRef = useRef(null);

  useEffect(() => {
    if (!tbodyRef.current) return;

    // Dragging is disabled while a column sort is active - the visible
    // order is computed, not the real stored order, so a drag here
    // would silently corrupt the saved sort_index with the wrong order.
    const sortable = Sortable.create(tbodyRef.current, {
      animation: 150,
      handle: '.drag-handle',
      ghostClass: 'sortable-ghost',
      disabled: !!sortColumn,
      onEnd: () => {
        const newOrderCids = Array.from(tbodyRef.current.children).map(
          (tr) => tr.dataset.cid
        );
        onReorder(newOrderCids);
      }
    });

    return () => sortable.destroy();
  }, [rows, sortColumn]);

  return (
    <table>
      <thead>
        <tr>
          <th className="row-tools"></th>
          {cols.visibleDefs.map((def) => (
            <ResizableHeader
              key={def.key}
              label={def.label}
              columnKey={def.key}
              widths={cols.widths}
              startResize={cols.startResize}
              sortable
              sortColumn={sortColumn}
              sortDirection={sortDirection}
              onSortClick={onSortClick}
              onMoveColumn={cols.move}
            />
          ))}
        </tr>
      </thead>
      <tbody ref={tbodyRef}>
        {rows.map((row) => (
          <tr key={row.cid} data-cid={row.cid}>
            <td className="row-tools"><span className="drag-handle" title="Drag to reorder">⠿</span><RemoveCharacterButton row={row} onRemove={onRemove} /></td>
            {cols.visibleDefs.map((def) => (
              <td key={def.key} style={def.cellStyle ? def.cellStyle(row) : undefined}>{def.cell(row)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
