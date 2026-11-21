// Parts page: parts still needed for each sub's target build, the summary of what to craft, and build rules.

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
  { key: 'character', label: 'Character', default: false, cell: (n) => <CharacterName name={n.character_name} world={n.world} />, sort: (r) => r.character_name },
  { key: 'rank', label: 'Rank', cell: (n) => n.rank, sort: (r) => r.rank },
  // The class, then the slot ("Shark Hull"), as the plugin's.
  { key: 'needed', label: 'Needed', cell: (n) => needsLabel(n), sort: (r) => needsLabel(r) },
  { key: 'slot', label: 'Slot', cell: (n) => n.slot, sort: (r) => r.slot },
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
  const title = `For its next build at rank ${need.rank} (the Subs page's Next build)${until === 'now' ? ', which it can switch to already.' : `, about ${date}. An estimate: see Next rank forecasts on the Subs page for how close these come.`}`;
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
  { key: 'neededClass', label: 'Class needed', locked: true, cell: (e) => e.needed, sort: (e) => e.needed },
  { key: 'slot', label: 'Slot', cell: (e) => e.slot, sort: (e) => e.slot },
  { key: 'qty', label: 'Still needed', cell: (e) => e.qty, sort: (e) => e.qty }
];
// With Look ahead on: what is needed now and what builds coming up need, side by side.
const PARTS_SUMMARY_AHEAD_COLUMN_DEFS = [
  ...PARTS_SUMMARY_COLUMN_DEFS.slice(0, 2),
  { key: 'qty', label: 'Needed now', cell: (e) => e.qty, sort: (e) => e.qty },
  { key: 'ahead', label: 'Coming up', cell: (e) => e.ahead, sort: (e) => e.ahead }
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
    return <div className="status">Nothing needs crafting: every part needed is covered by a spare or another sub's old part.</div>;
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
          .filter((r) => matchesWords(`${r.name} (${r.world})`, query))
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
            background: 'var(--panel)',
            border: '1px solid var(--border-strong)',
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
  { key: 'appliesTo', label: 'Applies to' },
  { key: 'hull', label: 'Hull' },
  { key: 'stern', label: 'Stern' },
  { key: 'bow', label: 'Bow' },
  { key: 'bridge', label: 'Bridge' },
  { key: 'characterOverride', label: 'Character override' },
];

function SubRuleRow({ rule, roster, onSave, onDelete, cols }) {
  // Edits are kept only until saved: a row with none shows the rule as read last (changed in the game too, as the
  // plugin does), so Save never writes back an old copy. A new row is all draft until saved.
  const [draft, setDraft] = useState(null);
  const local = draft || rule;
  const setLocal = setDraft;
  const [saveStatus, setSaveStatus] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const filterState = parseSubFilterToSlots(local.sub_filter);

  // Unticking All leaves slot 1 ticked (a rule applies to at least one slot), as the plugin.
  function setAll(checked) {
    setLocal({ ...local, sub_filter: checked ? '' : slotsToSubFilter(false, [1]) });
  }

  function setSlot(slotNum, checked) {
    const currentSlots = filterState.all ? [] : filterState.slots;
    const slots = checked ? [...currentSlots, slotNum] : currentSlots.filter((s) => s !== slotNum);
    setLocal({ ...local, sub_filter: slotsToSubFilter(false, slots) });
  }

  async function handleSave() {
    setSaveStatus('Saving...');
    const result = await onSave(local, rule);
    setSaveStatus(result.success ? 'Saved.' : `Failed: ${result.error}`);
    if (result.success) setDraft(null);
  }

  async function handleDelete() {
    setConfirmDelete(false);
    if (!rule.id) { onDelete(rule); return; } // never saved: just taken off the list
    setSaveStatus('Deleting...');
    const result = await onDelete(rule);
    setSaveStatus(result.success ? '' : `Not deleted: ${result.error}`);
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
        {/* As the plugin: Delete asks first, in the row. */}
        {!confirmDelete && <button onClick={() => setConfirmDelete(true)}>Delete</button>}
        {confirmDelete && (
          <React.Fragment>
            <button className="danger" onClick={handleDelete}>Delete it</button>{' '}
            <button onClick={() => setConfirmDelete(false)}>Keep</button>
          </React.Fragment>
        )}
        {draft && rule.id && <div className="unsaved-note" style={{ marginLeft: 0 }}>Not saved yet</div>}
        {saveStatus && <div style={{ fontSize: '0.8em', color: 'var(--dim)' }}>{saveStatus}</div>}
      </td>
    </tr>
  );
}

// refreshKey: reads the rules again with the page. onChanged: after a save or delete, so the parts beside it follow.
function SubRulesPanel({ refreshKey, onChanged = () => {} }) {
  const [rules, setRules] = useState(null);
  // Rows added but not saved yet, each with its own id (not its place in the list, which sorting changes).
  const [newRules, setNewRules] = useState([]);
  const nextNewId = useRef(0);
  // A new rule moves to its place among the saved ones once saved, so "Saved." shows here rather than in its row.
  const [panelStatus, setPanelStatus] = useState('');
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
  }, [fetchRules, refreshKey]);

  async function handleSave(edited, row) {
    const { newId, ...rule } = edited;
    const result = rule.id ? await window.api.updateSubBuildRule(rule) : await window.api.addSubBuildRule(rule);
    if (result.success) {
      if (row.newId) {
        setNewRules((prev) => prev.filter((r) => r.newId !== row.newId));
        setPanelStatus(`Rank ${rule.rank} rule saved.`);
      }
      await fetchRules();
      onChanged();
    }
    return result;
  }

  async function handleDelete(row) {
    if (!row.id) {
      setNewRules((prev) => prev.filter((r) => r.newId !== row.newId));
      return { success: true };
    }
    const result = await window.api.deleteSubBuildRule(row.id);
    if (result.success) {
      await fetchRules();
      onChanged();
    }
    return result;
  }

  function handleAddRow() {
    setNewRules((prev) => [
      ...prev,
      { newId: `new-${++nextNewId.current}`, id: null, rank: 0, cid_override: null, sub_filter: '', hull: '', stern: '', bow: '', bridge: '' }
    ]);
  }

  if (error && rules === null) return <div className="error">Failed to load rules: {error}</div>;
  if (rules === null) return <div className="status">Loading...</div>;

  // New rows stay at the bottom, in the order added, until saved.
  const sortedRules = [
    ...(subRulesSort.sortColumn ? applyColumnSort(rules, subRulesSort.sortColumn, subRulesSort.sortDirection, subRulesAccessors) : rules),
    ...newRules,
  ];

  return (
    <div className="sub-rules">
      <div className="controls">
        <button onClick={handleAddRow}>Add Rule</button>
        {panelStatus && <span className="save-status">{panelStatus}</span>}
        {error && <span className="error-inline">Could not update the rules: {error}</span>}
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
          {sortedRules.map((rule) => (
            <SubRuleRow key={rule.id ?? rule.newId} rule={rule} roster={roster} onSave={handleSave} onDelete={handleDelete} cols={subRulesCols} />
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
const LOOK_AHEAD_HELP = 'Also list the parts of each sub\'s next build (the Subs page\'s Next build) when it is due within this many days, ' +
  'so they can be bought or crafted ahead of time. Spares go to what is needed now first. Applies to Summary, Detail and the Shopping List.';

function PartsView({ refreshKey }) {
  // Bumped after a Sub Rule is saved or deleted, so the parts it decides are read again (as the plugin does).
  const [rulesChanged, setRulesChanged] = useState(0);
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
    contextKeys: ['character'],
    contextActive: !!partsDetailSort.sortColumn
  });
  const partsDetailRows = partsDetailCols.rows;
  const partsDetailSortOnClick = (col) => partsDetailSort.handleSortClick(col, groupByAccountEnabled, setGroupByAccountEnabled);
  const [showRules, setShowRules] = useState(() => {
    const saved = localStorage.getItem('partsRulesPanelVisible');
    return saved === null ? true : saved === 'true';
  });
  // The rules panel's width: at least 180px, and never so wide that the parts table has less than 320px left.
  // (The room is the page's own, beside the app's sidebar; the window's width until the page is drawn.)
  const pageRef = useRef(null);
  const clampRulesWidth = (w) => {
    const room = pageRef.current ? pageRef.current.clientWidth : window.innerWidth;
    return Math.max(180, Math.min(Number.isFinite(w) ? w : 420, room - 320));
  };
  const [rulesPanelWidth, setRulesPanelWidth] = useState(() => {
    const saved = localStorage.getItem('partsRulesPanelWidth');
    return clampRulesWidth(saved === null ? 420 : Number(saved));
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
  }, [refreshKey, aheadDays, rulesChanged]);

  // Plain mouse-drag resize, clamped (clampRulesWidth) so neither the panel nor the parts table becomes unusable;
  // remembered on this PC. A smaller window brings a wide panel back within the window.
  useEffect(() => {
    function handleMouseMove(e) {
      if (!draggingRef.current) return;
      setRulesPanelWidth(clampRulesWidth(window.innerWidth - e.clientX));
    }
    function handleResize() {
      setRulesPanelWidth((w) => clampRulesWidth(w));
    }
    window.addEventListener('resize', handleResize);
    function handleMouseUp() {
      draggingRef.current = false;
    }
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  // Once the page is drawn (after loading), its own room is known: bring a remembered width within it.
  const drawn = rows !== null;
  useEffect(() => {
    if (drawn) setRulesPanelWidth((w) => clampRulesWidth(w));
  }, [drawn]);

  if (error && rows === null) return <div className="error">Failed to load: {error}</div>;
  if (rows === null) return <div className="status">Loading...</div>;

  return (
    <div ref={pageRef} style={{ display: 'flex', alignItems: 'flex-start' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        {error && <div className="error">Could not update: {error}. Showing what was loaded before.</div>}
        <div className="controls">
          <button onClick={() => setSubView('summary')} className={`sub-tab${subView === 'summary' ? ' active' : ''}`} aria-pressed={subView === 'summary'}>
            Summary
          </button>{' '}
          <button onClick={() => setSubView('detail')} className={`sub-tab${subView === 'detail' ? ' active' : ''}`} aria-pressed={subView === 'detail'}>
            Detail
          </button>{' '}
          <button onClick={() => setSubView('shopping')} className={`sub-tab${subView === 'shopping' ? ' active' : ''}`} aria-pressed={subView === 'shopping'}>
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

        {subView === 'shopping' && <ShoppingListView refreshKey={`${refreshKey}|${rulesChanged}`} aheadDays={aheadDays} />}

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
            style={{ width: '6px', alignSelf: 'stretch', cursor: 'col-resize', background: 'var(--border-strong)', flexShrink: 0 }}
          />
          <div style={{ width: `${rulesPanelWidth}px`, minWidth: '180px', flexShrink: 0, overflowX: 'auto' }}>
            <h2 style={{ padding: '0 0 8px' }}>Sub Rules</h2>
            <SubRulesPanel refreshKey={refreshKey} onChanged={() => setRulesChanged((n) => n + 1)} />
          </div>
        </React.Fragment>
      )}
    </div>
  );
}
