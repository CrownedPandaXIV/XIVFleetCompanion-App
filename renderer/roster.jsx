// Character Roster tab: the roster table's columns and drag-to-reorder rows.

// The Character Roster's own columns. `cell` draws a row's cell, `sort` gives the value to sort by, and
// `cellStyle` is optional. Anything else comes from the master list (column-catalog.js).
// Roster columns only for subs, and only for retainers (Settings → What do you run?).
// "Account 2 on DESKTOP-1": the setup a character last logged in on, or "—" with none recorded.
const syncedBy = (row) => (row.login_pc ? `${row.login_label || '(no label)'} on ${row.login_pc}` : '—');

const ROSTER_SUB_COLUMNS = ['ceruleum', 'repairKits', 'submarines'];
const ROSTER_RETAINER_COLUMNS = ['retainers'];

const ROSTER_COLUMN_DEFS = [
  { key: 'name', label: 'Name', locked: true, cell: (row) => <>{row.name}<WorldAfter world={row.world} /><NotSyncedTag behindMs={row.not_synced_ms} /><TrendDetailLink kind="character" id={row.cid} name={row.name} /></>, sort: (r) => r.name },
  { key: 'fc', label: 'FC', cell: (row) => (row.fc_name ? <span className="fc-name">{row.fc_name}</span> : <span className="dim">—</span>), sort: (r) => r.fc_name || '' },
  { key: 'fcPoints', label: 'FC Points', td: (row) => <td className="num fc-points">{row.fc_points === null || row.fc_points === undefined ? '—' : Number(row.fc_points).toLocaleString()}</td>, sort: (r) => (r.fc_points === null || r.fc_points === undefined ? null : Number(r.fc_points)) },
  { key: 'house', label: 'House', cell: (row) => (row.has_house ? <span className="address">{formatHouse(row)}</span> : <span className="dim">—</span>), sort: (r) => formatHouse(r) },
  { key: 'gil', label: 'Gil', td: (row) => <td className="num"><GilText gil={row.gil} /></td>, sort: (r) => Number(r.gil) },
  // Green at or above the warning, amber under it, red under half of it (characters/roster-warnings.js).
  { key: 'ceruleum', label: 'Ceruleum', td: (row) => <td className={`num ${toneClass(row.ceruleum_tone) || 'dim'}`} title={row.low_ceruleum ? 'Below the low-ceruleum warning (Settings → General → Warnings)' : undefined}>{row.ceruleum}</td>, sort: (r) => Number(r.ceruleum) },
  { key: 'repairKits', label: 'Repair Kits', td: (row) => <td className={`num ${toneClass(row.repair_tone) || 'dim'}`} title={row.low_repair ? 'Below the low-repair-kit warning (Settings → General → Warnings)' : undefined}>{row.repair_kits}</td>, sort: (r) => Number(r.repair_kits) },
  { key: 'retainers', label: 'Retainers', td: (row) => <td className="num">{row.retainer_count}</td>, sort: (r) => r.retainer_count },
  // Subs as dots out of the slots unlocked: green when every slot has one, amber with a slot free.
  { key: 'submarines', label: 'Submarines', sort: (r) => r.submarine_count, cell: (row) => row.submarine_count,
    td: (row) => {
      const slots = Number(row.num_sub_slots) || 0;
      if (slots <= 0) return <td className="num">{row.submarine_count}</td>;
      const total = Math.max(slots, Number(row.submarine_count) || 0);
      return <td><Pips filled={Number(row.submarine_count) || 0} total={total} title={`${row.submarine_count} of ${slots} sub slot${slots === 1 ? '' : 's'} ${Number(row.submarine_count) === 1 ? 'has a sub' : 'have subs'}`} /></td>;
    } },
  // Green while synced; red when the plugin no longer syncs it (behind the rest of its account).
  { key: 'lastSynced', label: 'Last Synced', cell: (row) => <span className={row.not_synced_ms ? 'tone-danger' : 'tone-good'}>{new Date(row.snapshot_at).toLocaleString()}</span>, sort: (r) => new Date(r.snapshot_at).getTime() },
  // The setup (PC and account label) the character last logged in on: only it syncs the character (plugin 1.0.2).
  { key: 'syncedBy', label: 'Synced By', sort: (r) => syncedBy(r), cell: (row) => syncedBy(row),
    td: (row) => (
      <td className="synced-by" title={row.login_pc
        ? `Last logged in on this setup ${new Date(row.logged_in_at).toLocaleString()}. Only this setup syncs the character; others that have it leave it alone.`
        : 'No login recorded yet (it needs plugin 1.0.2): every setup that has the character syncs it.'}>{syncedBy(row)}</td>
    ) }
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
              def.td
                ? <React.Fragment key={def.key}>{def.td(row)}</React.Fragment>
                : <td key={def.key} style={def.cellStyle ? def.cellStyle(row) : undefined}>{def.cell(row)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
