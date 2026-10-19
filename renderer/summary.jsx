// Summary tab: the fleet overview, warnings, and links to the other tabs.

// Fleet-wide overview: FC houses nobody has entered for a while (the game
// demolishes them at 45 days), low repair/ceruleum warnings (their
// thresholds are in Settings → General), plus linked counts for the other three
// "needs attention" categories already built elsewhere in the app.
// No LLM involved - everything here is real Postgres data, same as
// every other view.
// The Parts tab's rows grouped per built sub: subs whose rank now calls for different parts (the same
// as the Discord "Ready for new parts" alert, alerts/checks.js).
function subsReadyForParts(partRows) {
  const subs = new Map();
  for (const r of partRows) {
    if (!(Number(r.rank) > 0)) continue;
    const key = `${r.cid}|${r.sub_name}`;
    if (!subs.has(key)) subs.set(key, { cid: r.cid, sub_name: r.sub_name, rank: r.rank, character_name: r.character_name, world: r.world, sort_index: r.sort_index, parts: [] });
    subs.get(key).parts.push({ slot: r.slot, part: `${r.needed_modified ? 'Modified ' : ''}${r.needed_class}`, spare: r.spare_location || null });
  }
  return [...subs.values()].sort((a, b) => (a.sort_index ?? 1e9) - (b.sort_index ?? 1e9) || String(a.sub_name).localeCompare(String(b.sub_name)));
}

const HOUSE_WARNING_COLUMN_DEFS = [
  { key: 'fc', label: 'Free Company', locked: true, cell: (h) => h.fc_name || '—', sort: (h) => h.fc_name },
  { key: 'world', label: 'World', cell: (h) => h.fc_world || '—', sort: (h) => h.fc_world },
  { key: 'account', label: 'Account', cell: (h) => h.account_label || '—', sort: (h) => h.account_label },
  { key: 'house', label: 'House', cell: (h) => formatHouse(h), sort: (h) => formatHouse(h) },
  { key: 'last_entered', label: 'Last Entered', td: (h) => <td><HouseAge row={h} /></td>, sort: (h) => h.house_days },
  {
    key: 'demolition', label: 'Demolition Possible In',
    td: (h) => (
      <td className={`house-age ${h.house_level}`}>
        {h.demolition_in_days === null ? 'Unknown, check in game'
          : h.demolition_in_days === 0 ? 'Any time now'
            : `about ${h.demolition_in_days} day${h.demolition_in_days === 1 ? '' : 's'}`}
      </td>
    ),
    sort: (h) => h.demolition_in_days,
  },
];
const HOUSE_WARNING_DUPLICATE_EXTRAS = ['x_account'];

const READY_SUB_COLUMN_DEFS = [
  { key: 'character', label: 'Character', locked: true, cell: (r) => r.character_name, sort: (r) => r.character_name },
  { key: 'world', label: 'World', cell: (r) => r.world, sort: (r) => r.world },
  { key: 'sub', label: 'Sub', cell: (r) => r.sub_name, sort: (r) => r.sub_name },
  { key: 'rank', label: 'Rank', cell: (r) => r.rank, sort: (r) => Number(r.rank) },
  { key: 'parts', label: 'New parts', cell: (r) => r.parts.map((p) => `${p.slot} ${p.part} (${p.spare ? `spare in ${p.spare}` : 'to craft'})`).join(', '), sortable: false },
];

const LOW_SUPPLY_COLUMN_DEFS = [
  { key: 'character', label: 'Character', locked: true, cell: (w) => w.character_name, sort: (w) => w.character_name },
  { key: 'world', label: 'World', cell: (w) => w.world, sort: (w) => w.world },
  { key: 'account', label: 'Account', cell: (w) => w.account_label, sort: (w) => w.account_label },
  { key: 'repair_kits', label: 'Repair Kits', cellStyle: (w) => ({ color: w.low_repair ? '#e57373' : undefined }), cell: (w) => w.repair_kits, sort: (w) => w.repair_kits },
  { key: 'ceruleum', label: 'Ceruleum', cellStyle: (w) => ({ color: w.low_ceruleum ? '#e57373' : undefined }), cell: (w) => w.ceruleum, sort: (w) => w.ceruleum },
];
const SUMMARY_CHARACTER_DUPLICATE_EXTRAS = ['x_world', 'x_account', 'x_ceruleum', 'x_repair_kits'];

const RETAINER_IDLE_COLUMN_DEFS = [
  { key: 'character', label: 'Character', locked: true, cell: (r) => r.owner_name, sort: (r) => r.owner_name },
  { key: 'world', label: 'World', cell: (r) => r.world, sort: (r) => r.world },
  { key: 'account', label: 'Account', cell: (r) => r.account_label || '—', sort: (r) => r.account_label },
  { key: 'retainer', label: 'Retainer', cell: (r) => r.retainer_name, sort: (r) => r.retainer_name },
  { key: 'class', label: 'Class', cell: (r) => r.job_abbreviation || '—', sort: (r) => r.job_abbreviation },
];

const summaryGil = (n) => Math.round(Number(n) || 0).toLocaleString();

function SummaryTile({ label, value, note, className = '', children }) {
  return (
    <div className={`account-group ${className}`} style={{ flex: 1, minWidth: '200px', padding: '16px' }}>
      <div style={{ color: '#8a8f9a', fontSize: '13px' }}>{label}</div>
      <div style={{ fontSize: '22px', fontWeight: 600 }}>{value}</div>
      {note && <div style={{ color: '#8a8f9a', fontSize: '13px' }}>{note}</div>}
      {children}
    </div>
  );
}

// Retainers right now (retainer-summary.js), venture income (Income tab) and listings unsold for a while
// (Gil & Market tab). Shown when the player runs retainers (Settings → What do you run?).
function RetainerSummarySection({ refreshKey, onNavigate }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [ventures, setVentures] = useState(null);
  const [market, setMarket] = useState(null);
  const idleSort = useColumnSort();
  const idleCols = useTableColumns({
    tableKey: 'summaryIdleRetainers', ownDefs: RETAINER_IDLE_COLUMN_DEFS, subject: 'character', excludeExtras: SUMMARY_CHARACTER_DUPLICATE_EXTRAS,
    rows: data ? data.idle : null, idOf: (r) => r.owner_cid, refreshKey,
  });

  useEffect(() => {
    window.api.getRetainerSummary().then((r) => { if (r.success) { setData(r); setError(null); } else setError(r.error); });
    window.api.getLoot().then((r) => setVentures(r.success && !r.missing ? r : false));
    window.api.getMarket().then((r) => setMarket(r.success ? r : false));
  }, [refreshKey]);

  const m = market ? market.market : null;
  const needs008 = 'needs a database update (see the banner at the top)';
  return (
    <div className="summary-retainers">
      <h2 style={{ padding: '8px 24px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        Retainers
        <button onClick={() => onNavigate('retainers')} style={{ fontSize: '13px', fontWeight: 400 }}>View Retainers</button>
      </h2>
      {error && <div className="error">Failed to load: {error}</div>}
      <div style={{ display: 'flex', gap: '16px', padding: '0 24px 16px', flexWrap: 'wrap' }}>
        <SummaryTile className="retainers-idle-tile" label="Without a Venture" value={data ? data.idle.length : '—'}
          note={data ? `of ${data.total} retainer${data.total === 1 ? '' : 's'} with a class` : ''} />
        <SummaryTile className="retainers-ventures-tile" label="Ventures" value={data ? `${data.ready} ready to collect` : '—'}
          note={data ? `${data.away} out, ${data.soon} back within an hour` : ''} />
        <SummaryTile className="retainers-income-tile" label="Venture Income"
          value={ventures ? `${summaryGil(ventures.ventureTotals.perDay)} gil a day` : '—'}
          note={ventures ? `last ${ventures.windowDays} days, at what a vendor pays${ventures.market && ventures.market.ventures
            ? ` · market: ${['world', 'dc', 'region'].map((sc) => `${summaryGil(ventures.market.ventures[sc].perDay)} (${{ world: 'World', dc: 'DC', region: 'Region' }[sc]})`).join(', ')}` : ''}`
            : ventures === false ? needs008 : ''}>
          <button onClick={() => onNavigate('income')} style={{ marginTop: '8px' }}>View Income</button>
        </SummaryTile>
        <SummaryTile className="retainers-listings-tile" label="Listings Unsold for a While" value={m ? m.totals.stale.toLocaleString() : '—'}
          note={m ? `up for ${market.minDays}+ days, ${summaryGil(m.totals.staleValue)} gil${m.live && m.live.undercut ? ` · ${m.live.undercut.length} undercut` : ''}` : market ? needs008 : ''}>
          <button onClick={() => onNavigate('market')} style={{ marginTop: '8px' }}>View Gil & Market</button>
        </SummaryTile>
      </div>
      {data && data.idle.length === 0 && <div className="status retainers-all-busy">Every retainer with a class is on a venture.</div>}
      {data && data.idle.length > 0 && (
        <React.Fragment>
          <div className="controls"><ColumnPicker cols={idleCols} /></div>
          <ColumnTable cols={idleCols} sort={idleSort} rows={idleCols.rows} rowKey={(r) => `${r.owner_cid}|${r.retainer_name}`} className="idle-retainers" />
        </React.Fragment>
      )}
    </div>
  );
}

// uses: what the player runs (play-style.js): sections for subs or for retainers only when they are run.
function SummaryView({ onNavigate, onOpenTrend, refreshKey, onOpenSettings, uses = { subs: true, retainers: true } }) {
  const [warnings, setWarnings] = useState(null);
  const [notSynced, setNotSynced] = useState([]);
  const [thresholds, setThresholds] = useState({ repairKitThreshold: 0, ceruleumThreshold: 0, houseWarnDays: 7 });
  const [houseWarnings, setHouseWarnings] = useState(null);
  const [salvageTotal, setSalvageTotal] = useState(null);
  const [partsNeededCount, setPartsNeededCount] = useState(null);
  const [readySubs, setReadySubs] = useState(null);
  const [routeOptCount, setRouteOptCount] = useState(null);
  const [error, setError] = useState(null);
  const houseSort = useColumnSort();
  const houseCols = useTableColumns({
    tableKey: 'summaryHouses', ownDefs: HOUSE_WARNING_COLUMN_DEFS, subject: 'fc', excludeExtras: HOUSE_WARNING_DUPLICATE_EXTRAS,
    rows: houseWarnings, idOf: (h) => h.fc_id, refreshKey,
  });
  const readySort = useColumnSort();
  const readyCols = useTableColumns({
    tableKey: 'summaryReadySubs', ownDefs: READY_SUB_COLUMN_DEFS, subject: 'character', excludeExtras: SUMMARY_CHARACTER_DUPLICATE_EXTRAS,
    rows: readySubs, idOf: (r) => r.cid, refreshKey,
  });
  const lowSort = useColumnSort();
  const lowCols = useTableColumns({
    tableKey: 'summaryLowSupplies', ownDefs: LOW_SUPPLY_COLUMN_DEFS, subject: 'character', excludeExtras: SUMMARY_CHARACTER_DUPLICATE_EXTRAS,
    rows: warnings, idOf: (w) => w.cid, refreshKey,
  });

  function loadWarnings() {
    window.api.getFleetWarnings().then((result) => {
      if (result.success) {
        setWarnings(result.rows);
        setNotSynced(result.notSynced || []);
        setThresholds((t) => ({ ...t, repairKitThreshold: result.repairKitThreshold, ceruleumThreshold: result.ceruleumThreshold }));
      } else {
        setError(result.error);
      }
    });
    window.api.getHouseWarnings().then((result) => {
      if (result.success) {
        setHouseWarnings(result.rows);
        setThresholds((t) => ({ ...t, houseWarnDays: result.warnDays }));
      } else {
        setError(result.error);
      }
    });
  }

  useEffect(() => {
    loadWarnings();

    window.api.getSalvage().then((result) => {
      if (result.success) {
        setSalvageTotal(result.rows.reduce((sum, r) => sum + Number(r.calculated_gil), 0));
      }
    });

    window.api.getPartsNeeded().then((result) => {
      if (result.success) {
        setPartsNeededCount(result.rows.filter((r) => !r.spare_location).length);
        setReadySubs(subsReadyForParts(result.rows));
      }
    });

    window.api.getSubmarines().then((result) => {
      if (result.success) {
        setRouteOptCount(computeSuboptimalSubs(result.rows).length);
      }
    });
  }, [refreshKey]);

  if (error) return <div className="error">Failed to load: {error}</div>;
  // Characters no longer synced keep their old subs; they are left out here as in the alerts.
  const notSyncedCids = new Set(notSynced.map((c) => String(c.cid)));
  const readyShown = readyCols.rows === null ? null : readyCols.rows.filter((s) => !notSyncedCids.has(String(s.cid)));

  return (
    <div>
      <div className="controls summary-thresholds">
        <span>
          Warnings: {uses.subs && (
            <React.Fragment>
              {thresholds.repairKitThreshold ? `repair kits below ${thresholds.repairKitThreshold}` : 'low repair kits: off'},
              {' '}{thresholds.ceruleumThreshold ? `ceruleum below ${thresholds.ceruleumThreshold}` : 'low ceruleum: off'},{' '}
            </React.Fragment>
          )}FC house not entered for {thresholds.houseWarnDays} days.
        </span>
        <button onClick={onOpenSettings}>Change in Settings</button>
      </div>

      <h2 style={{ padding: '8px 24px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        FC Houses Not Entered Recently
        <button onClick={() => onNavigate('fcDirectory')} style={{ fontSize: '13px', fontWeight: 400 }}>View Free Companies</button>
      </h2>
      {houseWarnings === null && <div className="status">Loading...</div>}
      {houseWarnings !== null && houseWarnings.length === 0 && (
        <div className="status house-warnings-none">Every FC house was entered in the last {thresholds.houseWarnDays} days.</div>
      )}
      {houseWarnings !== null && houseWarnings.length > 0 && (
        <React.Fragment>
          <div className="controls"><ColumnPicker cols={houseCols} /></div>
          <ColumnTable cols={houseCols} sort={houseSort} rows={houseCols.rows} rowKey={(h) => h.fc_id} className="house-warnings" />
        </React.Fragment>
      )}

      {uses.subs && (<React.Fragment>
      <div style={{ display: 'flex', gap: '16px', padding: '8px 24px 16px', flexWrap: 'wrap' }}>
        <div className="account-group" style={{ flex: 1, minWidth: '200px', padding: '16px' }}>
          <div style={{ color: '#8a8f9a', fontSize: '13px' }}>Fleet-Wide Salvage Total</div>
          <div style={{ fontSize: '22px', fontWeight: 600 }}>
            {salvageTotal === null ? '—' : `${salvageTotal.toLocaleString()} gil`}
          </div>
        </div>
        <div className="account-group" style={{ flex: 1, minWidth: '200px', padding: '16px' }}>
          <div style={{ color: '#8a8f9a', fontSize: '13px' }}>Parts That Need Crafting</div>
          <div style={{ fontSize: '22px', fontWeight: 600 }}>{partsNeededCount === null ? '—' : partsNeededCount}</div>
          <button onClick={() => onNavigate('parts')} style={{ marginTop: '8px' }}>View Parts</button>
        </div>
        <div className="account-group" style={{ flex: 1, minWidth: '200px', padding: '16px' }}>
          <div style={{ color: '#8a8f9a', fontSize: '13px' }}>Route Optimizations Possible</div>
          <div style={{ fontSize: '22px', fontWeight: 600 }}>{routeOptCount === null ? '—' : routeOptCount}</div>
          <button onClick={() => onNavigate('routeOpt')} style={{ marginTop: '8px' }}>View Route Optimization</button>
        </div>
      </div>

      <h2 style={{ padding: '8px 24px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        Subs Ready for New Parts
        <button onClick={() => onNavigate('parts')} style={{ fontSize: '13px', fontWeight: 400 }}>View Parts</button>
      </h2>
      {readySubs === null && <div className="status">Loading...</div>}
      {readyShown !== null && readyShown.length === 0 && <div className="status">No sub has reached the rank of its next build.</div>}
      {readyShown !== null && readyShown.length > 0 && (
        <React.Fragment>
          <div className="controls"><ColumnPicker cols={readyCols} /></div>
          <ColumnTable cols={readyCols} sort={readySort} rows={readyShown} rowKey={(sub) => `${sub.cid}|${sub.sub_name}`} className="ready-subs" />
        </React.Fragment>
      )}
      </React.Fragment>)}

      {uses.retainers && <RetainerSummarySection refreshKey={refreshKey} onNavigate={onNavigate} />}

      <SummaryTrendTiles refreshKey={refreshKey} onOpenTrend={onOpenTrend} uses={uses} />

      {uses.subs && (<React.Fragment>
      <h2 style={{ padding: '8px 24px' }}>Low Repair Kits / Ceruleum</h2>
      {warnings === null && <div className="status">Loading...</div>}
      {warnings !== null && warnings.length === 0 && (
        <div className="status">No characters below the current thresholds.</div>
      )}
      {warnings !== null && warnings.length > 0 && (
        <React.Fragment>
          <div className="controls"><ColumnPicker cols={lowCols} /></div>
          <ColumnTable cols={lowCols} sort={lowSort} rows={lowCols.rows} rowKey={(w) => w.cid} className="low-supplies" />
        </React.Fragment>
      )}
      </React.Fragment>)}
      {notSynced.length > 0 && (
        <div className="warning not-synced-note">
          Not counted: {notSynced.length} character{notSynced.length === 1 ? ' is' : 's are'} no longer synced while the rest of
          their account is ({notSynced.map((c) => `${c.name} for ${formatSpan(c.behind_ms)}`).join(', ')}). Untick them in the
          plugin and remove them on the Roster, or tick them again.
        </div>
      )}
    </div>
  );
}
