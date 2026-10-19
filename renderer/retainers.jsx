// Retainers tab: venture status, gear item level against each retainer's target, gear suggestions.

// Standard/Extravagant cell with a hover popup showing the real
// per-item breakdown (name, qty, price each, subtotal) behind that
// total. Popup only renders while hovering - no click/toggle state
// needed, matches a plain tooltip pattern.
function RetainerStatusCell({ hasVenture, ventureEndsAt }) {
  const [nowEpoch, setNowEpoch] = useState(() => Math.floor(Date.now() / 1000));
  const endEpoch = ventureEndsAt ? Number(ventureEndsAt) : 0;
  const onVenture = !!hasVenture && endEpoch > 0 && endEpoch > nowEpoch;

  useEffect(() => {
    if (!onVenture) return;
    const interval = setInterval(() => setNowEpoch(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(interval);
  }, [onVenture]);

  if (!hasVenture || !endEpoch) return 'Idle';
  if (!onVenture) return 'Venture Complete';
  return formatCountdown(endEpoch - nowEpoch);
}

// One equipped-slot row inside the Avg ilvl hover breakdown. Mismatch/Empty
// rows are hoverable a second time to show ranked gear suggestions - fetched
// on demand (only when actually hovered), based on the retainer's SAVED
// target (same values Status is computed from), not any unsaved draft
// input. Wrong Job rows get no suggestions - no amount of "closer to
// target" gear helps if the job can't wear that slot's item family at all.
function GearSlotRow({ slot, jobAbbreviation, targetMode, targetValue, onlyCrafted }) {
  const [hovering, setHovering] = useState(false);
  const [suggestions, setSuggestions] = useState(null);
  const canSuggest = (slot.status === 'Mismatch' || slot.status === 'Empty') && !!targetMode && targetValue != null;

  useEffect(() => {
    if (hovering && canSuggest && suggestions === null) {
      window.api.getGearSuggestions({
        jobAbbreviation, targetMode, targetValue, onlyCrafted, slotLabel: slot.label
      }).then((result) => {
        setSuggestions(result.success ? result.rows : []);
      });
    }
  }, [hovering, canSuggest, suggestions]);

  const statusColor = slot.status === 'OK' ? '#7ec97e' : (slot.status === 'Mismatch' || slot.status === 'Wrong Job' || slot.status === 'Empty') ? '#e57373' : '#8a8f9a';

  return (
    <tr>
      <td style={{ padding: '2px 6px' }}>{slot.label}</td>
      <td style={{ padding: '2px 6px', whiteSpace: 'nowrap' }}>{slot.itemName || 'Empty'}</td>
      <td style={{ padding: '2px 6px' }}>{slot.levelItem ?? '—'}</td>
      <td
        style={{ padding: '2px 6px', color: statusColor, position: 'relative', cursor: canSuggest ? 'help' : 'default' }}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
      >
        <span style={canSuggest ? { textDecoration: 'underline dotted', textUnderlineOffset: '3px' } : undefined}>
          {slot.status || '—'}
        </span>
        {hovering && canSuggest && suggestions && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: '100%',
              marginLeft: '8px',
              zIndex: 30,
              background: '#1a1d24',
              border: '1px solid #333',
              padding: '8px',
              width: 'max-content',
              boxShadow: '0 4px 12px rgba(0,0,0,0.4)'
            }}
          >
            {suggestions.length === 0 ? (
              <div style={{ fontSize: '0.85em', color: '#8a8f9a' }}>No eligible gear found.</div>
            ) : (
              <table style={{ width: 'auto', tableLayout: 'auto' }}>
                <thead>
                  <tr>
                    <th style={{ padding: '2px 6px' }}>Item</th>
                    <th style={{ padding: '2px 6px' }}>Level</th>
                    <th style={{ padding: '2px 6px' }}>ilvl</th>
                  </tr>
                </thead>
                <tbody>
                  {suggestions.map((s) => (
                    <tr key={s.id}>
                      <td style={{ padding: '2px 6px', whiteSpace: 'nowrap' }}>{s.name}</td>
                      <td style={{ padding: '2px 6px' }}>{s.level_equip ?? '—'}</td>
                      <td style={{ padding: '2px 6px' }}>{s.level_item ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

function AvgIlvlCell({ avgIlvl, gearSlots, jobAbbreviation, targetMode, targetValue, onlyCrafted }) {
  const [hovering, setHovering] = useState(false);
  const slots = gearSlots || [];

  return (
    <td
      style={{ position: 'relative', cursor: slots.length > 0 ? 'help' : 'default' }}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <span style={slots.length > 0 ? { textDecoration: 'underline dotted', textUnderlineOffset: '3px' } : undefined}>
        {typeof avgIlvl === 'number' ? avgIlvl.toFixed(1) : '—'}
      </span>
      {hovering && slots.length > 0 && (
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
          <table style={{ width: 'auto', tableLayout: 'auto' }}>
            <thead>
              <tr>
                <th style={{ padding: '2px 6px' }}>Slot</th>
                <th style={{ padding: '2px 6px' }}>Item</th>
                <th style={{ padding: '2px 6px' }}>ilvl</th>
                <th style={{ padding: '2px 6px' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {slots.map((s, i) => (
                <GearSlotRow
                  key={i}
                  slot={s}
                  jobAbbreviation={jobAbbreviation}
                  targetMode={targetMode}
                  targetValue={targetValue}
                  onlyCrafted={onlyCrafted}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </td>
  );
}

// The Retainers tab's own columns. Target Mode / Value / Only Crafted / Actions edit the row's target, so they read
// and change the row's working state, passed in as `ctx`.
const RETAINER_COLUMN_DEFS = [
  { key: 'owner', label: 'Owner', cell: (r) => r.owner_name || '—', sort: (r) => r.owner_name },
  { key: 'world', label: 'World', cell: (r) => r.world || '—', sort: (r) => r.world },
  { key: 'retainer', label: 'Retainer', locked: true, cell: (r) => r.retainer_name, sort: (r) => r.retainer_name },
  { key: 'job', label: 'Class/Level', cell: (r) => (r.job_abbreviation ? `${r.job_abbreviation}/${r.level ?? '?'}` : '—'), sort: (r) => r.job_abbreviation },
  { key: 'gil', label: 'Gil', cell: (r) => (typeof r.gil === 'number' ? r.gil.toLocaleString() : '—'), sort: (r) => (typeof r.gil === 'number' ? r.gil : null) },
  { key: 'avgIlvl', label: 'Avg ilvl', sort: (r) => (typeof r.avg_ilvl === 'number' ? r.avg_ilvl : null),
    td: (r) => <AvgIlvlCell avgIlvl={r.avg_ilvl} gearSlots={r.gear_slots} jobAbbreviation={r.job_abbreviation} targetMode={r.target_mode} targetValue={r.target_value} onlyCrafted={r.only_crafted} /> },
  { key: 'ventureType', label: 'Venture Type', cell: (r) => r.venture_type || '—', sort: (r) => r.venture_type },
  { key: 'status', label: 'Status', sortable: false, cell: (r) => <RetainerStatusCell hasVenture={r.has_venture} ventureEndsAt={r.venture_ends_at} /> },
  { key: 'targetMode', label: 'Target Mode', sort: (r) => r.target_mode,
    cell: (r, ctx) => (
      <select value={ctx.targetMode} onChange={(e) => ctx.setTargetMode(e.target.value)}>
        <option value="">—</option>
        <option value="level">Level</option>
        <option value="ilvl">ilvl</option>
      </select>
    ) },
  { key: 'targetValue', label: 'Target Value', sort: (r) => (typeof r.target_value === 'number' ? r.target_value : null),
    cell: (r, ctx) => (
      <input type="number" value={ctx.targetValue} onChange={(e) => ctx.setTargetValue(e.target.value)} style={{ width: '60px' }} disabled={!ctx.targetMode} />
    ) },
  { key: 'onlyCrafted', label: 'Only Crafted?', sort: (r) => (r.only_crafted ? 1 : 0),
    cell: (r, ctx) => <input type="checkbox" checked={ctx.onlyCrafted} onChange={(e) => ctx.setOnlyCrafted(e.target.checked)} /> },
  { key: 'actions', label: 'Actions', sortable: false,
    td: (r, ctx) => (
      <td style={{ whiteSpace: 'nowrap' }}>
        <button onClick={ctx.handleSave}>Save</button>{' '}
        <button onClick={ctx.handleClear}>Clear</button>
        {ctx.saveStatus && <div style={{ fontSize: '0.8em', color: '#8a8f9a' }}>{ctx.saveStatus}</div>}
      </td>
    ) }
];
// Master-list columns the Retainers tab already has of its own.
const RETAINER_DUPLICATE_EXTRAS = ['x_world'];

// Target editing follows the same pattern as SubRuleRow - local draft
// state, explicit Save button, no auto-save-on-keystroke. Clear resets
// the row to "no target set" (deletes the retainer_gear_targets row
// entirely, per the earlier design decision, rather than just blanking
// fields in an existing row).
function RetainerTargetRow({ retainer, cols, onSaveTarget, onClearTarget }) {
  const [targetMode, setTargetMode] = useState(retainer.target_mode || '');
  const [targetValue, setTargetValue] = useState(retainer.target_value ?? '');
  const [onlyCrafted, setOnlyCrafted] = useState(!!retainer.only_crafted);
  const [saveStatus, setSaveStatus] = useState('');

  async function handleSave() {
    setSaveStatus('Saving...');
    const result = await onSaveTarget(retainer.retainer_id, {
      targetMode: targetMode || null,
      targetValue: targetValue === '' ? null : Number(targetValue),
      onlyCrafted
    });
    setSaveStatus(result.success ? 'Saved.' : `Failed: ${result.error}`);
  }

  async function handleClear() {
    setSaveStatus('Clearing...');
    const result = await onClearTarget(retainer.retainer_id);
    if (result.success) {
      setTargetMode('');
      setTargetValue('');
      setOnlyCrafted(false);
      setSaveStatus('Cleared.');
    } else {
      setSaveStatus(`Failed: ${result.error}`);
    }
  }

  const ctx = { targetMode, setTargetMode, targetValue, setTargetValue, onlyCrafted, setOnlyCrafted, saveStatus, handleSave, handleClear };
  return <tr><ColumnBodyCells cols={cols} row={retainer} ctx={ctx} /></tr>;
}

function RetainersView({ refreshKey }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [groupByAccountEnabled, setGroupByAccountEnabled] = useState(true);

  const retainersSort = useColumnSort();
  const retainersCols = useTableColumns({
    tableKey: 'retainers',
    ownDefs: RETAINER_COLUMN_DEFS,
    subject: 'character',
    excludeExtras: RETAINER_DUPLICATE_EXTRAS,
    rows,
    idOf: (r) => r.owner_cid,
    refreshKey
  });
  const retainersSortOnClick = (col) => retainersSort.handleSortClick(col, groupByAccountEnabled, setGroupByAccountEnabled);

  // Refetch (not local patch) after save/clear - status is computed
  // server-side against the retainer's target, so a local optimistic
  // patch would leave the hover breakdown's Status column stale until
  // the next full refresh.
  const fetchRetainerTargets = React.useCallback(async () => {
    const result = await window.api.getRetainerTargets();
    if (result.success) {
      setRows(sortByRoster(result.rows));
      setError(null);
    } else {
      setError(result.error);
    }
  }, []);

  useEffect(() => {
    fetchRetainerTargets();
  }, [refreshKey, fetchRetainerTargets]);

  async function handleSaveTarget(retainerId, payload) {
    const result = await window.api.saveRetainerTarget({ retainerId, ...payload });
    if (result.success) await fetchRetainerTargets();
    return result;
  }

  async function handleClearTarget(retainerId) {
    const result = await window.api.deleteRetainerTarget(retainerId);
    if (result.success) await fetchRetainerTargets();
    return result;
  }

  if (error) return <div className="error">Failed to load: {error}</div>;
  if (rows === null) return <div className="status">Loading...</div>;

  const table = (rowsToShow) => (
    <table>
      <thead>
        <tr><ColumnHeadCells cols={retainersCols} sortColumn={retainersSort.sortColumn} sortDirection={retainersSort.sortDirection} onSortClick={retainersSortOnClick} /></tr>
      </thead>
      <tbody>
        {rowsToShow.map((r) => (
          <RetainerTargetRow key={r.retainer_id} retainer={r} cols={retainersCols} onSaveTarget={handleSaveTarget} onClearTarget={handleClearTarget} />
        ))}
      </tbody>
    </table>
  );

  const retainersSorted = retainersSort.sortColumn
    ? applyColumnSort(retainersCols.rows, retainersSort.sortColumn, retainersSort.sortDirection, retainersCols.accessors)
    : retainersCols.rows;

  return (
    <div className="retainers-view">
      <div className="controls">
        {!retainersSort.sortColumn && (
          <label>
            <input
              type="checkbox"
              checked={groupByAccountEnabled}
              onChange={(e) => setGroupByAccountEnabled(e.target.checked)}
            />
            {' '}Group by account
          </label>
        )}
        {retainersSort.sortColumn && (
          <button onClick={() => retainersSort.resetSort(setGroupByAccountEnabled)}>Reset Sorting</button>
        )}
        <span style={{ marginLeft: '16px' }}><ColumnPicker cols={retainersCols} /></span>
      </div>

      <UnseenRetainers rows={rows} />

      {rows.length === 0 && <div className="status">No retainers found.</div>}

      {rows.length > 0 && retainersSort.sortColumn && table(retainersSorted)}

      {rows.length > 0 && !retainersSort.sortColumn && groupByAccountEnabled &&
        groupByAccount(retainersCols.rows).map((group) => (
          <div key={group.label} className="account-group">
            <h1 style={{ fontSize: '17px', padding: '16px 24px 4px' }}>{group.label}</h1>
            {table(group.rows)}
          </div>
        ))}

      {rows.length > 0 && !retainersSort.sortColumn && !groupByAccountEnabled && table(retainersCols.rows)}
    </div>
  );
}

// Retainers none of whose items are stored. Allagan Tools only knows a retainer's items once it has
// been opened at a summoning bell on a PC running the plugin, so until then Where Is It?, the
// Shopping List and the salvage counts leave those items out. Collapsed to one line; click for names.
function UnseenRetainers({ rows }) {
  const unseen = rows.filter((r) => !r.items_seen);
  if (unseen.length === 0) return null;
  const n = unseen.length;
  return (
    <details className="warning unseen-retainers">
      <summary>
        {n} retainer{n === 1 ? "'s" : "s'"} items {n === 1 ? "hasn't" : "haven't"} been seen yet, so Where Is It?, the Shopping
        List and salvage counts leave them out. Open {n === 1 ? 'it' : 'each'} at a summoning bell on a PC running the plugin.
      </summary>
      <ul>
        {unseen.map((r) => (
          <li key={r.retainer_id}>{r.retainer_name} ({r.owner_name || 'unknown character'}{r.world ? ` @ ${r.world}` : ''})</li>
        ))}
      </ul>
      <div className="unseen-retainers-note">
        With plugin 0.9.0 or older, a retainer that holds nothing is listed
        too. The plugin's Check what I can see (/xivfleet check) shows what each PC can see.
      </div>
    </details>
  );
}
