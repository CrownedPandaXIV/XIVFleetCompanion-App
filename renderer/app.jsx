// The app window: the sidebar, the header's plugin data note, and the tab that is showing.

// Central list of every view in the sidebar - one place to add a new
// view later rather than touching multiple spots. `built: false` views
// render the ComingSoonView placeholder instead of real content.
const VIEWS = [
  { key: 'summary', label: 'Summary', built: true },
  { key: 'roster', label: 'Character Roster', built: true },
  { key: 'fcDirectory', label: 'Free Companies', built: true },
  { key: 'salvage', label: 'Salvage', built: true },
  { key: 'subs', label: 'Subs', built: true },
  { key: 'supplies', label: 'Supplies', built: true },
  { key: 'income', label: 'Income', built: true },
  { key: 'parts', label: 'Parts', built: true },
  { key: 'routeOpt', label: 'Route Optimization', built: true },
  { key: 'inventory', label: 'Inventory', built: true },
  { key: 'retainers', label: 'Retainers', built: true },
  { key: 'market', label: 'Gil & Market', built: true },
  { key: 'trends', label: 'Trends', built: true },
  { key: 'pcs', label: 'PCs', built: true }
];

// hidden: the views left out for what the player does not run (Settings → What do you run?).
function SidebarNav({ currentView, onSelect, hidden = [] }) {
  return (
    <div className="sidebar">
      {VIEWS.filter((v) => !hidden.includes(v.key)).map((v) => (
        <button
          key={v.key}
          className={`sidebar-button${currentView === v.key ? ' active' : ''}`}
          onClick={() => onSelect(v.key)}
        >
          <div>{v.label}</div>
          {!v.built && <div className="coming-soon-tag">Coming soon</div>}
        </button>
      ))}
    </div>
  );
}

function ComingSoonView({ label }) {
  return (
    <div className="status">
      {label} view — coming soon.
    </div>
  );
}

// The database connection (see connection-status.js). `onReconnect` runs when the database can be
// reached again after it could not, so every tab reloads.
function useConnectionStatus(onReconnect) {
  const [status, setStatus] = useState({ online: true });
  const reconnectRef = useRef(onReconnect);
  reconnectRef.current = onReconnect;

  useEffect(() => {
    let wasOnline = true;
    const apply = (next) => {
      setStatus(next);
      if (next.online && !wasOnline) reconnectRef.current();
      wasOnline = next.online;
    };
    const stop = window.api.onConnectionStatus(apply);
    window.api.getConnectionStatus().then(apply).catch(() => {});
    return stop;
  }, []);
  return status;
}

function formatClock(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Header dot: green while the database answers, amber with how long it has been while it does not.
function ConnectionDot({ status }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (status.online) return undefined;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(interval);
  }, [status.online]);

  if (status.online) {
    return <span className="save-status connection-dot" title="The database is answering.">Database</span>;
  }
  const since = status.offlineSince ? formatAge(now - status.offlineSince).replace(' ago', '') : '';
  return (
    <span className="save-status connection-dot offline" title={status.message || 'The database cannot be reached.'}>
      Database offline{since && since !== 'just now' ? ` · ${since}` : ''}
    </span>
  );
}

// Shown under the header while the database cannot be reached. Every tab keeps what it last loaded.
function ConnectionBanner({ status }) {
  if (status.online) return null;
  const loaded = status.lastOkAt
    ? `Showing what was loaded at ${formatClock(status.lastOkAt)}.`
    : 'Nothing could be loaded yet.';
  const every = Math.round((status.retryEveryMs || 30000) / 1000);
  return (
    <div className="connection-banner" role="status">
      <strong>Offline{status.offlineSince ? ` since ${formatClock(status.offlineSince)}` : ''}.</strong>{' '}
      {status.message} {loaded} Trying again every {every} seconds; everything reloads when the database is back.
    </div>
  );
}

// Shown under the header once the installed app has downloaded a new version (updater.js). "Restart to update"
// first says what happens next, since the installer can take a minute to appear once the app has closed.
const UPDATE_NOTICE_MS = 4000;

function UpdateBanner() {
  const [ready, setReady] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    window.api.getUpdateReady().then((r) => { if (r) setReady(r); });
    return window.api.onUpdateReady(setReady);
  }, []);
  if (!ready) return null;
  if (busy) {
    return (
      <div className="update-banner" role="status">
        Updating to version {ready.version}. The app closes now, then the installer shows its progress. The app
        opens again by itself when it's done, which can take a minute or two.
      </div>
    );
  }
  const restart = () => {
    setBusy(true);
    setTimeout(() => window.api.installUpdate(), UPDATE_NOTICE_MS);
  };
  return (
    <div className="update-banner" role="status">
      Version {ready.version} is ready.{' '}
      <button onClick={restart}>Restart to update</button>
      {' '}It is also installed the next time you close the app.
    </div>
  );
}

// Shown under the header when the app could not update the database (db/apply-updates.js), when it has just
// set up a new one, or when a newer copy of the app has already updated it further.
function DatabaseBanner() {
  const [status, setStatus] = useState(null);
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    window.api.getDatabaseStatus().then((s) => { if (s) setStatus(s); });
    return window.api.onDatabaseStatus(setStatus);
  }, []);
  if (!status) return null;
  if (status.move && status.move.error) {
    return (
      <div className="connection-banner move-banner" role="status">
        <strong>The database moved to {status.move.to}, but this PC can't reach it yet.</strong> {status.move.error} What's shown
        here is from before the move. The app tries again every minute.
      </div>
    );
  }
  if (!status.ok) {
    return (
      <div className="connection-banner" role="status">
        <strong>The database could not be updated.</strong> {status.message} Everything that does not need the
        update keeps working; the app tries again in a few minutes.
      </div>
    );
  }
  if (status.gameData === 'filling') {
    return (
      <div className="update-banner" role="status">
        {status.created ? 'A new database was set up. ' : ''}Filling in the game data (item names, worlds, recipes). This takes
        a minute or two; everything appears once it's done.
      </div>
    );
  }
  if (closed) return null;
  if (status.move && status.move.followed) {
    return (
      <div className="update-banner move-banner" role="status">
        The database moved to another PC ({status.move.to}), and this PC switched to it by itself.
        <button onClick={() => setClosed(true)}>Close</button>
      </div>
    );
  }
  if (status.gameData === 'filled' || status.gameData === 'partial' || status.gameData === 'failed') {
    return (
      <div className="update-banner" role="status">
        {status.gameData === 'filled' && 'The game data is filled in.'}
        {status.gameData === 'partial' && 'Most of the game data is filled in, but some of it could not be downloaded. Try again in Settings > Data > Game Data > Update.'}
        {status.gameData === 'failed' && `The game data could not be filled in (${status.gameDataProblem}). Try again in Settings > Data > Game Data > Update.`}
        <button onClick={() => setClosed(true)}>Close</button>
      </div>
    );
  }
  if (status.created) {
    return (
      <div className="update-banner" role="status">
        A new database was set up. Next, fill in the game data: Settings &gt; Data &gt; Game Data &gt; Update.
        <button onClick={() => setClosed(true)}>Close</button>
      </div>
    );
  }
  if (status.newer) {
    return (
      <div className="update-banner" role="status">
        A newer version of the app has already updated this database. Update this copy so everything shows correctly.
        <button onClick={() => setClosed(true)}>Close</button>
      </div>
    );
  }
  return null;
}

// Header note saying how old the newest plugin data is. The plugin only writes while the game is
// running, so this is information, not an error: it turns amber once an account has sent nothing
// for STALE_AFTER_MINUTES, which is when the tables on screen may no longer match the game.
const STALE_AFTER_MINUTES = 30;

function formatAge(ms) {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

function PluginDataStatus({ refreshKey }) {
  const [accounts, setAccounts] = useState(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    window.api.getDataFreshness().then((result) => {
      if (result.success) { setAccounts(result.accounts); setFailed(false); } else setFailed(true);
    }).catch(() => setFailed(true));
  }, [refreshKey]);

  // Keeps "N min ago" current between refreshes.
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(interval);
  }, []);

  if (failed) return <span className="save-status plugin-data">Plugin data: could not check</span>;
  if (!accounts) return null;
  const known = accounts.filter((a) => a.newest);
  if (known.length === 0) return <span className="save-status plugin-data">Plugin data: none yet</span>;

  const ageOf = (a) => now - Date.parse(a.newest);
  const label = (a) => a.accountLabel || 'No account label';
  const staleMs = STALE_AFTER_MINUTES * 60000;
  const newest = Math.min(...known.map(ageOf));
  const stale = known.filter((a) => ageOf(a) >= staleMs).sort((a, b) => ageOf(b) - ageOf(a));
  const details = known.map((a) => `${label(a)}: ${formatAge(ageOf(a))} (${a.characters} characters)`).join('\n');
  const title = `Newest data the plugin wrote, per account:\n${details}\n\nThe plugin only writes while the game is running.`;

  return (
    <span className={`save-status plugin-data${stale.length ? ' stale' : ''}`} title={title}>
      Plugin data: {formatAge(newest)}
      {stale.length > 0 && stale.length < known.length && ` · ${label(stale[0])}: ${formatAge(ageOf(stale[0]))}`}
      {stale.length > 1 && stale.length < known.length && ` (+${stale.length - 1} more)`}
    </span>
  );
}

function App() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [groupByAccountEnabled, setGroupByAccountEnabled] = useState(true);
  const [saveStatus, setSaveStatus] = useState('');
  // false, or which Settings tab to open on (true: the last one used).
  const [showSettings, setShowSettings] = useState(false);
  const [currentView, setCurrentView] = useState('summary');
  // The setup screen opens by itself the first time, while no connection is saved, until it has been finished
  // or skipped once on this PC (a PC that only plays never saves a connection here).
  const [showSetup, setShowSetup] = useState(false);
  useEffect(() => {
    let seen = false;
    try { seen = localStorage.getItem('setupSeen') === '1'; } catch { /* not remembered */ }
    if (seen) return;
    window.api.getPostgresConfig().then((c) => { if (!c || !c.host) setShowSetup(true); }).catch(() => {});
  }, []);
  const [trendsPreset, setTrendsPreset] = useState(null);
  const [trendDetail, setTrendDetail] = useState(null);

  // Chart icons and cards elsewhere ask for a detail panel or the Trends tab by event.
  useEffect(() => {
    const openDetail = (e) => setTrendDetail(e.detail);
    const openTrends = (e) => { setTrendsPreset({ ...e.detail, at: Date.now() }); setTrendDetail(null); setCurrentView('trends'); };
    window.addEventListener('open-trend-detail', openDetail);
    window.addEventListener('open-trends', openTrends);
    return () => {
      window.removeEventListener('open-trend-detail', openDetail);
      window.removeEventListener('open-trends', openTrends);
    };
  }, []);
  const [refreshKey, setRefreshKey] = useState(0);
  // What the player runs (play-style.js): { uses: { subs, retainers }, hidden: [view keys] }.
  const [playStyle, setPlayStyle] = useState({ style: 'both', uses: { subs: true, retainers: true }, hidden: [] });
  useEffect(() => {
    window.api.getPlayStyle().then((r) => { if (r && r.uses) setPlayStyle(r); }).catch(() => {});
  }, [refreshKey]);
  // A tab left out (after the choice changed) goes back to the Summary.
  useEffect(() => {
    if (playStyle.hidden.includes(currentView)) setCurrentView('summary');
  }, [playStyle, currentView]);
  // Roster columns for what the player does not run start hidden (they can still be added in Columns).
  const rosterDefs = React.useMemo(() => ROSTER_COLUMN_DEFS.map((d) => (
    (!playStyle.uses.subs && ROSTER_SUB_COLUMNS.includes(d.key)) || (!playStyle.uses.retainers && ROSTER_RETAINER_COLUMNS.includes(d.key))
      ? { ...d, default: false } : d
  )), [playStyle.uses.subs, playStyle.uses.retainers]);
  const rosterSort = useColumnSort();
  const rosterCols = useTableColumns({
    tableKey: 'roster',
    ownDefs: rosterDefs,
    subject: 'character',
    excludeExtras: ROSTER_DUPLICATE_EXTRAS,
    rows,
    idOf: (r) => r.cid,
    refreshKey
  });
  const rosterRows = rosterCols.rows;

  const fetchRoster = React.useCallback(async () => {
    const result = await window.api.getRoster();
    if (result.success) {
      setRows(sortRows(result.rows));
      setError(null);
    } else {
      setError(result.error);
    }
  }, []);

  useEffect(() => {
    fetchRoster();
  }, [fetchRoster, refreshKey]);

  // Auto-refresh: triggers the same refresh the Refresh button does (bumps refreshKey, which every view
  // watches) every few minutes (Settings → Auto-Refresh). The interval is read again each time Settings
  // closes, so a new one applies straight away; while Settings is open, it waits.
  useEffect(() => {
    if (showSettings) return undefined;
    let intervalId;
    let stopped = false;
    window.api.getAutoRefreshInterval().then((result) => {
      if (stopped) return;
      const minutes = result.minutes || 5;
      intervalId = setInterval(() => {
        setRefreshKey((k) => k + 1);
      }, minutes * 60 * 1000);
    });
    return () => { stopped = true; clearInterval(intervalId); };
  }, [showSettings]);

  useEffect(() => window.api.onOpenSettings(() => setShowSettings(true)), []);

  const connection = useConnectionStatus(() => setRefreshKey((k) => k + 1));

  // Removes a character (see RemoveCharacterCell) and reloads every view.
  async function handleRemoveCharacter(row) {
    const result = await window.api.removeCharacter(String(row.cid));
    setSaveStatus(result.success ? `Removed ${row.name}.` : `Failed to remove ${row.name}: ${result.error}`);
    if (result.success) setRefreshKey((k) => k + 1);
    return result.success;
  }

  // Called after any drag-reorder, in either mode. Takes the new CID order
  // for whichever list was just reordered, merges it back into the full
  // row set (other rows keep their existing relative order), reassigns
  // sort_index sequentially across the WHOLE roster so the saved order is
  // consistent regardless of which sub-list was dragged, then persists it.
  async function handleReorder(newOrderCidsForThisList) {
    if (!rows) return;

    const reorderedSet = new Set(newOrderCidsForThisList);
    const untouched = rows.filter((r) => !reorderedSet.has(r.cid));
    const reordered = newOrderCidsForThisList.map((cid) =>
      rows.find((r) => r.cid === cid)
    );

    // Rebuild the full list: any untouched rows keep their position,
    // reordered rows are spliced back in at the same relative location
    // they occupied before, now in their new order.
    let reorderedIndex = 0;
    const merged = rows.map((r) =>
      reorderedSet.has(r.cid) ? reordered[reorderedIndex++] : r
    );

    setRows(merged);

    const fullOrderCids = merged.map((r) => r.cid);
    setSaveStatus('Saving...');
    const result = await window.api.updateSortOrder(fullOrderCids);
    setSaveStatus(result.success ? 'Saved.' : `Failed to save: ${result.error}`);
  }

  const activeViewLabel = VIEWS.find((v) => v.key === currentView)?.label || '';

  return (
    <div className="app-shell">
      <SidebarNav currentView={currentView} onSelect={setCurrentView} hidden={playStyle.hidden} />

      <div className="main-pane">
        <div className="header-row">
          <div>
            <h1>{activeViewLabel}</h1>
            {currentView === 'roster' && (
              <div className="subtitle">
                Each character's latest data from the plugin. Drag rows to reorder.
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <ConnectionDot status={connection} />
            <PluginDataStatus refreshKey={refreshKey} />
            <button
              onClick={() => setRefreshKey((k) => k + 1)}
              title="Reload what is on screen from the database. The plugin sends new data on its own schedule."
            >
              Refresh
            </button>
            <button className="gear-button" onClick={() => setShowSettings(true)} title="Settings">
              ⚙
            </button>
          </div>
        </div>

        <ConnectionBanner status={connection} />
        <UpdateBanner />
        <DatabaseBanner />

        {showSettings && (
          <SettingsModal
            initialTab={typeof showSettings === 'string' ? showSettings : null}
            // Settings can change what the views show (thresholds, the house warning): reload them.
            onClose={() => { setShowSettings(false); setRefreshKey((k) => k + 1); }}
          />
        )}

        {showSetup && (
          <SetupWizard
            firstRun
            // Skipped: straight to the connection details. Finished: reload everything.
            onClose={(changed) => {
              try { localStorage.setItem('setupSeen', '1'); } catch { /* not remembered */ }
              setShowSetup(false);
              if (changed) setRefreshKey((k) => k + 1); else setShowSettings('database');
            }}
          />
        )}

        {trendDetail && (
          <TrendDetailPanel kind={trendDetail.kind} id={trendDetail.id} name={trendDetail.name} refreshKey={refreshKey} onClose={() => setTrendDetail(null)} />
        )}

        {currentView === 'roster' && (
          <div>
            {!error && rows !== null && (
              <div className="controls">
                <label>
                  <input
                    type="checkbox"
                    checked={groupByAccountEnabled}
                    onChange={(e) => setGroupByAccountEnabled(e.target.checked)}
                  />
                  {' '}Group by account
                </label>
                {rosterSort.sortColumn && (
                  <button
                    style={{ marginLeft: '16px' }}
                    onClick={() => rosterSort.resetSort(setGroupByAccountEnabled)}
                  >
                    Reset Sorting
                  </button>
                )}
                <span style={{ marginLeft: '16px' }}><ColumnPicker cols={rosterCols} /></span>
                {saveStatus && <span style={{ marginLeft: '16px', color: '#8a8f9a' }}>{saveStatus}</span>}
              </div>
            )}

            {!error && rows !== null && (
              <TrendCard title="Gil, whole fleet" metricKey="gil" collapsible storageKey="trendCard:rosterGil" refreshKey={refreshKey} />
            )}

            {error && <div className="error">Failed to load: {error}</div>}

            {!error && rows === null && (
              <div className="status">Loading...</div>
            )}

            {!error && rows !== null && rows.length === 0 && (
              <div className="status">No rows found.</div>
            )}

            {!error && rows !== null && rows.length > 0 && groupByAccountEnabled &&
              groupByAccount(rosterRows).map((group) => (
                <div key={group.label} className="account-group">
                  <h2>{group.label} <span className="count">({group.rows.length})</span></h2>
                  <RosterTable
                    rows={group.rows}
                    onReorder={handleReorder}
                    onRemove={handleRemoveCharacter}
                    cols={rosterCols}
                    sortColumn={rosterSort.sortColumn}
                    sortDirection={rosterSort.sortDirection}
                    onSortClick={(col) => rosterSort.handleSortClick(col, groupByAccountEnabled, setGroupByAccountEnabled)}
                  />
                </div>
              ))}

            {!error && rows !== null && rows.length > 0 && !groupByAccountEnabled && (
              <RosterTable
                rows={applyColumnSort(rosterRows, rosterSort.sortColumn, rosterSort.sortDirection, rosterCols.accessors)}
                onReorder={handleReorder}
                onRemove={handleRemoveCharacter}
                cols={rosterCols}
                sortColumn={rosterSort.sortColumn}
                sortDirection={rosterSort.sortDirection}
                onSortClick={(col) => rosterSort.handleSortClick(col, groupByAccountEnabled, setGroupByAccountEnabled)}
              />
            )}
          </div>
        )}

        {currentView === 'subs' && <SubmarinesView refreshKey={refreshKey} />}

        {currentView === 'parts' && <PartsView refreshKey={refreshKey} />}

        {currentView === 'salvage' && <SalvageView refreshKey={refreshKey} />}

        {currentView === 'routeOpt' && <RouteOptimizationView refreshKey={refreshKey} />}

        {currentView === 'summary' && <SummaryView uses={playStyle.uses} onNavigate={setCurrentView} onOpenTrend={(metric) => { setTrendsPreset({ metric, at: Date.now() }); setCurrentView('trends'); }} refreshKey={refreshKey} onOpenSettings={() => setShowSettings('general')} />}

        {currentView === 'inventory' && <InventoryView />}

        {currentView === 'retainers' && <RetainersView refreshKey={refreshKey} />}

        {currentView === 'fcDirectory' && <FCDirectoryView refreshKey={refreshKey} />}

        {currentView === 'trends' && <TrendsView refreshKey={refreshKey} preset={trendsPreset} />}

        {currentView === 'supplies' && <SuppliesView refreshKey={refreshKey} />}

        {currentView === 'income' && <IncomeView refreshKey={refreshKey} uses={playStyle.uses} />}

        {currentView === 'market' && <MarketView refreshKey={refreshKey} uses={playStyle.uses} />}

        {currentView === 'pcs' && <PcsView refreshKey={refreshKey} />}

        {currentView !== 'roster' && currentView !== 'subs' && currentView !== 'parts' && currentView !== 'salvage' && currentView !== 'routeOpt' && currentView !== 'summary' && currentView !== 'inventory' && currentView !== 'retainers' && currentView !== 'fcDirectory' && currentView !== 'trends' && currentView !== 'supplies' && currentView !== 'income' && currentView !== 'market' && currentView !== 'pcs' && (
          <ComingSoonView label={activeViewLabel} />
        )}
      </div>
      <TableExportMenu />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
