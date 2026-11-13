// The app window: the sidebar, the header's plugin data note, and the tab that is showing.

// Central list of every view in the sidebar - one place to add a new
// view later rather than touching multiple spots. `built: false` views
// render the ComingSoonView placeholder instead of real content.
// The pages, in sidebar order, by group (the same groups as the plugin's sidebar).
// helper: also shown in the Database Helper (this PC shows only the database tools); helperOnly: only there.
const VIEWS = [
  { key: 'helper', label: 'Home', title: 'Database Helper', group: 'Database Helper', built: true, helper: true, helperOnly: true },
  { key: 'summary', label: 'Summary', group: 'Overview', built: true },
  { key: 'trends', label: 'Trends', group: 'Overview', built: true },
  { key: 'subs', label: 'Subs', group: 'Submarines', built: true },
  { key: 'routeOpt', label: 'Route Optimization', group: 'Submarines', built: true },
  { key: 'parts', label: 'Parts', group: 'Submarines', built: true },
  { key: 'supplies', label: 'Supplies', group: 'Submarines', built: true },
  { key: 'salvage', label: 'Salvage', group: 'Submarines', built: true },
  { key: 'roster', label: 'Character Roster', group: 'Characters', built: true },
  { key: 'retainers', label: 'Retainers', group: 'Characters', built: true },
  { key: 'fcDirectory', label: 'Free Companies', group: 'Characters', built: true },
  { key: 'inventory', label: 'Inventory', group: 'Characters', built: true },
  { key: 'income', label: 'Income', group: 'Gil', built: true },
  { key: 'market', label: 'Gil & Market', group: 'Gil', built: true },
  { key: 'pcs', label: 'PCs', group: 'System', built: true, helper: true },
];

// hidden: the views left out for what the player does not run (Settings → What do you run?).
function SidebarNav({ currentView, onSelect, hidden = [] }) {
  return (
    <div className="sidebar">
      {[...new Set(VIEWS.map((v) => v.group))].map((group) => {
        const views = VIEWS.filter((v) => v.group === group && !hidden.includes(v.key));
        if (views.length === 0) return null;
        return (
          <div className="sidebar-group" key={group}>
            <div className="sidebar-group-title">{group}</div>
            {views.map((v) => (
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
      })}
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

  if (status.online && status.file) {
    return <span className="save-status connection-dot" title="This PC keeps its fleet in the plugin's file (Settings > Database).">Fleet file</span>;
  }
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
      <button className="update-whats-new" onClick={() => window.api.openReleaseNotes(ready.version)}>What's new</button>
      {' '}It is also installed the next time you close the app.
    </div>
  );
}

// The changelog's versions (shared/changelog.js): each version's date and its notes, bold and code kept, as text.
function ChangelogParts({ parts }) {
  return parts.map((p, i) => (p.bold ? <strong key={i}>{p.text}</strong> : p.code ? <code key={i}>{p.text}</code> : <React.Fragment key={i}>{p.text}</React.Fragment>));
}
function ChangelogVersions({ versions }) {
  return versions.map((v) => {
    const groups = [];
    for (const b of v.blocks) {
      if (b.type === 'li') {
        const last = groups[groups.length - 1];
        if (b.sub && last && last.type === 'ul' && last.items.length) last.items[last.items.length - 1].subs.push(b);
        else if (last && last.type === 'ul') last.items.push({ ...b, subs: [] });
        else groups.push({ type: 'ul', items: [{ ...b, subs: [] }] });
      } else groups.push(b);
    }
    return (
      <div key={v.version} className="changelog-version">
        <h4>Version {v.version}{v.date && /^\d{4}-\d{2}-\d{2}$/.test(v.date) ? <span className="changelog-date"> · {v.date}</span> : null}</h4>
        {groups.map((g, i) => (g.type === 'ul' ? (
          <ul key={i}>
            {g.items.map((item, j) => (
              <li key={j}>
                <ChangelogParts parts={item.parts} />
                {item.subs.length > 0 && <ul>{item.subs.map((sub, k) => <li key={k}><ChangelogParts parts={sub.parts} /></li>)}</ul>}
              </li>
            ))}
          </ul>
        ) : <p key={i}><ChangelogParts parts={g.parts} /></p>))}
      </div>
    );
  });
}

// Shown once after the app has updated (ipc/updates.js): what changed in each version since this PC last ran
// one, until "Got it". A new install shows nothing.
function WhatsNewBox() {
  const [news, setNews] = useState(null);
  useEffect(() => { window.api.getWhatsNew().then((r) => setNews(r && r.versions.length ? r : null)); }, []);
  if (!news) return null;
  const dismiss = () => { window.api.markWhatsNewSeen(); setNews(null); };
  const several = news.versions.length > 1;
  return (
    <div className="update-banner whats-new" role="status">
      <div className="whats-new-head">
        <strong>Updated to version {news.current}.</strong>
        {' '}{several ? `What's new in the ${news.versions.length} versions since you last opened the app:` : "What's new:"}
        <button className="whats-new-done" onClick={dismiss}>Got it</button>
      </div>
      <div className="whats-new-list"><ChangelogVersions versions={news.versions} /></div>
    </div>
  );
}

// "New game data is available" (db/game-data-notice.js): asked when the window opens and every hour (GitHub itself
// at most once a day). Update now runs the same check and update as Settings > Data > Game Data, backing up the old
// game data first; Later hides it on this PC until something newer changes.
const GAME_DATA_NOTICE_EVERY_MS = 60 * 60 * 1000;

function GameDataBanner() {
  const [notice, setNotice] = useState(null);
  const [phase, setPhase] = useState('idle'); // idle | checking | updating | done
  const [message, setMessage] = useState('');
  const load = () => window.api.getGameDataNotice().then((r) => setNotice(r && r.success && r.available ? r : null)).catch(() => {});
  useEffect(() => {
    load();
    const timer = setInterval(load, GAME_DATA_NOTICE_EVERY_MS);
    return () => clearInterval(timer);
  }, []);

  const finish = (text) => { setMessage(text); setPhase('done'); load(); };
  const plain = (tables) => tables.map((t) => t.table.replace(/^ffxiv_/, '')).join(', ');
  async function update() {
    setPhase('checking');
    const checked = await window.api.checkGameData();
    if (!checked.success) return finish(`The game data couldn't be checked: ${checked.error}`);
    const changed = checked.tables.filter((t) => t.status === 'ok');
    const blocked = checked.tables.filter((t) => t.status === 'blocked');
    if (!changed.length) {
      return finish(blocked.length
        ? `The game data couldn't be downloaded (${blocked[0].reason}). Try again later, or from Settings > Data > Game Data.`
        : 'The game data is already up to date.');
    }
    setPhase('updating');
    const applied = await window.api.applyGameData({ backupFirst: true });
    if (!applied.success) return finish(`The game data couldn't be updated: ${applied.error}`);
    const updated = applied.results.filter((r) => r.status === 'updated');
    const failed = applied.results.filter((r) => r.status === 'failed').concat(blocked);
    finish(`Game data updated (${updated.length} table${updated.length === 1 ? '' : 's'})${failed.length ? `, except ${plain(failed)}` : ''}.`
      + ' The old game data was backed up first; Settings > Data > Game Data can put it back.');
  }
  const later = () => { window.api.gameDataNoticeLater(notice.newest); setNotice(null); };

  if (phase === 'done') {
    return (
      <div className="update-banner game-data-banner" role="status">
        {message} <button onClick={() => { setPhase('idle'); setMessage(''); }}>Close</button>
      </div>
    );
  }
  if (phase === 'checking' || phase === 'updating') {
    return (
      <div className="update-banner game-data-banner" role="status">
        {phase === 'checking' ? 'Downloading the new game data to see what changed...' : 'Updating the game data...'} This takes a minute or two.
      </div>
    );
  }
  if (!notice) return null;
  return (
    <div className="update-banner game-data-banner" role="status">
      New game data is available (it changed on {new Date(notice.newest).toLocaleDateString()}, usually after a game patch).{' '}
      <button onClick={update}>Update now</button>
      <button onClick={later}>Later</button>
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
  const [ownerSkips, setOwnerSkips] = useState([]);
  const [error, setError] = useState(null);
  const [groupByAccountEnabled, setGroupByAccountEnabled] = useState(true);
  const [saveStatus, setSaveStatus] = useState('');
  // false, or which Settings tab to open on (true: the last one used).
  const [showSettings, setShowSettings] = useState(false);
  const [currentView, setCurrentView] = useState('summary');
  // What this PC shows (shared/app-mode.js): 'fleet' (the full app) or 'tools' (the Database Helper). Nothing is
  // drawn until it's known, so a Database Helper PC never starts loading the fleet's tabs.
  const [appMode, setAppMode] = useState(null);
  useEffect(() => {
    const apply = (mode) => {
      setAppMode(mode);
      setCurrentView(mode === 'tools' ? 'helper' : 'summary');
    };
    window.api.getAppMode().then(apply).catch(() => apply('fleet'));
    return window.api.onAppModeChanged(apply);
  }, []);
  const helperMode = appMode === 'tools';
  // A new look (Settings → General → Look) redraws the page, so charts pick up its colours too.
  const [lookKey, setLookKey] = useState(0);
  useEffect(() => {
    const changed = () => setLookKey((k) => k + 1);
    window.addEventListener('look-changed', changed);
    return () => window.removeEventListener('look-changed', changed);
  }, []);
  // The setup screen opens by itself the first time, while no connection is saved, until it has been finished
  // or skipped once on this PC (a PC that only plays never saves a connection here).
  const [showSetup, setShowSetup] = useState(false);
  useEffect(() => {
    let seen = false;
    try { seen = localStorage.getItem('setupSeen') === '1'; } catch { /* not remembered */ }
    if (seen) return;
    // (Nor when this PC keeps its fleet in the plugin's file: there is nothing to set up.)
    window.api.getFleetLocation().then((where) => {
      if (where && where.success && where.location === 'file') return;
      return window.api.getPostgresConfig().then((c) => { if (!c || !c.host) setShowSetup(true); });
    }).catch(() => {});
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
  // The views left out: everything but the database tools in the Database Helper; otherwise the Helper's own home
  // page and what the player doesn't run.
  const hiddenViews = React.useMemo(() => (helperMode
    ? VIEWS.filter((v) => !v.helper).map((v) => v.key)
    : [...playStyle.hidden, ...VIEWS.filter((v) => v.helperOnly).map((v) => v.key)]), [helperMode, playStyle]);
  // A tab left out (after the choice changed) goes back to the first page.
  useEffect(() => {
    if (appMode && hiddenViews.includes(currentView)) setCurrentView(helperMode ? 'helper' : 'summary');
  }, [appMode, helperMode, hiddenViews, currentView]);
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
      setOwnerSkips(result.ownerSkips || []);
      setError(null);
    } else {
      setError(result.error);
    }
  }, []);

  useEffect(() => {
    if (appMode === 'fleet') fetchRoster();
  }, [fetchRoster, refreshKey, appMode]);

  // Auto-refresh: triggers the same refresh the Refresh button does (bumps refreshKey, which every view
  // watches) every few minutes (Settings → Auto-Refresh). The interval is read again each time Settings
  // closes, so a new one applies straight away; while Settings is open, it waits.
  useEffect(() => {
    if (showSettings) return undefined;
    let intervalId;
    let stopped = false;
    // If the setting can't be read, it refreshes at the usual 5 minutes rather than not at all.
    window.api.getAutoRefreshInterval().catch(() => ({})).then((result) => {
      if (stopped) return;
      const minutes = (result && result.minutes) || 5;
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

  const activeView = VIEWS.find((v) => v.key === currentView);
  const activeViewLabel = activeView ? activeView.title || activeView.label : '';

  if (!appMode) return <div className="app-shell"><div className="main-pane"><div className="status">Loading...</div></div></div>;

  return (
    <div className="app-shell">
      <SidebarNav currentView={currentView} onSelect={setCurrentView} hidden={hiddenViews} />

      <div className="main-pane" key={lookKey}>
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
        <WhatsNewBox />
        <GameDataBanner />
        <DatabaseBanner />

        {showSettings && (
          <SettingsModal
            initialTab={typeof showSettings === 'string' ? showSettings : null}
            appMode={appMode}
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
                {saveStatus && <span style={{ marginLeft: '16px', color: 'var(--dim)' }}>{saveStatus}</span>}
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

            {!error && rows !== null && <NoLabelNote characters={rows.filter((r) => !r.account_label).length} />}
            {!error && rows !== null && <NotSyncedAnywhereNote characters={ownerSkips} />}

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

        {currentView === 'helper' && <HelperView refreshKey={refreshKey} onOpenSettings={(tab) => setShowSettings(tab)} onNavigate={setCurrentView} />}

        {currentView !== 'roster' && currentView !== 'subs' && currentView !== 'parts' && currentView !== 'salvage' && currentView !== 'routeOpt' && currentView !== 'summary' && currentView !== 'inventory' && currentView !== 'retainers' && currentView !== 'fcDirectory' && currentView !== 'trends' && currentView !== 'supplies' && currentView !== 'income' && currentView !== 'market' && currentView !== 'pcs' && currentView !== 'helper' && (
          <ComingSoonView label={activeViewLabel} />
        )}
      </div>
      <TableExportMenu />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
