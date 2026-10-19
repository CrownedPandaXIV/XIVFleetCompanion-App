// Inventory tab: character, Free Company and whole-fleet inventories.

// Multi-select character picker: type to search, click a match to add
// it as a chip, click a chip's x to remove. Same search pattern as
// CharacterOverrideInput (Sub Rules), but holds an array instead of
// a single cid.
function MultiCharacterPicker({ roster, selectedCids, onChange }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const selected = selectedCids.map((cid) => roster.find((r) => r.cid === cid)).filter(Boolean);

  const matches = roster
    .filter((r) => !selectedCids.includes(r.cid))
    .filter((r) => `${r.name} (${r.world})`.toLowerCase().includes(query.toLowerCase()));

  function addCid(cid) {
    onChange([...selectedCids, cid]);
    setQuery('');
    setOpen(false);
  }

  function removeCid(cid) {
    onChange(selectedCids.filter((c) => c !== cid));
  }

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '6px' }}>
        {selected.map((r) => (
          <span
            key={r.cid}
            style={{
              background: '#1a1d24',
              border: '1px solid #2a2e38',
              borderRadius: '4px',
              padding: '3px 8px',
              fontSize: '12px'
            }}
          >
            {r.name} ({r.world}){' '}
            <button onClick={() => removeCid(r.cid)} style={{ fontSize: '0.8em', padding: '0 4px' }}>x</button>
          </span>
        ))}
      </div>
      <div style={{ position: 'relative', width: '260px' }}>
        <input
          type="text"
          value={query}
          placeholder="Search characters to add..."
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          style={{ width: '100%' }}
        />
        {open && matches.length > 0 && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              zIndex: 10,
              background: '#1a1d24',
              border: '1px solid #333',
              maxHeight: '200px',
              overflowY: 'auto',
              minWidth: '260px'
            }}
          >
            {matches.map((r) => (
              <div
                key={r.cid}
                onMouseDown={() => addCid(r.cid)}
                style={{ padding: '4px 8px', cursor: 'pointer' }}
              >
                {r.name} ({r.world})
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// The Inventory tabs' own columns. (Rows are items, so the master list of character / FC columns does not apply.)
const CHAR_INV_COLUMN_DEFS = [
  { key: 'owner', label: 'Character', cell: (r) => `${r.owner_name} (${r.owner_world})`, sort: (r) => r.owner_name },
  { key: 'location', label: 'Location', cell: (r) => r.location, sort: (r) => r.location },
  { key: 'item', label: 'Item', locked: true, cell: (r) => r.item_name, sort: (r) => r.item_name },
  { key: 'quantity', label: 'Quantity', cell: (r) => r.quantity, sort: (r) => r.quantity }
];
const FC_INV_COLUMN_DEFS = [
  { key: 'fc', label: 'FC', cell: (r) => r.fc_name, sort: (r) => r.fc_name },
  { key: 'tab', label: 'Tab', cell: (r) => r.tab, sort: (r) => r.tab },
  { key: 'item', label: 'Item', locked: true, cell: (r) => r.item_name, sort: (r) => r.item_name },
  { key: 'quantity', label: 'Quantity', cell: (r) => r.quantity, sort: (r) => r.quantity }
];
const FLEET_INV_COLUMN_DEFS = [
  { key: 'item', label: 'Item', locked: true, cell: (r) => r.item_name, sort: (r) => r.item_name },
  { key: 'quantity', label: 'Total Quantity', cell: (r) => r.total_quantity.toLocaleString(), sort: (r) => r.total_quantity }
];

function CharacterInventoryTab() {
  const [roster, setRoster] = useState([]);
  const [selectedCids, setSelectedCids] = useState([]);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [aggregate, setAggregate] = useState(false);
  const [search, setSearch] = useState('');

  const sort = useColumnSort();
  const cols = useTableColumns({ tableKey: 'characterInventory', ownDefs: CHAR_INV_COLUMN_DEFS, rows: null, idOf: () => null });

  useEffect(() => {
    window.api.getRoster().then((result) => {
      if (result.success) {
        setRoster(sortRows(result.rows.map((r) => ({ cid: r.cid, name: r.name, world: r.world, sort_index: r.sort_index }))));
      }
    });
  }, []);

  useEffect(() => {
    if (selectedCids.length === 0) {
      setRows([]);
      return;
    }
    setRows(null);
    window.api.getCharacterInventory(selectedCids).then((result) => {
      if (result.success) {
        setRows(result.rows);
        setError(null);
      } else {
        setError(result.error);
      }
    });
  }, [selectedCids]);

  if (error) return <div className="error">Failed to load: {error}</div>;

  const filtered = (rows || []).filter((r) =>
    search.trim() === '' || r.item_name.toLowerCase().includes(search.toLowerCase())
  );

  const displayRows = sort.sortColumn
    ? applyColumnSort(filtered, sort.sortColumn, sort.sortDirection, cols.accessors)
    : filtered;

  const aggregatedRows = (() => {
    const totals = new Map();
    for (const r of filtered) {
      const key = r.item_id;
      if (!totals.has(key)) totals.set(key, { item_name: r.item_name, quantity: 0 });
      totals.get(key).quantity += r.quantity;
    }
    return Array.from(totals.values()).sort((a, b) => b.quantity - a.quantity);
  })();

  // The aggregate view is always Item + Quantity; the normal view uses the chosen columns.
  const table = (rowsToShow, isAggregate) => (
    <table>
      <thead>
        <tr>
          {isAggregate
            ? <>
                <ResizableHeader label="Item" columnKey="item" widths={cols.widths} startResize={cols.startResize} />
                <ResizableHeader label="Quantity" columnKey="quantity" widths={cols.widths} startResize={cols.startResize} />
              </>
            : <ColumnHeadCells cols={cols} sortColumn={sort.sortColumn} sortDirection={sort.sortDirection} onSortClick={sort.handleSortClick} />}
        </tr>
      </thead>
      <tbody>
        {isAggregate
          ? rowsToShow.map((r, i) => (
              <tr key={i}>
                <td>{r.item_name}</td>
                <td>{r.quantity}</td>
              </tr>
            ))
          : rowsToShow.map((r, i) => (
              <tr key={i}><ColumnBodyCells cols={cols} row={r} /></tr>
            ))}
      </tbody>
    </table>
  );

  return (
    <div>
      <div className="controls">
        <MultiCharacterPicker roster={roster} selectedCids={selectedCids} onChange={setSelectedCids} />
      </div>
      {selectedCids.length > 0 && (
        <div className="controls" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <label>
            <input type="text" placeholder="Search items..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <label>
            <input type="checkbox" checked={aggregate} onChange={(e) => setAggregate(e.target.checked)} />
            {' '}Aggregate totals across selected characters
          </label>
          {!aggregate && sort.sortColumn && (
            <button onClick={() => sort.resetSort()}>Reset Sorting</button>
          )}
          {!aggregate && <ColumnPicker cols={cols} />}
        </div>
      )}

      {selectedCids.length === 0 && <div className="status">Select one or more characters to browse their inventory.</div>}
      {selectedCids.length > 0 && rows === null && <div className="status">Loading...</div>}
      {selectedCids.length > 0 && rows !== null && filtered.length === 0 && <div className="status">No items found.</div>}
      {selectedCids.length > 0 && rows !== null && filtered.length > 0 && aggregate && table(aggregatedRows, true)}
      {selectedCids.length > 0 && rows !== null && filtered.length > 0 && !aggregate && table(displayRows, false)}
    </div>
  );
}

function MultiFcPicker({ fcList, selectedFcIds, onChange }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const selected = selectedFcIds.map((id) => fcList.find((fc) => fc.fc_id === id)).filter(Boolean);

  const matches = fcList
    .filter((fc) => !selectedFcIds.includes(fc.fc_id))
    .filter((fc) => `${fc.fc_name} ${fc.member_names.join(' ')} ${fc.world}`.toLowerCase().includes(query.toLowerCase()));

  function addFcId(id) {
    onChange([...selectedFcIds, id]);
    setQuery('');
    setOpen(false);
  }

  function removeFcId(id) {
    onChange(selectedFcIds.filter((c) => c !== id));
  }

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '6px' }}>
        {selected.map((fc) => (
          <span
            key={fc.fc_id}
            style={{
              background: '#1a1d24',
              border: '1px solid #2a2e38',
              borderRadius: '4px',
              padding: '3px 8px',
              fontSize: '12px'
            }}
          >
            {fc.fc_name} ({fc.member_names.join(', ')} — {fc.world}){' '}
            <button onClick={() => removeFcId(fc.fc_id)} style={{ fontSize: '0.8em', padding: '0 4px' }}>x</button>
          </span>
        ))}
      </div>
      <div style={{ position: 'relative', width: '320px' }}>
        <input
          type="text"
          value={query}
          placeholder="Search FCs by name, member, or world..."
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          style={{ width: '100%' }}
        />
        {open && matches.length > 0 && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              zIndex: 10,
              background: '#1a1d24',
              border: '1px solid #333',
              maxHeight: '220px',
              overflowY: 'auto',
              minWidth: '320px'
            }}
          >
            {matches.map((fc) => (
              <div
                key={fc.fc_id}
                onMouseDown={() => addFcId(fc.fc_id)}
                style={{ padding: '4px 8px', cursor: 'pointer' }}
              >
                {fc.fc_name} ({fc.member_names.join(', ')} — {fc.world})
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FcInventoryTab() {
  const [fcList, setFcList] = useState([]);
  const [selectedFcIds, setSelectedFcIds] = useState([]);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [aggregate, setAggregate] = useState(false);
  const [search, setSearch] = useState('');

  const sort = useColumnSort();
  const cols = useTableColumns({ tableKey: 'fcInventory', ownDefs: FC_INV_COLUMN_DEFS, rows: null, idOf: () => null });

  useEffect(() => {
    window.api.getFcList().then((result) => {
      if (result.success) setFcList(result.rows);
    });
  }, []);

  useEffect(() => {
    if (selectedFcIds.length === 0) {
      setRows([]);
      return;
    }
    setRows(null);
    window.api.getFcInventory(selectedFcIds).then((result) => {
      if (result.success) {
        setRows(result.rows);
        setError(null);
      } else {
        setError(result.error);
      }
    });
  }, [selectedFcIds]);

  if (error) return <div className="error">Failed to load: {error}</div>;

  const filtered = (rows || []).filter((r) =>
    search.trim() === '' || r.item_name.toLowerCase().includes(search.toLowerCase())
  );

  const displayRows = sort.sortColumn
    ? applyColumnSort(filtered, sort.sortColumn, sort.sortDirection, cols.accessors)
    : filtered;

  const aggregatedRows = (() => {
    const totals = new Map();
    for (const r of filtered) {
      const key = r.item_id;
      if (!totals.has(key)) totals.set(key, { item_name: r.item_name, quantity: 0 });
      totals.get(key).quantity += r.quantity;
    }
    return Array.from(totals.values()).sort((a, b) => b.quantity - a.quantity);
  })();

  // The aggregate view is always Item + Quantity; the normal view uses the chosen columns.
  const table = (rowsToShow, isAggregate) => (
    <table>
      <thead>
        <tr>
          {isAggregate
            ? <>
                <ResizableHeader label="Item" columnKey="item" widths={cols.widths} startResize={cols.startResize} />
                <ResizableHeader label="Quantity" columnKey="quantity" widths={cols.widths} startResize={cols.startResize} />
              </>
            : <ColumnHeadCells cols={cols} sortColumn={sort.sortColumn} sortDirection={sort.sortDirection} onSortClick={sort.handleSortClick} />}
        </tr>
      </thead>
      <tbody>
        {isAggregate
          ? rowsToShow.map((r, i) => (
              <tr key={i}>
                <td>{r.item_name}</td>
                <td>{r.quantity}</td>
              </tr>
            ))
          : rowsToShow.map((r, i) => (
              <tr key={i}><ColumnBodyCells cols={cols} row={r} /></tr>
            ))}
      </tbody>
    </table>
  );

  return (
    <div>
      <div className="controls">
        <MultiFcPicker fcList={fcList} selectedFcIds={selectedFcIds} onChange={setSelectedFcIds} />
      </div>
      {selectedFcIds.length > 0 && (
        <div className="controls" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <label>
            <input type="text" placeholder="Search items..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <label>
            <input type="checkbox" checked={aggregate} onChange={(e) => setAggregate(e.target.checked)} />
            {' '}Aggregate totals across selected FCs
          </label>
          {!aggregate && sort.sortColumn && (
            <button onClick={() => sort.resetSort()}>Reset Sorting</button>
          )}
          {!aggregate && <ColumnPicker cols={cols} />}
        </div>
      )}

      {selectedFcIds.length === 0 && <div className="status">Select one or more FCs to browse their chest.</div>}
      {selectedFcIds.length > 0 && rows === null && <div className="status">Loading...</div>}
      {selectedFcIds.length > 0 && rows !== null && filtered.length === 0 && (
        <div className="status">No items found - the chest may be empty, or Allagan Tools hasn't cached fresh data for it yet (only updates after the FC chest UI has actually been opened in-game).</div>
      )}
      {selectedFcIds.length > 0 && rows !== null && filtered.length > 0 && aggregate && table(aggregatedRows, true)}
      {selectedFcIds.length > 0 && rows !== null && filtered.length > 0 && !aggregate && table(displayRows, false)}
    </div>
  );
}

function FleetInventoryTab() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');

  const sort = useColumnSort();
  const cols = useTableColumns({ tableKey: 'fleetInventory', ownDefs: FLEET_INV_COLUMN_DEFS, rows: null, idOf: () => null });

  useEffect(() => {
    window.api.getFleetInventorySummary().then((result) => {
      if (result.success) {
        setRows(result.rows);
      } else {
        setError(result.error);
      }
    });
  }, []);

  if (error) return <div className="error">Failed to load: {error}</div>;
  if (rows === null) return <div className="status">Loading...</div>;

  const filtered = rows.filter((r) =>
    search.trim() === '' || r.item_name.toLowerCase().includes(search.toLowerCase())
  );
  const displayRows = sort.sortColumn
    ? applyColumnSort(filtered, sort.sortColumn, sort.sortDirection, cols.accessors)
    : filtered;

  return (
    <div>
      <div className="controls" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <input type="text" placeholder="Search items..." value={search} onChange={(e) => setSearch(e.target.value)} />
        {sort.sortColumn && <button onClick={() => sort.resetSort()}>Reset Sorting</button>}
        <ColumnPicker cols={cols} />
      </div>

      {filtered.length === 0 && <div className="status">No items found.</div>}
      {filtered.length > 0 && (
        <table>
          <thead>
            <tr><ColumnHeadCells cols={cols} sortColumn={sort.sortColumn} sortDirection={sort.sortDirection} onSortClick={sort.handleSortClick} /></tr>
          </thead>
          <tbody>
            {displayRows.map((r) => (
              <tr key={r.item_id}><ColumnBodyCells cols={cols} row={r} /></tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// "Where is it?": type part of an item name and see every place it is held across the fleet - each
// character's bags, saddlebags, crystals, gear and armoury, their retainers (and what they have for
// sale), and the Free Company chests - with counts. Searches as you type (2 letters or more). Places
// come in Roster order, grouped by account like the other tabs (an FC chest with the member holding it).
// Where Is It?: one table per item found, all sharing these columns.
const WHERE_COLUMN_DEFS = [
  { key: 'who', label: 'Character / FC', locked: true, cell: (p) => `${p.who}${p.kind === 'fc' ? ' (FC)' : ''}`, sort: (p) => p.who },
  { key: 'world', label: 'World', cell: (p) => p.world || '', sort: (p) => p.world },
  { key: 'where', label: 'Where', cell: (p) => p.where, sort: (p) => p.where },
  { key: 'qty', label: 'Quantity', cell: (p) => p.qty.toLocaleString(), sort: (p) => p.qty },
];

function WhereIsItTab() {
  const whereSort = useColumnSort();
  const whereCols = useTableColumns({ tableKey: 'whereIsIt', ownDefs: WHERE_COLUMN_DEFS, rows: null, idOf: () => null });
  const [term, setTerm] = useState(() => {
    try { return localStorage.getItem('whereIsItSearch') || ''; } catch { return ''; }
  });
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [searching, setSearching] = useState(false);
  const [groupByAccountEnabled, setGroupByAccountEnabled] = useState(true);
  const latest = useRef(0);

  useEffect(() => {
    try { localStorage.setItem('whereIsItSearch', term); } catch { /* only a convenience */ }
    const text = term.trim();
    if (text.length < 2) {
      latest.current++;
      setResult(null);
      setError(null);
      setSearching(false);
      return undefined;
    }
    const call = ++latest.current;
    setSearching(true);
    const timer = setTimeout(() => {
      window.api.findItems(text).then((r) => {
        if (call !== latest.current) return; // a newer search has started
        setSearching(false);
        if (r.success) { setResult(r); setError(null); } else { setError(r.error); }
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [term]);

  const places = (n) => `${n} place${n === 1 ? '' : 's'}`;
  return (
    <div className="where-is-it">
      <div className="controls" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <input type="text" autoFocus placeholder="Item name, e.g. Cobalt Ingot" value={term}
          onChange={(e) => setTerm(e.target.value)} style={{ width: '280px' }} />
        <label>
          <input type="checkbox" checked={groupByAccountEnabled} onChange={(e) => setGroupByAccountEnabled(e.target.checked)} />
          {' '}Group by account
        </label>
        <ColumnPicker cols={whereCols} />
        {searching && <span className="status-inline">Searching...</span>}
      </div>
      <div className="where-note">
        Every character's bags, saddlebags, crystals, gear and armoury, their retainers (including items up
        for sale), and the Free Company chests, as of each character's last sync.
      </div>
      {error && <div className="error">Search failed: {error}</div>}
      {term.trim().length < 2 && <div className="status">Type at least 2 letters of an item name.</div>}
      {result && term.trim().length >= 2 && result.items.length === 0 && !searching && (
        <div className="status">Nothing held matches "{term.trim()}".</div>
      )}
      {result && term.trim().length >= 2 && result.items.map((item) => (
        <div key={item.itemId} className="where-item">
          <h3>{item.name} <span className="where-total">{item.total.toLocaleString()} in {places(item.places.length)}</span></h3>
          <table>
            <thead>
              <tr><ColumnHeadCells cols={whereCols} sortColumn={whereSort.sortColumn} sortDirection={whereSort.sortDirection} onSortClick={(key) => whereSort.handleSortClick(key)} /></tr>
            </thead>
            <tbody>
              {(groupByAccountEnabled
                ? groupByAccount(item.places.map((p) => ({ ...p, account_label: p.account })))
                : [{ label: null, rows: item.places }]
              ).map((group) => (
                <React.Fragment key={group.label || 'all'}>
                  {group.label && <tr className="where-account"><td colSpan={whereCols.visibleDefs.length}>{group.label}</td></tr>}
                  {applyColumnSort(group.rows, whereSort.sortColumn, whereSort.sortDirection, whereCols.accessors).map((p) => (
                    <tr key={`${p.who}|${p.world}|${p.where}`}><ColumnBodyCells cols={whereCols} row={p} /></tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {result && result.more && term.trim().length >= 2 && (
        <div className="status">Showing the first {result.items.length} items. Type more of the name to narrow it down.</div>
      )}
    </div>
  );
}

function InventoryView() {
  const [subView, setSubView] = useState('where'); // where | character | fc | fleet

  return (
    <div>
      <div className="controls">
        <button onClick={() => setSubView('where')} disabled={subView === 'where'}>Where Is It?</button>{' '}
        <button onClick={() => setSubView('character')} disabled={subView === 'character'}>Character</button>{' '}
        <button onClick={() => setSubView('fc')} disabled={subView === 'fc'}>FC</button>{' '}
        <button onClick={() => setSubView('fleet')} disabled={subView === 'fleet'}>Fleet</button>
      </div>
      {subView === 'where' && <WhereIsItTab />}
      {subView === 'character' && <CharacterInventoryTab />}
      {subView === 'fc' && <FcInventoryTab />}
      {subView === 'fleet' && <FleetInventoryTab />}
    </div>
  );
}
