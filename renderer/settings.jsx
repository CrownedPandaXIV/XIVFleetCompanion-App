// Settings window: Postgres connection, refresh and warning settings, game data update, Fight Club import.

// One row of the Fight Club import preview. Flagged rows (issues.length > 0)
// default UNCHECKED - the safer default, since these are exactly the "stray
// comment in a numeric-looking column" cases a machine can't judge on its
// own (row 34's joke note being the real example that prompted this).
// Clean rows default CHECKED so a normal import doesn't require clicking
// through 30+ boxes just to include obviously-good data.
function FightClubImportModal({ onClose }) {
  const [stage, setStage] = useState('loading'); // loading | error | preview | importing | done
  const [parseResult, setParseResult] = useState(null);
  const [checkedRows, setCheckedRows] = useState({});
  const [patchLabel, setPatchLabel] = useState('');
  const [commitResult, setCommitResult] = useState(null);

  useEffect(() => {
    window.api.pickFightClubCsv().then((result) => {
      if (result.canceled) {
        onClose();
        return;
      }
      if (!result.success) {
        setParseResult(result);
        setStage('error');
        return;
      }
      const initialChecked = {};
      for (const row of result.rows) {
        initialChecked[row.rowNumber] = !row.hasIssue;
      }
      setCheckedRows(initialChecked);
      setParseResult(result);
      setStage('preview');
    });
  }, []);

  function toggleRow(rowNumber) {
    setCheckedRows((prev) => ({ ...prev, [rowNumber]: !prev[rowNumber] }));
  }

  async function handleConfirm() {
    setStage('importing');
    const rowsToImport = parseResult.rows.filter((r) => checkedRows[r.rowNumber]);
    const result = await window.api.commitFightClubImport({
      rows: rowsToImport,
      patchLabel: patchLabel.trim()
    });
    setCommitResult(result);
    setStage('done');
  }

  const checkedCount = parseResult
    ? parseResult.rows.filter((r) => checkedRows[r.rowNumber]).length
    : 0;

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h2>Import Fight Club Data</h2>

        {stage === 'loading' && <div className="status">Reading file...</div>}

        {stage === 'error' && (
          <div>
            <div className="error">
              {parseResult.error}
              {parseResult.actualHeaders && (
                <div style={{ marginTop: '8px', fontSize: '0.9em' }}>
                  Columns found in file: {parseResult.actualHeaders.join(', ') || '(none)'}
                </div>
              )}
            </div>
            <button onClick={onClose}>Close</button>
          </div>
        )}

        {stage === 'preview' && (
          <div>
            {parseResult.missingOptional.length > 0 && (
              <div className="warning">
                Note: this file has no column for {parseResult.missingOptional.join(', ')}.
                Those fields will be left blank for every row.
              </div>
            )}

            <div style={{ margin: '12px 0' }}>
              <label>
                Patch label (optional):{' '}
                <input
                  type="text"
                  value={patchLabel}
                  onChange={(e) => setPatchLabel(e.target.value)}
                  placeholder="e.g. Patch 7.5"
                />
              </label>
            </div>

            <div className="status">
              {checkedCount} of {parseResult.rows.length} rows will be imported.
              This replaces all existing Fight Club data.
            </div>

            <table className="preview-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Row</th>
                  <th>Route</th>
                  <th>Rec Build</th>
                  <th>Gil/Hr</th>
                  <th>Issues</th>
                </tr>
              </thead>
              <tbody>
                {parseResult.rows.map((row) => (
                  <tr key={row.rowNumber} className={row.hasIssue ? 'flagged-row' : ''}>
                    <td>
                      <input
                        type="checkbox"
                        checked={!!checkedRows[row.rowNumber]}
                        onChange={() => toggleRow(row.rowNumber)}
                      />
                    </td>
                    <td>{row.rowNumber}</td>
                    <td>{row.data.route || '(blank)'}</td>
                    <td>{row.data.rec_build_notes || '—'}</td>
                    <td>{row.data.gil_hr ?? '—'}</td>
                    <td>{row.issues.join('; ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="modal-actions">
              <button onClick={onClose}>Cancel</button>
              <button onClick={handleConfirm} disabled={checkedCount === 0}>
                Import {checkedCount} Route{checkedCount === 1 ? '' : 's'}
              </button>
            </div>
          </div>
        )}

        {stage === 'importing' && <div className="status">Importing...</div>}

        {stage === 'done' && (
          <div>
            {commitResult.success ? (
              <div className="status">
                Success — imported {commitResult.imported} routes.
              </div>
            ) : (
              <div className="error">Import failed: {commitResult.error}</div>
            )}
            <button onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
}

// Settings section: refresh the ffxiv_* reference tables (items, recipes, retainer tasks...) from
// the ffxiv-datamining repository. "Check" only compares; nothing changes until "Apply update",
// which first offers to back the tables up. Backups can be restored from the list below.
function GameDataSection() {
  const [last, setLast] = useState(null);
  const [phase, setPhase] = useState('idle'); // idle | checking | checked | applying | done
  const [check, setCheck] = useState(null);
  const [results, setResults] = useState(null);
  const [backupName, setBackupName] = useState(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState('');

  const [showBackups, setShowBackups] = useState(false);
  const [backups, setBackups] = useState(null);
  const [keep, setKeep] = useState(8);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(null); // backup name awaiting confirmation
  const [backupMessage, setBackupMessage] = useState('');

  function loadLast() {
    window.api.getGameDataStatus().then((r) => setLast(r.success ? r.last : null));
  }
  useEffect(loadLast, []);

  async function loadBackups() {
    const r = await window.api.listGameDataBackups();
    if (r.success) { setBackups(r.backups); setKeep(r.keep); }
    else setBackupMessage(`Could not load backups: ${r.error}`);
  }
  useEffect(() => { if (showBackups) loadBackups(); }, [showBackups]);

  async function runCheck() {
    setPhase('checking'); setError(''); setResults(null); setAsking(false);
    const r = await window.api.checkGameData();
    if (!r.success) { setError(r.error); setPhase('idle'); return; }
    setCheck(r); setPhase('checked');
  }

  async function runApply(backupFirst) {
    setAsking(false); setPhase('applying'); setError('');
    const r = await window.api.applyGameData({ backupFirst });
    if (!r.success) { setError(r.error); setPhase('checked'); return; }
    setResults(r.results); setBackupName(r.backupName || null); setPhase('done'); loadLast();
    if (showBackups) loadBackups();
  }

  async function makeBackup() {
    setBusy(true); setBackupMessage('Backing up...');
    const r = await window.api.createGameDataBackup();
    setBusy(false);
    setBackupMessage(r.success ? 'Backup made.' : `Backup failed: ${r.error}`);
    loadBackups();
  }

  async function restore(name) {
    setBusy(true); setRestoring(null); setBackupMessage('Restoring...');
    const r = await window.api.restoreGameDataBackup(name);
    setBusy(false);
    if (!r.success) { setBackupMessage(`Restore failed: ${r.error}`); return; }
    const failed = r.results.filter((x) => x.status === 'failed');
    setBackupMessage(
      failed.length
        ? `Restored, except: ${failed.map((x) => `${x.table.replace(/^ffxiv_/, '')} (${x.reason})`).join('; ')}. The state before the restore was saved as a backup.`
        : `Restored ${r.results.length} tables. The state before the restore was saved as a backup, in case you want to undo.`
    );
    setCheck(null); setPhase('idle');
    loadBackups();
  }

  async function remove(name) {
    setBusy(true);
    const r = await window.api.deleteGameDataBackup(name);
    setBusy(false);
    if (!r.success) setBackupMessage(`Delete failed: ${r.error}`);
    loadBackups();
  }

  const tableName = (t) => t.replace(/^ffxiv_/, '');
  const changed = check ? check.tables.filter((t) => t.status === 'ok') : [];
  const blocked = check ? check.tables.filter((t) => t.status === 'blocked') : [];
  const unchanged = check ? check.tables.filter((t) => t.status === 'unchanged') : [];
  const problem = { color: '#e57373' };
  const formatWhen = (iso) => new Date(iso).toLocaleString();
  const formatSize = (bytes) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  const totalRows = (b) => b.tables.reduce((n, t) => n + t.rows, 0);

  return (
    <section className="settings-section">
      <h3>Game Data</h3>
      <div className="status" style={{ marginBottom: 8 }}>
        Item, recipe, retainer task and other game tables, from the ffxiv-datamining repository on GitHub.
        {last
          ? ` Last updated ${formatWhen(last.appliedAt)}${last.source && last.source.sha ? ` (source ${last.source.sha})` : ''}.`
          : ' No update has been made from here yet.'}
      </div>
      <button onClick={runCheck} disabled={phase === 'checking' || phase === 'applying' || busy}>
        {phase === 'checking' ? 'Checking...' : 'Check for updates'}
      </button>
      {error && <div className="status" style={problem}>{error}</div>}

      {(phase === 'checked' || phase === 'applying') && check && (
        <div className="game-data-report">
          {check.version && (
            <div className="status">Newest source: {check.version.sha}, {new Date(check.version.date).toLocaleDateString()} ({check.version.message})</div>
          )}
          {changed.length === 0 && blocked.length === 0 && (
            <div className="status">Everything is up to date ({unchanged.length} tables checked).</div>
          )}
          {changed.length > 0 && (
            <div>
              <div className="status">Will be updated:</div>
              <ul>
                {changed.map((t) => (
                  <li key={t.table}>
                    {tableName(t.table)}: {t.rowsBefore.toLocaleString()} → {t.rowsAfter.toLocaleString()} rows
                    {t.renamed && t.renamed.length > 0 && `, columns renamed: ${t.renamed.map((r) => `${r.from} → ${r.to}`).join(', ')}`}
                    {t.added.length > 0 && `, new columns: ${t.added.join(', ')}`}
                    {t.kept.length > 0 && `, no longer in the file (kept): ${t.kept.join(', ')}`}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {blocked.length > 0 && (
            <div>
              <div className="status" style={problem}>Will NOT be changed:</div>
              <ul>
                {blocked.map((t) => <li key={t.table} style={problem}>{tableName(t.table)}: {t.reason}</li>)}
              </ul>
            </div>
          )}
          {unchanged.length > 0 && changed.length + blocked.length > 0 && (
            <div className="status">Already up to date: {unchanged.map((t) => tableName(t.table)).join(', ')}.</div>
          )}
          {changed.length > 0 && phase === 'checked' && !asking && (
            <div>
              <div className="status">Each table is replaced in one step: if anything goes wrong, that table is left as it was.</div>
              <button onClick={() => setAsking(true)}>Apply update</button>
            </div>
          )}
          {asking && phase === 'checked' && (
            <div className="game-data-ask">
              <div className="status">Make a backup of the game tables before updating? (Recommended: it lets you undo the update from the Backups list below.)</div>
              <button onClick={() => runApply(true)}>Back up, then update</button>{' '}
              <button onClick={() => runApply(false)}>Update without a backup</button>{' '}
              <button onClick={() => setAsking(false)}>Cancel</button>
            </div>
          )}
        </div>
      )}

      {phase === 'applying' && <div className="status">Updating... this can take a minute.</div>}

      {phase === 'done' && results && (
        <div className="game-data-report">
          {backupName && <div className="status">A backup was made first (see Backups below).</div>}
          <ul>
            {results.filter((r) => r.status !== 'unchanged').map((r) => (
              <li key={r.table} style={r.status === 'updated' ? undefined : problem}>
                {tableName(r.table)}:{' '}
                {r.status === 'updated' && `updated, ${r.rowsAfter.toLocaleString()} rows`}
                {r.status === 'failed' && `failed and left as it was (${r.reason})`}
                {r.status === 'blocked' && `not changed (${r.reason})`}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <button onClick={() => setShowBackups(!showBackups)}>{showBackups ? 'Hide backups' : 'Backups...'}</button>
      </div>
      {showBackups && (
        <div className="game-data-backups">
          <div className="status">
            Copies of the game tables, kept inside the database (the newest {keep}). Restoring puts the game tables back
            the way they were then; the current state is saved as a new backup first, so a restore can be undone.
            Your nightly backup still covers everything else.
          </div>
          <button onClick={makeBackup} disabled={busy}>Back up now</button>
          {backupMessage && <div className="status">{backupMessage}</div>}
          {backups && backups.length === 0 && <div className="status">No backups yet.</div>}
          {backups && backups.length > 0 && (
            <ul>
              {backups.map((b) => (
                <li key={b.name}>
                  {formatWhen(b.createdAt)}{b.label ? `, ${b.label}` : ''}: {b.tables.length} tables, {totalRows(b).toLocaleString()} rows, {formatSize(b.bytes)}{' '}
                  {restoring === b.name ? (
                    <span>
                      Restore this backup?{' '}
                      <button onClick={() => restore(b.name)} disabled={busy}>Yes, restore</button>{' '}
                      <button onClick={() => setRestoring(null)}>Cancel</button>
                    </span>
                  ) : (
                    <span>
                      <button onClick={() => setRestoring(b.name)} disabled={busy}>Restore</button>{' '}
                      <button onClick={() => remove(b.name)} disabled={busy}>Delete</button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

// Single scrolling Settings screen: Auto-Refresh, Postgres Connection,
// and Fight Club Import, stacked top to bottom. Each section manages
// its own load/save state independently, so a failure or slow load in
// one section doesn't block the others from working.
// The Settings window's tabs, in order. The last one used is remembered (on this PC).
// Settings → General → Updates (updater.js): this app's version, what the update check is doing, and looking now.
// The installed app also looks by itself when it starts and every hour.
function UpdatesSection() {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    window.api.getUpdateStatus().then(setInfo);
    return window.api.onUpdateStatus((status) => setInfo((i) => ({ ...(i || {}), status })));
  }, []);
  if (!info) return <section className="settings-section updates-section"><h3>Updates</h3><div className="status">Loading...</div></section>;
  const { status } = info;
  const busy = ['checking', 'downloading', 'ready'].includes(status.state);
  return (
    <section className="settings-section updates-section">
      <h3>Updates</h3>
      <div className="settings-row">
        <span>This is version {info.version}.</span>
        {!status.source && <button className="updates-check" onClick={() => window.api.checkForUpdates().then(setInfo)} disabled={busy}>Check for updates</button>}
        <span className={`save-status updates-status${status.state === 'error' ? ' supply-warn' : ''}`}>{status.text}</span>
      </div>
      {!status.source && <div className="alerts-help">The app also looks by itself when it starts and every hour, and downloads a new version in the background.</div>}
    </section>
  );
}

const SETTINGS_TABS = [
  { key: 'general', label: 'General' },
  { key: 'database', label: 'Database' },
  { key: 'backups', label: 'Backups' },
  { key: 'alerts', label: 'Discord Alerts' },
  { key: 'data', label: 'Data' },
  { key: 'setup', label: 'Setup Help' },
];
const SETTINGS_TAB_KEY = 'settingsTab';

// What the player runs (play-style.js): tabs, Summary sections and alerts for what is not run are left out.
const PLAY_STYLE_CHOICES = [
  ['auto', 'Work it out from my characters'],
  ['both', 'Subs and retainers'],
  ['subs', 'Subs only'],
  ['retainers', 'Retainers only'],
];
const PLAY_STYLE_NAMES = { both: 'subs and retainers', subs: 'subs only', retainers: 'retainers only' };

function PlayStyleSection() {
  const [data, setData] = useState(null);
  const [choice, setChoice] = useState('auto');
  const [status, setStatus] = useState('');

  useEffect(() => {
    window.api.getPlayStyle().then((r) => { setData(r); setChoice(r.choice || 'auto'); });
  }, []);

  async function save() {
    setStatus('Saving...');
    const r = await window.api.savePlayStyle(choice);
    if (!r.success) { setStatus(`Failed to save: ${r.error}`); return; }
    const now = await window.api.getPlayStyle();
    setData(now);
    setStatus('Saved. The tabs change when Settings is closed.');
  }

  return (
    <section className="settings-section play-style">
      <h3>What do you run?</h3>
      {!data && <div className="status">Loading...</div>}
      {data && (
        <div>
          <div className="settings-row">
            <select value={choice} onChange={(e) => setChoice(e.target.value)}>
              {PLAY_STYLE_CHOICES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <button onClick={save}>Save</button>
            {status && <span className="save-status">{status}</span>}
          </div>
          <div className="alerts-help">
            {data.counts && `Your characters have ${data.counts.subs} sub${data.counts.subs === 1 ? '' : 's'} built and ${data.counts.retainers} retainer${data.counts.retainers === 1 ? '' : 's'} with a class. `}
            Showing: <strong className="play-style-now">{PLAY_STYLE_NAMES[data.style] || data.style}</strong>.
            {' '}Tabs, Summary sections and Discord alerts for what you do not run are left out. With subs only, the Retainers tab is left out;
            with retainers only, Salvage, Subs, Supplies, Parts and Route Optimization are.
          </div>
        </div>
      )}
    </section>
  );
}

// Live prices from Universalis (universalis.js), off until turned on here.
// Settings → General: thanks to the people whose plugins XIV Fleet Companion reads from (setup/help.js).
function CreditsSection() {
  const [plugins, setPlugins] = useState(null);
  useEffect(() => { window.api.getSetupDetails().then((d) => setPlugins(d.companionPlugins)); }, []);
  return (
    <section className="settings-section credits">
      <h3>Credits</h3>
      <p>XIV Fleet Companion couldn't work without these plugins. A big thank you to the people who make them:</p>
      {plugins && (
        <ul className="credits-list">
          {plugins.map((p) => <li key={p.name}><strong>{p.name}</strong> by {p.by}</li>)}
        </ul>
      )}
      <div className="alerts-help">How to install them: <strong>Setup Help → The plugin</strong>.</div>
    </section>
  );
}

function LivePricesSection() {
  const [enabled, setEnabled] = useState(null);
  const [status, setStatus] = useState('');
  useEffect(() => { window.api.getUniversalisSetting().then((r) => setEnabled(!!r.enabled)); }, []);

  async function change(next) {
    setEnabled(next);
    setStatus('Saving...');
    const r = await window.api.saveUniversalisSetting(next);
    setStatus(r.success ? 'Saved.' : `Failed to save: ${r.error}`);
  }

  return (
    <section className="settings-section live-prices">
      <h3>Live Market Prices</h3>
      {enabled === null && <div className="status">Loading...</div>}
      {enabled !== null && (
        <div>
          <div className="settings-row">
            <label>
              <input type="checkbox" checked={enabled} onChange={(e) => change(e.target.checked)} />
              {' '}Use live prices from Universalis
            </label>
            {status && <span className="save-status">{status}</span>}
          </div>
          <div className="alerts-help">
            Universalis (universalis.app) collects market board prices from players. With this on, the app asks it for the cheapest
            listing of each item on the character's home world, data center and region, and shows them next to the vendor prices: the
            market value of loot and venture rewards on the Income tab, and which of your listings someone sells cheaper on the
            Gil &amp; Market tab. Only item numbers and world names are sent. Prices are kept for 30 minutes. Items not sold on the market
            board (such as salvage) keep their vendor price.
          </div>
        </div>
      )}
    </section>
  );
}

// Settings → Database → Speed check: the database side is measured by the app (db/speed-check.js), then each
// tab's data is loaded here, one tab at a time, and timed as the tab itself would load it.
const SPEED_TABS = [
  { tab: 'Summary', load: () => Promise.all([window.api.getSubmarines(), window.api.getFleetWarnings(), window.api.getHouseWarnings(), window.api.getRetainerSummary(), window.api.getSalvage(), window.api.getPartsNeeded(), window.api.getLoot(), window.api.getMarket()]) },
  { tab: 'Character Roster', load: () => window.api.getRoster() },
  { tab: 'Free Companies', load: () => window.api.getFcDirectory() },
  { tab: 'Salvage', load: () => window.api.getSalvage() },
  { tab: 'Subs', load: () => window.api.getSubmarines() },
  { tab: 'Supplies', load: () => window.api.getSupplies() },
  { tab: 'Income', load: () => Promise.all([window.api.getIncome(), window.api.getLoot()]) },
  { tab: 'Parts', load: () => Promise.all([window.api.getPartsNeeded(), window.api.getSubBuildRules(), window.api.getRoster()]) },
  { tab: 'Inventory', load: () => Promise.all([window.api.getFleetInventorySummary(), window.api.getFcList(), window.api.getRoster()]) },
  { tab: 'Retainers', load: () => Promise.all([window.api.getRetainerTargets(), window.api.getRoster()]) },
  { tab: 'Gil & Market', load: () => window.api.getMarket() },
  { tab: 'Trends', load: () => Promise.all([window.api.getMetricCatalog(), window.api.getMetricSubjects()]) },
  { tab: 'PCs', load: () => window.api.getPcs() },
];

function SpeedCheckSection() {
  const [step, setStep] = useState(null);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);

  const run = async () => {
    setError(null);
    setResult(null);
    setCopied(false);
    setStep('Checking the connection and the database...');
    const db = await window.api.checkDatabaseSpeed();
    if (!db.success) {
      setStep(null);
      setError(db.error);
      return;
    }
    const tabs = [];
    for (const t of SPEED_TABS) {
      setStep(`Loading ${t.tab}...`);
      const start = performance.now();
      try {
        const answers = [].concat(await t.load());
        const failed = answers.find((a) => a && a.success === false);
        tabs.push(failed ? { tab: t.tab, error: failed.error || 'failed' } : { tab: t.tab, ms: Math.round(performance.now() - start) });
      } catch (err) {
        tabs.push({ tab: t.tab, error: err.message });
      }
    }
    setStep('Timing each database question behind Income and Summary...');
    const detail = await window.api.getSpeedDetail();
    const details = detail.success ? detail.details : [{ part: 'Income and Summary', error: detail.error }];
    const { findings, report } = await window.api.getSpeedFindings({ measured: db.measured, tabs, details });
    setResult({ findings, report, tabs, details });
    setStep(null);
  };

  const copy = async () => {
    await navigator.clipboard.writeText(result.report);
    setCopied(true);
  };

  return (
    <section className="settings-section speed-check">
      <h3>Speed Check</h3>
      <p>If tabs are slow to load, this finds out why: how long reaching the database takes, how the app finds your
        characters, what else the database is busy with, and how long each tab takes. It only reads, and takes up to
        a minute.</p>
      <div className="settings-row">
        <button onClick={run} disabled={!!step}>{step ? 'Checking...' : 'Run speed check'}</button>
        {result && <button onClick={copy}>{copied ? 'Copied' : 'Copy results'}</button>}
        {step && <span className="save-status">{step}</span>}
      </div>
      {error && <div className="setup-test-status setup-problem">The speed check couldn't run: {error}</div>}
      {result && (
        <>
          <ul className="speed-findings">
            {result.findings.map((f, i) => <li key={i} className={f.level === 'slow' ? 'speed-slow' : 'speed-ok'}>{f.text}</li>)}
          </ul>
          <table className="speed-tabs">
            <thead><tr><th>Tab</th><th>Time to load</th></tr></thead>
            <tbody>
              {result.tabs.map((t) => (
                <tr key={t.tab}><td>{t.tab}</td><td>{t.error ? `couldn't load (${t.error})` : `${(t.ms / 1000).toFixed(2)} s`}</td></tr>
              ))}
            </tbody>
          </table>
          <h4>Where Income and Summary spend their time</h4>
          <ul className="speed-detail">
            {result.details.map((d) => (
              <li key={d.part}>
                <strong>{d.part}</strong>: {d.error ? `couldn't measure (${d.error})` : `${(d.ms / 1000).toFixed(2)} s, ${d.questions.length} questions to the database`}
                {!d.error && (
                  <ul>
                    {d.questions.slice(0, 3).map((q, i) => <li key={i}>{q.ms} ms, {q.rows} rows: <code>{q.what.slice(0, 70)}</code></li>)}
                  </ul>
                )}
              </li>
            ))}
          </ul>
          <div className="alerts-help">Copy results includes the full detail.</div>
        </>
      )}
    </section>
  );
}

function SettingsModal({ onClose, initialTab = null }) {
  const [tab, setTab] = useState(() => {
    if (initialTab) return initialTab;
    try {
      const saved = localStorage.getItem(SETTINGS_TAB_KEY);
      if (SETTINGS_TABS.some((t) => t.key === saved)) return saved;
    } catch { /* not remembered */ }
    return 'general';
  });
  // The dot on the Discord Alerts tab (see alertsNeedAttention).
  const [alertSettings, setAlertSettings] = useState(null);
  useEffect(() => {
    window.api.getAlertSettings().then((result) => { if (result.success) setAlertSettings(result.settings); });
  }, []);
  const alertsWarning = alertsNeedAttention(alertSettings);

  function chooseTab(key) {
    setTab(key);
    try { localStorage.setItem(SETTINGS_TAB_KEY, key); } catch { /* not remembered */ }
  }

  const [appVersion, setAppVersion] = useState('');
  useEffect(() => {
    window.api.getAppVersion().then(setAppVersion);
  }, []);

  // --- Auto-Refresh section ---
  const [refreshMinutes, setRefreshMinutes] = useState('');
  const [refreshLoaded, setRefreshLoaded] = useState(false);
  const [refreshStatus, setRefreshStatus] = useState('');

  useEffect(() => {
    window.api.getAutoRefreshInterval().then((result) => {
      setRefreshMinutes(String(result.minutes));
      setRefreshLoaded(true);
    });
  }, []);

  async function saveRefreshInterval() {
    setRefreshStatus('Saving...');
    const result = await window.api.saveAutoRefreshInterval(Number(refreshMinutes));
    setRefreshStatus(result.success ? 'Saved.' : `Failed: ${result.error}`);
  }

  // --- Postgres Connection section ---
  const [pgHost, setPgHost] = useState('');
  const [pgPort, setPgPort] = useState('');
  const [pgDatabase, setPgDatabase] = useState('');
  const [pgUser, setPgUser] = useState('');
  const [pgNewPassword, setPgNewPassword] = useState('');
  const [pgHasPassword, setPgHasPassword] = useState(false);
  const [pgSaved, setPgSaved] = useState(false);
  const [pgLoaded, setPgLoaded] = useState(false);
  const [pgTestStatus, setPgTestStatus] = useState('');
  const [pgSaveStatus, setPgSaveStatus] = useState('');

  const loadPgConfig = () => {
    window.api.getPostgresConfig().then((result) => {
      setPgHost(result.host);
      setPgPort(String(result.port || ''));
      setPgDatabase(result.database);
      setPgUser(result.user);
      setPgHasPassword(result.hasPassword);
      setPgSaved(!!result.host);
      setPgLoaded(true);
    });
  };
  useEffect(loadPgConfig, []);
  // Whether the saved connection works right now: the New database section then starts folded away.
  const [pgOnline, setPgOnline] = useState(false);
  useEffect(() => {
    window.api.getConnectionStatus().then((s) => setPgOnline(!!(s && s.online))).catch(() => {});
  }, []);
  const pgConnected = pgSaved && pgOnline;

  function pgPayload() {
    return {
      host: pgHost,
      port: pgPort,
      database: pgDatabase,
      user: pgUser,
      newPassword: pgNewPassword
    };
  }

  async function testPgConnection() {
    setPgTestStatus('Testing...');
    const result = await window.api.testPostgresConnection(pgPayload());
    setPgTestStatus(result.success ? 'Connection successful.' : `Failed: ${result.error}`);
  }

  async function savePgConfig() {
    setPgSaveStatus('Saving...');
    const result = await window.api.savePostgresConfig(pgPayload());
    if (result.success) {
      setPgSaveStatus('Saved.');
      setPgNewPassword('');
      setPgHasPassword(true);
    } else {
      setPgSaveStatus(`Failed: ${result.error}`);
    }
  }

  // --- Warnings (General tab): low repair kits / ceruleum and the FC house warning, used by the
  // Summary, the Roster's colours and the Discord alerts ---
  const [warnings, setWarnings] = useState(null);
  const [warningsStatus, setWarningsStatus] = useState('');

  useEffect(() => {
    window.api.getLowThresholds().then((result) => {
      setWarnings({
        repairKitThreshold: String(result.repairKitThreshold),
        ceruleumThreshold: String(result.ceruleumThreshold),
        houseWarnDays: String(result.houseWarnDays),
      });
    });
  }, []);

  async function saveWarnings() {
    setWarningsStatus('Saving...');
    const result = await window.api.saveLowThresholds({
      repairKitThreshold: Number(warnings.repairKitThreshold),
      ceruleumThreshold: Number(warnings.ceruleumThreshold),
      houseWarnDays: Number(warnings.houseWarnDays),
    });
    setWarningsStatus(result.success ? 'Saved.' : `Failed: ${result.error}`);
  }

  // --- Fleet Economics section ---
  const [repairKitCost, setRepairKitCost] = useState('');
  const [repairKitLoaded, setRepairKitLoaded] = useState(false);
  const [repairKitStatus, setRepairKitStatus] = useState('');

  useEffect(() => {
    window.api.getRepairKitCost().then((result) => {
      setRepairKitCost(result.value !== null ? String(result.value) : '');
      setRepairKitLoaded(true);
    });
  }, []);

  async function saveRepairKitCost() {
    setRepairKitStatus('Saving...');
    const result = await window.api.saveRepairKitCost(Number(repairKitCost));
    setRepairKitStatus(result.success ? 'Saved.' : `Failed: ${result.error}`);
  }

  // --- Fight Club Import section ---
  const [showFightClubImport, setShowFightClubImport] = useState(false);

  return (
    <div className="modal-overlay">
      <div className="modal settings-modal">
        <div className="settings-header">
          <h2>Settings</h2>
          <span className="status">{appVersion ? `Version ${appVersion}` : ''}</span>
        </div>
        <div className="settings-tabs" role="tablist">
          {SETTINGS_TABS.map((t) => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} className={`settings-tab${tab === t.key ? ' active' : ''}`} onClick={() => chooseTab(t.key)}>
              {t.label}
              {t.key === 'alerts' && alertsWarning && <span className="settings-tab-dot" title={alertsWarning} aria-label={alertsWarning} />}
            </button>
          ))}
        </div>

        <div className="settings-body">
          {tab === 'general' && (
            <>
        <PlayStyleSection />

        <LivePricesSection />

        <section className="settings-section">
          <h3>Auto-Refresh</h3>
          {!refreshLoaded && <div className="status">Loading...</div>}
          {refreshLoaded && (
            <div className="settings-row">
              <label>
                Refresh every{' '}
                <input
                  type="number"
                  min="1"
                  value={refreshMinutes}
                  onChange={(e) => setRefreshMinutes(e.target.value)}
                  style={{ width: '60px' }}
                />{' '}
                minute(s)
              </label>
              <button onClick={saveRefreshInterval}>Save</button>
              {refreshStatus && <span className="save-status">{refreshStatus}</span>}
            </div>
          )}
        </section>

        <section className="settings-section">
          <h3>Fleet Economics</h3>
          {!repairKitLoaded && <div className="status">Loading...</div>}
          {repairKitLoaded && (
            <div className="settings-row">
              <label>
                Repair Kit Cost{' '}
                <input
                  type="number"
                  min="0"
                  value={repairKitCost}
                  onChange={(e) => setRepairKitCost(e.target.value)}
                  style={{ width: '100px' }}
                  placeholder="e.g. 2000"
                />
              </label>
              <button onClick={saveRepairKitCost}>Save</button>
              {repairKitStatus && <span className="save-status">{repairKitStatus}</span>}
            </div>
          )}
        </section>

        <section className="settings-section settings-warnings">
          <h3>Warnings</h3>
          {!warnings && <div className="status">Loading...</div>}
          {warnings && (
            <div>
              <div className="settings-row">
                <label>
                  Low repair kits below{' '}
                  <input type="number" min="0" value={warnings.repairKitThreshold} onChange={(e) => setWarnings({ ...warnings, repairKitThreshold: e.target.value })} style={{ width: '80px' }} />
                </label>
                <label>
                  Low ceruleum below{' '}
                  <input type="number" min="0" value={warnings.ceruleumThreshold} onChange={(e) => setWarnings({ ...warnings, ceruleumThreshold: e.target.value })} style={{ width: '80px' }} />
                </label>
              </div>
              <div className="settings-row">
                <label>
                  FC house not entered for{' '}
                  <input type="number" min="1" max="44" value={warnings.houseWarnDays} onChange={(e) => setWarnings({ ...warnings, houseWarnDays: e.target.value })} style={{ width: '60px' }} />
                  {' '}days
                </label>
              </div>
              <div className="alerts-help">Used by the Summary, the Character Roster's red numbers and the Discord alerts. 0 turns a low-supply warning off; the house warning is 1 to 44 days (the game demolishes at 45).</div>
              <div className="settings-row">
                <button onClick={saveWarnings}>Save</button>
                {warningsStatus && <span className="save-status">{warningsStatus}</span>}
              </div>
            </div>
          )}
        </section>
        <UpdatesSection />
        <CreditsSection />
            </>
          )}

          {tab === 'database' && (
            <>
        <section className="settings-section">
          <h3>Postgres Connection</h3>
          {!pgLoaded && <div className="status">Loading...</div>}
          {pgLoaded && (
            <div>
              <div className="settings-row">
                <label>Host <input type="text" value={pgHost} onChange={(e) => setPgHost(e.target.value)} /></label>
                <label>Port <input type="text" value={pgPort} onChange={(e) => setPgPort(e.target.value)} style={{ width: '70px' }} /></label>
              </div>
              <div className="settings-row">
                <label>Database <input type="text" value={pgDatabase} onChange={(e) => setPgDatabase(e.target.value)} /></label>
                <label>User <input type="text" value={pgUser} onChange={(e) => setPgUser(e.target.value)} /></label>
              </div>
              <div className="settings-row">
                <label>
                  Password{' '}
                  <input
                    type="password"
                    value={pgNewPassword}
                    onChange={(e) => setPgNewPassword(e.target.value)}
                    placeholder={pgHasPassword ? '(already set - leave blank to keep)' : '(not set)'}
                  />
                </label>
              </div>
              <div className="settings-row">
                <button onClick={testPgConnection}>Test Connection</button>
                <button onClick={savePgConfig}>Save</button>
                {pgTestStatus && <span className="save-status">{pgTestStatus}</span>}
                {pgSaveStatus && <span className="save-status">{pgSaveStatus}</span>}
              </div>
              <div className="alerts-help">Setting up another PC, the plugin or Tailscale? See <button className="link-button" onClick={() => chooseTab('setup')}>Setup Help</button>.</div>
            </div>
          )}
        </section>
        <NewDatabaseSection onCreated={loadPgConfig} connected={pgConnected} />
        {pgConnected && <MoveDatabaseSection onMoved={loadPgConfig} />}
        <LeftoversSection />
        {pgConnected && <SpeedCheckSection />}
            </>
          )}

          {tab === 'backups' && <BackupsSection />}

          {tab === 'setup' && <SetupHelpSection />}

          {tab === 'alerts' && <AlertsSection onLoaded={setAlertSettings} />}

          {tab === 'data' && (
            <>
        <section className="settings-section">
          <h3>Fight Club Data</h3>
          <button onClick={() => setShowFightClubImport(true)}>Import Fight Club Data</button>
          {showFightClubImport && (
            <FightClubImportModal onClose={() => setShowFightClubImport(false)} />
          )}
        </section>

        <GameDataSection />
            </>
          )}
        </div>

        <div className="modal-actions">
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
