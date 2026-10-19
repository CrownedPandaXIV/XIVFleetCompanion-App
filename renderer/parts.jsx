// Parts tab: parts still needed for each sub's target build, the summary of what to craft, and build rules.

function needsLabel(row) {
  return row.needed_modified ? `Modified ${row.needed_class}` : row.needed_class;
}

// Where a needed part comes from: a spare already held, the old part another of the character's subs
// gives up when it is upgraded, or crafting.
function partStatus(row) {
  if (row.recycled_from) return `Reuse: ${row.spare_location}`;
  return row.spare_location ? `Spare: ${row.spare_location}` : 'Needs Crafting';
}

// Same grouping pattern as groupSubsByCharacter, keyed off the fields
// get-parts-needed actually returns (character_name/world instead of
// sub_name's owning row) rather than reusing that function directly.
function groupNeedsByCharacter(rows) {
  const order = [];
  const groups = {};
  for (const row of rows) {
    const key = `${row.character_name} (${row.world})`;
    if (!groups[key]) {
      groups[key] = [];
      order.push(key);
    }
    groups[key].push(row);
  }
  return order.map((key) => [key, groups[key]]);
}

// The Parts detail's own columns (rows are needed parts). Character and World are "context" columns: shown
// automatically when the tab is sorted into one flat table, and available to add in the per-character view.
const PARTS_DETAIL_COLUMN_DEFS = [
  { key: 'sub', label: 'Sub', locked: true, cell: (n) => n.sub_name, sort: (r) => r.sub_name },
  { key: 'character', label: 'Character', default: false, cell: (n) => n.character_name, sort: (r) => r.character_name },
  { key: 'world', label: 'World', default: false, cell: (n) => n.world, sort: (r) => r.world },
  { key: 'rank', label: 'Rank', cell: (n) => n.rank, sort: (r) => r.rank },
  { key: 'slot', label: 'Slot', cell: (n) => n.slot, sort: (r) => r.slot },
  { key: 'needed', label: 'Needed', cell: (n) => needsLabel(n), sort: (r) => needsLabel(r) },
  { key: 'status', label: 'Status', cell: (n) => partStatus(n), sort: (r) => partStatus(r) }
];
// With Look ahead on: when each part is due (its sub's next build), or now.
const PARTS_DETAIL_AHEAD_COLUMN_DEFS = [
  ...PARTS_DETAIL_COLUMN_DEFS,
  { key: 'due', label: 'Due', cell: (n) => <PartDue need={n} />, sort: (r) => r.due_at || 0 }
];

// "now", or "in 4d 2h (Thu, Oct 23)" for a part of a build coming up.
function PartDue({ need }) {
  if (need.due_at === null || need.due_at === undefined) return <span title="Needed for the build it should have at its rank now.">now</span>;
  const date = new Date(need.due_at).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric' });
  const until = formatTimeUntil(need.due_at);
  const title = `For its next build at rank ${need.rank} (the Subs tab's Next Build)${until === 'now' ? ', which it can switch to already.' : `, about ${date}. An estimate: see Next Rank forecasts on the Subs tab for how close these come.`}`;
  return <span title={title}>{until === 'now' ? 'now' : `${until} (${date})`}</span>;
}
const PARTS_DETAIL_DUPLICATE_EXTRAS = ['x_world'];

function FlatPartsDetailTable({ needs, cols, sortColumn, sortDirection, onSortClick }) {
  return (
    <table>
      <thead>
        <tr><ColumnHeadCells cols={cols} sortColumn={sortColumn} sortDirection={sortDirection} onSortClick={onSortClick} /></tr>
      </thead>
      <tbody>
        {needs.map((n, i) => (
          <tr key={i}><ColumnBodyCells cols={cols} row={n} /></tr>
        ))}
      </tbody>
    </table>
  );
}

function PartsDetailTable({ characterLabel, needs, cols, onSortClick }) {
  return (
    <div className="account-group">
      <h2>{characterLabel} <span className="count">({needs.length})</span></h2>
      <table>
        <thead>
          <tr><ColumnHeadCells cols={cols} onSortClick={onSortClick} /></tr>
        </thead>
        <tbody>
          {needs.map((n, i) => (
            <tr key={i}><ColumnBodyCells cols={cols} row={n} /></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SLOT_DISPLAY_ORDER = ['Hull', 'Stern', 'Bow', 'Bridge'];

// Fleet-wide totals of what still needs crafting - excludes anything
// already covered by a spare or a reused old part (spare_location set). Aggregated across
// the whole fleet, not split by account/character - the point of this
// view is "how many of each part do I actually need to craft."
const PARTS_SUMMARY_COLUMN_DEFS = [
  { key: 'slot', label: 'Slot', locked: true, cell: (e) => e.slot, sort: (e) => e.slot },
  { key: 'neededClass', label: 'Needed Class', cell: (e) => e.needed, sort: (e) => e.needed },
  { key: 'qty', label: 'Qty Still Needed', cell: (e) => e.qty, sort: (e) => e.qty }
];
// With Look ahead on: what is needed now and what builds coming up need, side by side.
const PARTS_SUMMARY_AHEAD_COLUMN_DEFS = [
  ...PARTS_SUMMARY_COLUMN_DEFS.slice(0, 2),
  { key: 'qty', label: 'Needed Now', cell: (e) => e.qty, sort: (e) => e.qty },
  { key: 'ahead', label: 'Coming Up', cell: (e) => e.ahead, sort: (e) => e.ahead }
];

function PartsSummaryTable({ rows, aheadDays }) {
  const partsSummarySort = useColumnSort();
  const summaryCols = useTableColumns({ tableKey: 'partsSummary', ownDefs: aheadDays ? PARTS_SUMMARY_AHEAD_COLUMN_DEFS : PARTS_SUMMARY_COLUMN_DEFS, rows: null, idOf: () => null });

  const craftNeeds = rows.filter((r) => !r.spare_location);
  const counts = new Map();
  for (const r of craftNeeds) {
    const key = `${r.slot}|${needsLabel(r)}`;
    const entry = counts.get(key) || { qty: 0, ahead: 0 };
    if (r.due_at === null || r.due_at === undefined) entry.qty += 1; else entry.ahead += 1;
    counts.set(key, entry);
  }
  let entries = Array.from(counts.entries()).map(([key, { qty, ahead }]) => {
    const [slot, needed] = key.split('|');
    return { slot, needed, qty, ahead };
  });

  entries = partsSummarySort.sortColumn
    ? applyColumnSort(entries, partsSummarySort.sortColumn, partsSummarySort.sortDirection, summaryCols.accessors)
    : entries.sort((a, b) => {
        const slotDiff = SLOT_DISPLAY_ORDER.indexOf(a.slot) - SLOT_DISPLAY_ORDER.indexOf(b.slot);
        return slotDiff !== 0 ? slotDiff : (b.qty + b.ahead) - (a.qty + a.ahead);
      });

  if (entries.length === 0) {
    return <div className="status">Nothing needs crafting - every need is either met or covered by a spare.</div>;
  }

  return (
    <div>
      <div className="controls">
        {partsSummarySort.sortColumn && (
          <button onClick={() => partsSummarySort.resetSort()}>Reset Sorting</button>
        )}
        <span style={{ marginLeft: partsSummarySort.sortColumn ? '16px' : 0 }}><ColumnPicker cols={summaryCols} /></span>
      </div>
      <table>
        <thead>
          <tr><ColumnHeadCells cols={summaryCols} sortColumn={partsSummarySort.sortColumn} sortDirection={partsSummarySort.sortDirection} onSortClick={partsSummarySort.handleSortClick} /></tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={`${e.slot}|${e.needed}`}><ColumnBodyCells cols={summaryCols} row={e} /></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// sub_filter storage formats: '' / 'All' (every slot), legacy 'SubNOnly'
// (one slot), or new 'Sub1,Sub3' (comma-separated multi-select). This
// converts any of those into {all, slots[]} for the checkbox UI, and
// back again on save.
function parseSubFilterToSlots(subFilter) {
  const f = String(subFilter || '').trim();
  if (!f || f.toLowerCase() === 'all') return { all: true, slots: [] };
  const legacy = f.match(/^Sub(\d)Only$/i);
  if (legacy) return { all: false, slots: [Number(legacy[1])] };
  if (f.includes(',') || /^Sub\d$/i.test(f)) {
    const slots = f
      .split(',')
      .map((s) => {
        const m = s.trim().match(/^Sub(\d)$/i);
        return m ? Number(m[1]) : null;
      })
      .filter((n) => n !== null);
    return { all: false, slots };
  }
  return { all: true, slots: [] };
}

function slotsToSubFilter(all, slots) {
  if (all || slots.length === 0) return '';
  return slots
    .slice()
    .sort()
    .map((n) => `Sub${n}`)
    .join(',');
}

// Searchable character picker for a rule's cid_override. Free-text
// filter against the already-loaded roster (name + world), shows a
// dropdown of matches, selecting sets the cid. A Clear button drops
// back to blank (general rule, no override).
function CharacterOverrideInput({ roster, cid, onChange }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const current = roster.find((r) => r.cid === cid);

  const matches =
    query.trim().length === 0
      ? []
      : roster
          .filter((r) => `${r.name} (${r.world})`.toLowerCase().includes(query.toLowerCase()))
          .slice(0, 8);

  if (cid) {
    return (
      <span>
        {current ? `${current.name} (${current.world})` : cid}{' '}
        <button onClick={() => onChange(null)} style={{ fontSize: '0.8em' }}>Clear</button>
      </span>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      <input
        type="text"
        value={query}
        placeholder="All characters"
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        style={{ width: '140px' }}
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
            maxHeight: '160px',
            overflowY: 'auto',
            minWidth: '180px'
          }}
        >
          {matches.map((r) => (
            <div
              key={r.cid}
              onMouseDown={() => {
                onChange(r.cid);
                setQuery('');
                setOpen(false);
              }}
              style={{ padding: '4px 8px', cursor: 'pointer' }}
            >
              {r.name} ({r.world})
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// One editable rule row. Edits are local state until Save is clicked -
// deliberate, since this table drives real crafting logic and
// auto-save-on-keystroke would be too easy to fat-finger.
// The Sub Rules table's columns; each row draws its own editable cells (SubRuleRow), in the order chosen.
const SUB_RULE_COLUMN_DEFS = [
  { key: 'rank', label: 'Rank', locked: true },
  { key: 'appliesTo', label: 'Applies To' },
  { key: 'hull', label: 'Hull' },
  { key: 'stern', label: 'Stern' },
  { key: 'bow', label: 'Bow' },
  { key: 'bridge', label: 'Bridge' },
  { key: 'characterOverride', label: 'Character Override' },
];

function SubRuleRow({ rule, roster, onSave, onDelete, cols }) {
  const [local, setLocal] = useState(rule);
  const [saveStatus, setSaveStatus] = useState('');
  const filterState = parseSubFilterToSlots(local.sub_filter);

  function setAll(checked) {
    if (checked) setLocal({ ...local, sub_filter: '' });
  }

  function setSlot(slotNum, checked) {
    const currentSlots = filterState.all ? [] : filterState.slots;
    const slots = checked ? [...currentSlots, slotNum] : currentSlots.filter((s) => s !== slotNum);
    setLocal({ ...local, sub_filter: slotsToSubFilter(false, slots) });
  }

  async function handleSave() {
    setSaveStatus('Saving...');
    const result = await onSave(local);
    setSaveStatus(result.success ? 'Saved.' : `Failed: ${result.error}`);
  }

  const slotCell = (slotKey) => (
    <td>
      <select value={local[slotKey] || ''} onChange={(e) => setLocal({ ...local, [slotKey]: e.target.value })}>
        <option value="">—</option>
        {['S', 'U', 'W', 'C', 'Y', 'S+', 'U+', 'W+', 'C+', 'Y+'].map((letter) => (
          <option key={letter} value={letter}>{letter}</option>
        ))}
      </select>
    </td>
  );
  const cells = {
    rank: (
      <td>
        <input
          type="number"
          value={local.rank}
          onChange={(e) => setLocal({ ...local, rank: Number(e.target.value) })}
          style={{ width: '50px' }}
        />
      </td>
    ),
    appliesTo: (
      <td>
        <label>
          <input type="checkbox" checked={filterState.all} onChange={(e) => setAll(e.target.checked)} /> All
        </label>
        {[1, 2, 3, 4].map((n) => (
          <label key={n} style={{ marginLeft: '8px' }}>
            <input
              type="checkbox"
              checked={!filterState.all && filterState.slots.includes(n)}
              onChange={(e) => setSlot(n, e.target.checked)}
            />{' '}
            {n}
          </label>
        ))}
      </td>
    ),
    hull: slotCell('hull'),
    stern: slotCell('stern'),
    bow: slotCell('bow'),
    bridge: slotCell('bridge'),
    characterOverride: (
      <td>
        <CharacterOverrideInput
          roster={roster}
          cid={local.cid_override}
          onChange={(cid) => setLocal({ ...local, cid_override: cid })}
        />
      </td>
    ),
  };

  return (
    <tr>
      {cols.visibleDefs.map((d) => <React.Fragment key={d.key}>{cells[d.key]}</React.Fragment>)}
      <td style={{ whiteSpace: 'nowrap' }}>
        <button onClick={handleSave}>Save</button>{' '}
        <button onClick={() => onDelete(local.id)}>Delete</button>
        {saveStatus && <div style={{ fontSize: '0.8em', color: '#8a8f9a' }}>{saveStatus}</div>}
      </td>
    </tr>
  );
}

function SubRulesPanel() {
  const [rules, setRules] = useState(null);
  const [roster, setRoster] = useState([]);
  const [error, setError] = useState(null);
  const subRulesCols = useTableColumns({ tableKey: 'subRules', ownDefs: SUB_RULE_COLUMN_DEFS, rows: null, idOf: () => null });
  const subRulesSort = useColumnSort();
  const subRulesAccessors = {
    rank: (r) => r.rank,
    appliesTo: (r) => r.sub_filter || 'All',
    hull: (r) => r.hull,
    stern: (r) => r.stern,
    bow: (r) => r.bow,
    bridge: (r) => r.bridge,
    characterOverride: (r) => {
      if (!r.cid_override) return null;
      const c = roster.find((x) => x.cid === r.cid_override);
      return c ? c.name : r.cid_override;
    }
  };

  const fetchRules = React.useCallback(async () => {
    const result = await window.api.getSubBuildRules();
    if (result.success) {
      setRules(result.rows);
      setError(null);
    } else {
      setError(result.error);
    }
  }, []);

  useEffect(() => {
    fetchRules();
    window.api.getRoster().then((result) => {
      if (result.success) {
        setRoster(result.rows.map((r) => ({ cid: r.cid, name: r.name, world: r.world })));
      }
    });
  }, [fetchRules]);

  async function handleSave(rule) {
    const result = rule.id ? await window.api.updateSubBuildRule(rule) : await window.api.addSubBuildRule(rule);
    if (result.success) await fetchRules();
    return result;
  }

  async function handleDelete(id) {
    await window.api.deleteSubBuildRule(id);
    fetchRules();
  }

  function handleAddRow() {
    setRules((prev) => [
      ...(prev || []),
      { id: null, rank: 0, cid_override: null, sub_filter: '', hull: '', stern: '', bow: '', bridge: '' }
    ]);
  }

  if (error) return <div className="error">Failed to load rules: {error}</div>;
  if (rules === null) return <div className="status">Loading...</div>;

  const sortedRules = subRulesSort.sortColumn
    ? applyColumnSort(rules, subRulesSort.sortColumn, subRulesSort.sortDirection, subRulesAccessors)
    : rules;

  return (
    <div>
      <div className="controls">
        <button onClick={handleAddRow}>Add Rule</button>
        <span style={{ marginLeft: '16px' }}><ColumnPicker cols={subRulesCols} /></span>
        {subRulesSort.sortColumn && (
          <button style={{ marginLeft: '16px' }} onClick={() => subRulesSort.resetSort()}>Reset Sorting</button>
        )}
      </div>
      <table>
        <thead>
          <tr>
            <ColumnHeadCells cols={subRulesCols} sortColumn={subRulesSort.sortColumn} sortDirection={subRulesSort.sortDirection} onSortClick={subRulesSort.handleSortClick} />
            <th></th>
          </tr>
        </thead>
        <tbody>
          {sortedRules.map((rule, i) => (
            <SubRuleRow key={rule.id ?? `new-${i}`} rule={rule} roster={roster} onSave={handleSave} onDelete={handleDelete} cols={subRulesCols} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

const LOOK_AHEAD_CHOICES = [
  { days: 0, label: 'Now only' },
  { days: 3, label: '3 days' },
  { days: 7, label: '7 days' },
  { days: 14, label: '14 days' }
];
const LOOK_AHEAD_HELP = 'Also list the parts of each sub\'s next build (the Subs tab\'s Next Build) when it is due within this many days, ' +
  'so they can be bought or crafted ahead of time. Spares go to what is needed now first. Applies to Summary, Detail and the Shopping List.';

function PartsView({ refreshKey }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [subView, setSubView] = useState('summary'); // summary | detail | shopping
  const [groupByAccountEnabled, setGroupByAccountEnabled] = useState(true);
  // Look ahead: also the parts of builds coming up within this many days (0: only what is needed now). Per PC.
  const [aheadDays, setAheadDays] = useState(() => {
    try { return LOOK_AHEAD_CHOICES.some((c) => c.days === Number(localStorage.getItem('partsLookAhead'))) ? Number(localStorage.getItem('partsLookAhead')) : 0; } catch { return 0; }
  });
  function chooseAhead(days) {
    setAheadDays(days);
    try { localStorage.setItem('partsLookAhead', String(days)); } catch { /* not remembered */ }
  }
  const partsDetailSort = useColumnSort();
  const partsDetailCols = useTableColumns({
    tableKey: 'partsDetail',
    ownDefs: aheadDays ? PARTS_DETAIL_AHEAD_COLUMN_DEFS : PARTS_DETAIL_COLUMN_DEFS,
    subject: 'character',
    excludeExtras: PARTS_DETAIL_DUPLICATE_EXTRAS,
    rows,
    idOf: (r) => r.cid,
    refreshKey,
    contextKeys: ['character', 'world'],
    contextActive: !!partsDetailSort.sortColumn
  });
  const partsDetailRows = partsDetailCols.rows;
  const partsDetailSortOnClick = (col) => partsDetailSort.handleSortClick(col, groupByAccountEnabled, setGroupByAccountEnabled);
  const [showRules, setShowRules] = useState(() => {
    const saved = localStorage.getItem('partsRulesPanelVisible');
    return saved === null ? true : saved === 'true';
  });
  const [rulesPanelWidth, setRulesPanelWidth] = useState(() => {
    const saved = localStorage.getItem('partsRulesPanelWidth');
    return saved === null ? 420 : Number(saved);
  });
  const draggingRef = useRef(false);

  useEffect(() => {
    localStorage.setItem('partsRulesPanelVisible', String(showRules));
  }, [showRules]);

  useEffect(() => {
    localStorage.setItem('partsRulesPanelWidth', String(rulesPanelWidth));
  }, [rulesPanelWidth]);

  useEffect(() => {
    let current = true;
    window.api.getPartsNeeded({ aheadDays }).then((result) => {
      if (!current) return;
      if (result.success) {
        setRows(sortRows(result.rows));
        setError(null);
      } else {
        setError(result.error);
      }
    });
    return () => { current = false; };
  }, [refreshKey, aheadDays]);

  // Plain mouse-drag resize, clamped so the panel can shrink enough to
  // avoid pushing the page into horizontal scroll, but not so far it
  // becomes unusable. In-memory only, resets to 420px on restart.
  useEffect(() => {
    function handleMouseMove(e) {
      if (!draggingRef.current) return;
      const newWidth = window.innerWidth - e.clientX;
      setRulesPanelWidth(Math.max(newWidth, 180));
    }
    function handleMouseUp() {
      draggingRef.current = false;
    }
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  if (error) return <div className="error">Failed to load: {error}</div>;
  if (rows === null) return <div className="status">Loading...</div>;

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="controls">
          <button onClick={() => setSubView('summary')} disabled={subView === 'summary'}>
            Summary
          </button>{' '}
          <button onClick={() => setSubView('detail')} disabled={subView === 'detail'}>
            Detail
          </button>{' '}
          <button onClick={() => setSubView('shopping')} disabled={subView === 'shopping'}>
            Shopping List
          </button>
          <label style={{ marginLeft: '16px', whiteSpace: 'nowrap' }} title={LOOK_AHEAD_HELP}>
            Look ahead{' '}
            <select value={aheadDays} onChange={(e) => chooseAhead(Number(e.target.value))}>
              {LOOK_AHEAD_CHOICES.map((c) => <option key={c.days} value={c.days}>{c.label}</option>)}
            </select>
          </label>
          {subView === 'detail' && !partsDetailSort.sortColumn && (
            <label style={{ marginLeft: '16px' }}>
              <input
                type="checkbox"
                checked={groupByAccountEnabled}
                onChange={(e) => setGroupByAccountEnabled(e.target.checked)}
              />
              {' '}Group by account
            </label>
          )}
          {subView === 'detail' && partsDetailSort.sortColumn && (
            <button style={{ marginLeft: '16px' }} onClick={() => partsDetailSort.resetSort(setGroupByAccountEnabled)}>
              Reset Sorting
            </button>
          )}
          {subView === 'detail' && <span style={{ marginLeft: '16px' }}><ColumnPicker cols={partsDetailCols} /></span>}
          {subView !== 'shopping' && (
            <button style={{ marginLeft: '16px' }} onClick={() => setShowRules((v) => !v)}>
              {showRules ? 'Hide Rules' : 'Show Rules'}
            </button>
          )}
        </div>

        {subView === 'summary' && <PartsSummaryTable rows={rows} aheadDays={aheadDays} />}

        {subView === 'shopping' && <ShoppingListView refreshKey={refreshKey} aheadDays={aheadDays} />}

        {subView === 'detail' && rows.length === 0 && (
          <div className="status">
            {aheadDays ? 'No needs found - every sub matches its target build, with no new build due in that time.' : 'No needs found - every sub matches its target build.'}
          </div>
        )}

        {subView === 'detail' && rows.length > 0 && partsDetailSort.sortColumn && (
          <FlatPartsDetailTable
            needs={applyColumnSort(partsDetailRows, partsDetailSort.sortColumn, partsDetailSort.sortDirection, partsDetailCols.accessors)}
            cols={partsDetailCols}
            sortColumn={partsDetailSort.sortColumn}
            sortDirection={partsDetailSort.sortDirection}
            onSortClick={partsDetailSortOnClick}
          />
        )}

        {subView === 'detail' && rows.length > 0 && !partsDetailSort.sortColumn && groupByAccountEnabled &&
          groupByAccount(partsDetailRows).map((accountGroup) => (
            <div key={accountGroup.label}>
              <h1 style={{ fontSize: '17px', padding: '16px 24px 4px' }}>{accountGroup.label}</h1>
              {groupNeedsByCharacter(accountGroup.rows).map(([characterLabel, needs]) => (
                <PartsDetailTable key={characterLabel} characterLabel={characterLabel} needs={needs} cols={partsDetailCols} onSortClick={partsDetailSortOnClick} />
              ))}
            </div>
          ))}

        {subView === 'detail' && rows.length > 0 && !partsDetailSort.sortColumn && !groupByAccountEnabled &&
          groupNeedsByCharacter(partsDetailRows).map(([characterLabel, needs]) => (
            <PartsDetailTable key={characterLabel} characterLabel={characterLabel} needs={needs} cols={partsDetailCols} onSortClick={partsDetailSortOnClick} />
          ))}
      </div>

      {showRules && subView !== 'shopping' && (
        <React.Fragment>
          <div
            onMouseDown={() => {
              draggingRef.current = true;
            }}
            title="Drag to resize"
            style={{ width: '6px', alignSelf: 'stretch', cursor: 'col-resize', background: '#333', flexShrink: 0 }}
          />
          <div style={{ width: `${rulesPanelWidth}px`, minWidth: '180px', flexShrink: 0, overflowX: 'auto' }}>
            <h2 style={{ padding: '0 0 8px' }}>Sub Build Rules</h2>
            <SubRulesPanel />
          </div>
        </React.Fragment>
      )}
    </div>
  );
}
