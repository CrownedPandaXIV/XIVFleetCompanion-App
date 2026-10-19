// Shared table pieces used by every tab: resizable and movable columns, the column picker, sorting,
// and small row helpers (character names, account grouping, house text).

const { useState, useEffect, useRef } = React;

// Shared resizable-column mechanism, used by every table in the app.
// Widths persist per-machine (localStorage), keyed by a stable
// per-table id so different tables' column sets never collide.
// columnKeys/defaultWidths only used to seed a table's FIRST run;
// after that, whatever's saved wins.
function useColumnWidths(tableKey, columnKeys, defaultWidth = 150) {
  const storageKey = `colWidths:${tableKey}`;
  const [widths, setWidths] = useState(() => {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
    } catch {
      saved = {};
    }
    const result = {};
    columnKeys.forEach((k) => {
      result[k] = saved[k] || defaultWidth;
    });
    return result;
  });
  const widthsRef = useRef(widths);
  widthsRef.current = widths;

  function persist(newWidths) {
    widthsRef.current = newWidths;
    setWidths(newWidths);
    localStorage.setItem(storageKey, JSON.stringify(newWidths));
  }

  function startResize(columnKey, e) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = widthsRef.current[columnKey] || defaultWidth;

    function onMove(moveEvent) {
      const delta = moveEvent.clientX - startX;
      const newWidth = Math.max(10, startWidth + delta);
      persist({ ...widthsRef.current, [columnKey]: newWidth });
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  return { widths, startResize };
}

// ---- Table columns: each table's own columns plus the master list -----------------------------------------
// A table shows a chosen, ordered set of columns. Its own columns are defined next to the table; the master
// list (column-catalog.js) adds more that can be picked in the Columns menu, for tables whose rows are about a
// character or a Free Company. The choice is remembered per table on this computer, like the column widths.
// Only the extra columns actually shown are fetched from the database.

let columnCatalogPromise = null;
function loadColumnCatalog() {
  if (!columnCatalogPromise) {
    columnCatalogPromise = window.api.getColumnCatalog()
      .then((r) => (r.success ? r.catalog : {}))
      .catch(() => ({}));
  }
  return columnCatalogPromise;
}

function formatExtraValue(value, type, loaded) {
  if (value === undefined) return loaded ? '—' : '…';
  if (value === null) return '—';
  if (type === 'number') return Number(value).toLocaleString();
  if (type === 'date') return new Date(value).toLocaleString();
  return String(value);
}

function makeExtraDef(entry) {
  return {
    key: entry.key,
    label: entry.label,
    group: entry.group,
    type: entry.type,
    extra: true,
    cell: (row) => formatExtraValue(row.__x ? row.__x[entry.key] : undefined, entry.type, !!row.__x),
    sort: (row) => {
      const v = row.__x ? row.__x[entry.key] : null;
      if (v === null || v === undefined) return null;
      return entry.type === 'date' ? Date.parse(v) : v;
    }
  };
}

// Options:
//   tableKey      storage name, e.g. 'roster'
//   ownDefs       the table's own columns: { key, label, cell(row), sort?(row), cellStyle?(row), locked?, default? }
//   subject       'character' or 'fc' to offer the master list; omit for a table with only its own columns
//   excludeExtras master-list keys that duplicate one of the table's own columns
//   rows, idOf    the table's rows and how to read the character / Free Company id from a row
//   contextKeys, contextActive   own columns that appear automatically while contextActive is true
function useTableColumns({ tableKey, ownDefs, subject = null, excludeExtras = [], rows, idOf, refreshKey = 0, contextKeys = [], contextActive = false }) {
  const storageKey = `colLayout2:${tableKey}`;
  const [catalog, setCatalog] = useState(null);
  useEffect(() => {
    if (subject) loadColumnCatalog().then(setCatalog);
  }, [subject]);

  const extraDefs = React.useMemo(() => {
    if (!subject || !catalog || !catalog[subject]) return [];
    return catalog[subject].filter((e) => !excludeExtras.includes(e.key)).map(makeExtraDef);
  }, [catalog, subject]);
  const defs = React.useMemo(() => [...ownDefs, ...extraDefs], [ownDefs, extraDefs]);
  const defByKey = new Map(defs.map((d) => [d.key, d]));

  const ownKeys = ownDefs.map((d) => d.key);
  const lockedKeys = ownDefs.filter((d) => d.locked).map((d) => d.key);
  const defaultKeys = ownDefs.filter((d) => d.default !== false).map((d) => d.key);

  const [saved, setSaved] = useState(() => {
    try {
      const s = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (s && Array.isArray(s.shown) && Array.isArray(s.known)) return s;
    } catch { /* ignore */ }
    return null;
  });

  // Shown columns: the saved choice (columns that no longer exist are skipped), plus own default columns added by
  // a later version, plus any locked column.
  let shown = saved ? saved.shown : defaultKeys;
  if (saved) {
    const fresh = defaultKeys.filter((k) => !saved.known.includes(k) && !shown.includes(k));
    shown = [...shown, ...fresh];
  }
  shown = [...lockedKeys.filter((k) => !shown.includes(k)), ...shown];
  const visible = shown.filter((k) => defByKey.has(k));
  // "Context" columns (for example Character and World on a table that is normally split into one table per
  // character) are added in front automatically whenever `contextActive` is true, unless already shown.
  const shownWithContext = contextActive ? [...contextKeys.filter((k) => !visible.includes(k) && defByKey.has(k)), ...visible] : visible;
  const visibleDefs = shownWithContext.map((k) => defByKey.get(k));
  const available = defs.filter((d) => !visible.includes(d.key));

  function persist(nextShown) {
    const next = { shown: nextShown, known: ownKeys };
    setSaved(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* not remembered */ }
  }
  // Positions are edited in the full saved list, so a column that cannot be shown yet (its group of extra
  // columns is still loading) is not lost.
  function add(key) { if (!shown.includes(key)) persist([...shown, key]); }
  function remove(key) { if (!lockedKeys.includes(key)) persist(shown.filter((k) => k !== key)); }
  function move(fromKey, toKey) {
    if (fromKey === toKey || !shown.includes(fromKey) || !shown.includes(toKey)) return;
    const next = [...shown];
    next.splice(next.indexOf(toKey), 0, next.splice(next.indexOf(fromKey), 1)[0]);
    persist(next);
  }
  function moveBy(key, step) {
    const i = shown.indexOf(key);
    const j = i + step;
    if (i < 0 || j < 0 || j >= shown.length) return;
    const next = [...shown];
    [next[i], next[j]] = [next[j], next[i]];
    persist(next);
  }
  function reset() {
    setSaved(null);
    try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
  }

  // Values for the extra columns that are shown.
  const extraKeys = visible.filter((k) => defByKey.get(k).extra);
  const ids = React.useMemo(() => {
    const list = [];
    for (const r of rows || []) {
      const id = idOf(r);
      if (id !== null && id !== undefined && id !== '') list.push(String(id));
    }
    return [...new Set(list)];
  }, [rows]);
  const wanted = subject && extraKeys.length > 0 && ids.length > 0 ? JSON.stringify([subject, ids, extraKeys]) : null;
  const [extras, setExtras] = useState({ values: {}, loaded: false, failed: null });
  const requestRef = useRef(0);
  useEffect(() => {
    if (!wanted) return;
    const mine = ++requestRef.current;
    const [subj, idList, keyList] = JSON.parse(wanted);
    window.api.getColumnExtras({ subject: subj, ids: idList, columns: keyList }).then((r) => {
      if (mine !== requestRef.current) return;
      if (r.success) setExtras({ values: r.values, loaded: true, failed: null });
      else setExtras({ values: {}, loaded: true, failed: r.error });
    }).catch((err) => {
      if (mine === requestRef.current) setExtras({ values: {}, loaded: true, failed: String(err.message || err) });
    });
  }, [wanted, refreshKey]);

  const rowsWithExtras = React.useMemo(() => {
    if (!wanted || !rows) return rows;
    return rows.map((r) => {
      const v = extras.values[String(idOf(r))];
      return { ...r, __x: v || (extras.loaded ? {} : undefined) };
    });
  }, [rows, extras, wanted]);

  const accessors = {};
  for (const d of defs) {
    accessors[d.key] = d.sort || ((row) => {
      const v = d.cell ? d.cell(row) : null;
      return typeof v === 'string' || typeof v === 'number' ? v : null;
    });
  }

  const { widths, startResize } = useColumnWidths(tableKey, ownKeys);
  return {
    rows: rowsWithExtras,
    defs, visibleDefs, available, accessors,
    widths, startResize,
    add, remove, move, moveBy, reset,
    isCustom: saved !== null,
    canAddMore: !!subject,
    extrasFailed: extras.failed,
    lockedKeys
  };
}

// "Columns" button with a menu: the columns shown (move them with the arrows, or drag the headers; remove
// with the cross), and an "Add a column" list of everything else that fits this table, searchable.
function ColumnPicker({ cols }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const boxRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const term = search.trim().toLowerCase();
  const matching = cols.available.filter((d) => !term || d.label.toLowerCase().includes(term) || (d.group || '').toLowerCase().includes(term));
  const groups = [];
  for (const d of matching) {
    const name = d.group || 'This table';
    let g = groups.find((x) => x.name === name);
    if (!g) { g = { name, items: [] }; groups.push(g); }
    g.items.push(d);
  }

  return (
    <span ref={boxRef} className="column-chooser-wrap">
      <button onClick={() => setOpen(!open)}>Columns</button>
      {cols.extrasFailed && !open && <span style={{ color: '#e57373', marginLeft: 8 }}>Some added columns could not load</span>}
      {open && (
        <div className="column-chooser">
          <div className="column-chooser-title">Shown</div>
          {cols.visibleDefs.map((d, i) => (
            <div key={d.key} className="column-chooser-row" data-column={d.key}>
              <span>{d.label}</span>
              <span>
                <button disabled={i === 0} onClick={() => cols.moveBy(d.key, -1)} title="Move earlier">▲</button>
                <button disabled={i === cols.visibleDefs.length - 1} onClick={() => cols.moveBy(d.key, 1)} title="Move later">▼</button>
                <button disabled={cols.lockedKeys.includes(d.key)} onClick={() => cols.remove(d.key)} title={cols.lockedKeys.includes(d.key) ? 'This column always shows' : 'Remove this column'}>✕</button>
              </span>
            </div>
          ))}
          <div className="column-chooser-title" style={{ marginTop: 10 }}>Add a column</div>
          {cols.available.length > 8 && (
            <input className="column-chooser-search" placeholder="Search columns" value={search} onChange={(e) => setSearch(e.target.value)} />
          )}
          {cols.available.length === 0 && <div className="status">Every available column is already shown.</div>}
          {cols.available.length > 0 && matching.length === 0 && <div className="status">Nothing matches.</div>}
          <div className="column-chooser-add">
            {groups.map((g) => (
              <div key={g.name}>
                <div className="column-chooser-group">{g.name}</div>
                {g.items.map((d) => (
                  <div key={d.key} className="column-chooser-row" data-add={d.key}>
                    <span>{d.label}</span>
                    <button onClick={() => cols.add(d.key)}>+ Add</button>
                  </div>
                ))}
              </div>
            ))}
          </div>
          {cols.extrasFailed && <div className="status" style={{ color: '#e57373' }}>Could not load the added columns: {cols.extrasFailed}</div>}
          <button style={{ marginTop: 10 }} onClick={cols.reset} disabled={!cols.isCustom}>Reset columns</button>
        </div>
      )}
    </span>
  );
}

// One resizable <th>. A thin drag handle sits on the right edge -
// mousedown there (not on the header text itself) starts the resize,
// so clicking/selecting header text still works normally.
function ResizableHeader({ label, columnKey, widths, startResize, sortable, sortColumn, sortDirection, onSortClick, onMoveColumn }) {
  const [hovering, setHovering] = useState(false);
  const [dropTarget, setDropTarget] = useState(false);
  const isSorted = sortable && sortColumn === columnKey;
  const COLUMN_DRAG = 'text/x-fleet-column';
  return (
    <th
      style={{ width: `${widths[columnKey] || 150}px`, position: 'relative', boxShadow: dropTarget ? 'inset 3px 0 0 #5b8def' : undefined }}
      onDragOver={onMoveColumn ? (e) => {
        if (!Array.from(e.dataTransfer.types).includes(COLUMN_DRAG)) return;
        e.preventDefault();
        setDropTarget(true);
      } : undefined}
      onDragLeave={onMoveColumn ? () => setDropTarget(false) : undefined}
      onDrop={onMoveColumn ? (e) => {
        setDropTarget(false);
        const from = e.dataTransfer.getData(COLUMN_DRAG);
        if (from) { e.preventDefault(); onMoveColumn(from, columnKey); }
      } : undefined}
    >
      <span
        draggable={!!onMoveColumn}
        onDragStart={onMoveColumn ? (e) => {
          e.dataTransfer.setData(COLUMN_DRAG, columnKey);
          e.dataTransfer.effectAllowed = 'move';
        } : undefined}
        onClick={sortable ? () => onSortClick(columnKey) : undefined}
        style={{ cursor: sortable ? 'pointer' : 'default', userSelect: 'none' }}
        title={sortable ? (onMoveColumn ? 'Click to sort, drag to move' : 'Click to sort') : undefined}
      >
        {label}
        {isSorted && (sortDirection === 'asc' ? ' \u25B2' : ' \u25BC')}
      </span>
      <div
        onMouseDown={(e) => startResize(columnKey, e)}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        title="Drag to resize"
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: '6px',
          cursor: 'col-resize',
          borderRight: hovering ? '2px solid #5b8def' : '1px solid #3a3f4a'
        }}
      />
    </th>
  );
}

// Shared column-sort mechanism. Click a sortable header: unsorted -> asc
// -> desc -> back to unsorted (which also restores Group by Account to
// whatever it was before sorting started, per explicit design). A
// separate "Reset Sorting" button does the same reset directly.
function useColumnSort() {
  const [sortColumn, setSortColumn] = useState(null);
  const [sortDirection, setSortDirection] = useState('asc');
  const prevGroupByAccountRef = useRef(null);

  function handleSortClick(columnKey, groupByAccountEnabled, setGroupByAccountEnabled) {
    if (sortColumn !== columnKey) {
      if (sortColumn === null && setGroupByAccountEnabled) {
        prevGroupByAccountRef.current = groupByAccountEnabled;
        setGroupByAccountEnabled(false);
      }
      setSortColumn(columnKey);
      setSortDirection('asc');
    } else if (sortDirection === 'asc') {
      setSortDirection('desc');
    } else {
      resetSort(setGroupByAccountEnabled);
    }
  }

  function resetSort(setGroupByAccountEnabled) {
    setSortColumn(null);
    setSortDirection('asc');
    if (prevGroupByAccountRef.current !== null && setGroupByAccountEnabled) {
      setGroupByAccountEnabled(prevGroupByAccountRef.current);
    }
    prevGroupByAccountRef.current = null;
  }

  return { sortColumn, sortDirection, handleSortClick, resetSort };
}

// Applies the active sort (if any) using per-column accessor functions.
// Nulls/blanks always sort to the end regardless of direction. Numeric
// values compare numerically; everything else compares as strings with
// natural (numeric-aware) ordering.
function applyColumnSort(rows, sortColumn, sortDirection, accessors) {
  if (!sortColumn || !accessors[sortColumn]) return rows;
  const accessor = accessors[sortColumn];
  return [...rows].sort((a, b) => {
    const av = accessor(a);
    const bv = accessor(b);
    const aBlank = av === null || av === undefined || av === '';
    const bBlank = bv === null || bv === undefined || bv === '';
    if (aBlank && bBlank) return 0;
    if (aBlank) return 1;
    if (bBlank) return -1;
    let cmp;
    if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
    else cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
    return sortDirection === 'asc' ? cmp : -cmp;
  });
}

// Sorts by saved sort_index first (nulls/undefined last), then falls back
// to the character's name so newly-synced characters with no saved position
// are still in a stable, predictable order rather than random. Roster rows
// carry the name as `name`; Parts, Salvage and Subs rows as `character_name`.
function characterNameOf(row) {
  return row.name ?? row.character_name ?? '';
}

function sortRows(rows) {
  return [...rows].sort((a, b) => {
    const aHas = a.sort_index !== null && a.sort_index !== undefined;
    const bHas = b.sort_index !== null && b.sort_index !== undefined;
    if (aHas && bHas) return a.sort_index - b.sort_index;
    if (aHas && !bHas) return -1;
    if (!aHas && bHas) return 1;
    return characterNameOf(a).localeCompare(characterNameOf(b));
  });
}

// Same ordering convention as sortRows (roster sort_index first, alphabetical
// fallback), adapted for retainer rows - retainers don't have their own
// .name/.sort_index, they inherit their owner's roster position via
// owner_name/sort_index, with retainer_name as the final tiebreak for
// characters with multiple retainers.
function sortByRoster(rows) {
  return [...rows].sort((a, b) => {
    const aHas = a.sort_index !== null && a.sort_index !== undefined;
    const bHas = b.sort_index !== null && b.sort_index !== undefined;
    if (aHas && bHas && a.sort_index !== b.sort_index) return a.sort_index - b.sort_index;
    if (aHas && !bHas) return -1;
    if (!aHas && bHas) return 1;
    const ownerCmp = (a.owner_name || '').localeCompare(b.owner_name || '');
    if (ownerCmp !== 0) return ownerCmp;
    const aOrderHas = a.hire_order_index !== null && a.hire_order_index !== undefined;
    const bOrderHas = b.hire_order_index !== null && b.hire_order_index !== undefined;
    if (aOrderHas && bOrderHas && a.hire_order_index !== b.hire_order_index) return a.hire_order_index - b.hire_order_index;
    if (aOrderHas && !bOrderHas) return -1;
    if (!aOrderHas && bOrderHas) return 1;
    return (a.retainer_name || '').localeCompare(b.retainer_name || '');
  });
}

function groupByAccount(rows) {
  const groups = {};
  for (const row of rows) {
    const key = row.account_label || 'Ungrouped';
    if (!groups[key]) groups[key] = [];
    groups[key].push(row);
  }

  const labels = Object.keys(groups).sort((a, b) => {
    if (a === 'Ungrouped') return 1;
    if (b === 'Ungrouped') return -1;
    return a.localeCompare(b);
  });

  return labels.map((label) => ({ label, rows: groups[label] }));
}

// "40 min", "5 h", "3 days".
function formatSpan(ms) {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} days`;
}

// A small amber tag beside a character the plugin no longer syncs (behind the rest of its account by
// the "Plugin not syncing" setting): its data is as it was then.
function NotSyncedTag({ behindMs }) {
  if (behindMs === null || behindMs === undefined) return null;
  return (
    <span className="not-synced-tag"
      title={`Not synced for ${formatSpan(behindMs)} while the rest of its account is. Its data is as it was then. Untick it in the plugin and use × to remove it, or tick it again.`}>
      not synced
    </span>
  );
}

function formatHouse(row) {
  if (!row.has_house) return '—';
  const district = row.district_name || `City ${row.house_city}`;
  return `${district} W${row.house_ward} P${row.house_plot}`;
}

// How long since an FC house was last entered (house_days from house-warning.js): "Today", "1 day ago", ...
function formatHouseAge(row) {
  if (!row.has_house) return '—';
  if (row.house_days === null || row.house_days === undefined) return 'Unknown';
  if (row.house_days === 0) return 'Today';
  return `${row.house_days} day${row.house_days === 1 ? '' : 's'} ago`;
}

// The same, coloured: amber from the warning setting, red from 30 days or with no date.
function HouseAge({ row }) {
  if (!row.has_house) return '—';
  const when = row.house_last_visited ? `Last entered ${new Date(row.house_last_visited).toLocaleString()}` : 'FC Tracker has no date for this house yet';
  return <span className={`house-age ${row.house_level || ''}`} title={when}>{formatHouseAge(row)}</span>;
}

// The header row and a body row's cells for any table built with useTableColumns. `ctx` is passed to each
// column's cell() for columns that need the table's handlers (for example a checkbox).
function ColumnHeadCells({ cols, sortColumn = null, sortDirection = 'asc', onSortClick }) {
  return cols.visibleDefs.map((def) => (
    <ResizableHeader key={def.key} label={def.label} columnKey={def.key} widths={cols.widths} startResize={cols.startResize}
      sortable={def.sortable !== false} sortColumn={sortColumn} sortDirection={sortDirection} onSortClick={onSortClick} onMoveColumn={cols.move} />
  ));
}
function ColumnBodyCells({ cols, row, ctx }) {
  // A column whose cell needs its own <td> (for example one with a hover tooltip) gives `td(row, ctx)` instead of `cell`.
  return cols.visibleDefs.map((def) => (def.td
    ? <React.Fragment key={def.key}>{def.td(row, ctx)}</React.Fragment>
    : <td key={def.key} style={def.cellStyle ? def.cellStyle(row) : undefined}>{def.cell(row, ctx)}</td>));
}

// A whole table from useTableColumns: the Columns menu's choice and order, resizable headers you can drag to
// move, and click-to-sort (`sort` from useColumnSort). rowKey(row) gives each row's key; rowClassName(row)
// an optional class; ctx is handed to every cell (for buttons that need the tab's functions).
function ColumnTable({ cols, sort, rows, rowKey, rowClassName, className, ctx }) {
  const sorted = sort && sort.sortColumn ? applyColumnSort(rows, sort.sortColumn, sort.sortDirection, cols.accessors) : rows;
  return (
    <table className={className}>
      <thead>
        <tr>
          <ColumnHeadCells cols={cols} sortColumn={sort ? sort.sortColumn : null} sortDirection={sort ? sort.sortDirection : 'asc'}
            onSortClick={sort ? (key) => sort.handleSortClick(key) : undefined} />
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => (
          <tr key={rowKey(r)} className={rowClassName ? rowClassName(r) : undefined}><ColumnBodyCells cols={cols} row={r} ctx={ctx} /></tr>
        ))}
      </tbody>
    </table>
  );
}

// ---- "Export this table to CSV" / "Copy table": right-click any table in the app ----

// What a cell shows, as text: a box's value, a list's choice, a tick as Yes/No, otherwise its text (for a
// heading as written, not in the capitals the page shows it in, and without the sort arrow).
function tableCellText(cell) {
  if (cell.tagName === 'TH') return (cell.textContent || '').replace(/[\u25B2\u25BC]/g, '').replace(/\s+/g, ' ').trim();
  const control = cell.querySelector('input, select, textarea');
  if (control) {
    if (control.type === 'checkbox' || control.type === 'radio') return control.checked ? 'Yes' : 'No';
    if (control.tagName === 'SELECT') return control.selectedOptions.length ? control.selectedOptions[0].textContent.trim() : '';
    return control.value;
  }
  return (cell.innerText || cell.textContent || '').replace(/\s+/g, ' ').trim();
}

// A table's rows as text, with a spanning cell followed by empty ones so the columns line up.
function tableToRows(table) {
  const rows = [];
  for (const tr of table.rows) {
    const row = [];
    for (const cell of tr.cells) {
      row.push(tableCellText(cell));
      for (let i = 1; i < (cell.colSpan || 1); i++) row.push('');
    }
    rows.push(row);
  }
  return rows;
}

// A name for the export: the tab, and the nearest heading above the table.
function tableTitle(table) {
  const tab = document.querySelector('.sidebar-button.active');
  let heading = null;
  for (let node = table; node && !heading && node !== document.body; node = node.parentElement) {
    for (let sibling = node.previousElementSibling; sibling && !heading; sibling = sibling.previousElementSibling) {
      if (/^H[1-4]$/.test(sibling.tagName)) heading = sibling;
    }
  }
  const parts = [tab ? tab.textContent.trim() : '', heading ? heading.childNodes[0].textContent.trim() : ''].filter(Boolean);
  return [...new Set(parts)].join(' - ') || 'Table';
}

function TableExportMenu() {
  const [menu, setMenu] = useState(null);
  const [note, setNote] = useState(null);

  useEffect(() => {
    function onContextMenu(e) {
      const table = e.target.closest && e.target.closest('table');
      if (!table || e.target.closest('input, textarea')) { setMenu(null); return; }
      e.preventDefault();
      setMenu({ x: e.clientX, y: e.clientY, table });
    }
    function close() { setMenu(null); }
    document.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('click', close);
    window.addEventListener('blur', close);
    return () => {
      document.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('click', close);
      window.removeEventListener('blur', close);
    };
  }, []);

  function flash(text) {
    setNote(text);
    setTimeout(() => setNote(null), 3000);
  }

  async function exportCsv() {
    const { table } = menu;
    setMenu(null);
    const result = await window.api.saveCsv({ title: tableTitle(table), rows: tableToRows(table) });
    if (!result.success) flash(`Export failed: ${result.error}`);
    else if (!result.canceled) flash(`Saved ${result.filePath}`);
  }

  function copy() {
    const { table } = menu;
    setMenu(null);
    const text = tableToRows(table).map((row) => row.map((cell) => cell.replace(/[\t\n]/g, ' ')).join('\t')).join('\n');
    navigator.clipboard.writeText(text).then(() => flash('Table copied: paste it into a spreadsheet.'));
  }

  return (
    <React.Fragment>
      {menu && (
        <div className="table-menu" style={{ left: Math.min(menu.x, window.innerWidth - 220), top: Math.min(menu.y, window.innerHeight - 80) }}
          onClick={(e) => e.stopPropagation()}>
          <button onClick={exportCsv}>Export this table to CSV</button>
          <button onClick={copy}>Copy table</button>
        </div>
      )}
      {note && <div className="table-menu-note">{note}</div>}
    </React.Fragment>
  );
}
