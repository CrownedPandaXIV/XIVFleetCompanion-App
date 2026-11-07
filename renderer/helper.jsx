// The Database Helper's home page (Settings → General → This PC shows → Just the database tools): where the
// database is and whether it's up to date, this PC's backups, and the PCs that use it, each with the way to
// the full tools in Settings. Nothing here changes anything by itself.

function HelperCard({ title, children, actions }) {
  return (
    <section className="helper-card">
      <h2>{title}</h2>
      <div className="helper-card-body">{children}</div>
      {actions && <div className="helper-card-actions">{actions}</div>}
    </section>
  );
}

function HelperView({ refreshKey, onOpenSettings, onNavigate }) {
  const [overview, setOverview] = useState(null);
  const [backups, setBackups] = useState(null);
  const [online, setOnline] = useState(null);

  useEffect(() => {
    window.api.getHelperOverview().then(setOverview).catch((err) => setOverview({ success: false, error: err.message }));
    window.api.getBackups().then(setBackups).catch(() => setBackups(null));
    window.api.getConnectionStatus().then((s) => setOnline(!!(s && s.online))).catch(() => setOnline(false));
  }, [refreshKey]);

  if (!overview) return <div className="status">Loading...</div>;
  const conn = overview.connection;
  const last = backups && backups.success ? backups.last : null;
  const daily = backups && backups.success ? backups.settings : null;

  let versionLine = null;
  if (conn && overview.success) {
    if (overview.version === null) versionLine = <span className="tone-warn">The database hasn't been set up by the app yet.</span>;
    else if (overview.version < overview.latest) versionLine = <span className="tone-warn">Database version {overview.version}: the app updates it to {overview.latest} by itself.</span>;
    else if (overview.version > overview.latest) versionLine = <span className="tone-warn">Database version {overview.version}: a newer app updated it. Update this one.</span>;
    else versionLine = <span className="tone-good">Up to date (database version {overview.version}).</span>;
  }

  return (
    <div className="helper-view">
      <p className="alerts-help helper-intro">
        This PC shows only the database tools. Your fleet is in the game (the plugin), or on any PC that shows the whole app.
      </p>

      <HelperCard
        title="Database"
        actions={<>
          <button className="helper-open-database" onClick={() => onOpenSettings('database')}>Connection and moving</button>
          <button className="helper-open-setup" onClick={() => onOpenSettings('setup')}>Setup Help</button>
        </>}
      >
        {!conn && <div className="tone-warn">No database connection saved on this PC yet. Setup Help sets this PC up, or Connection and moving takes the details.</div>}
        {conn && (
          <>
            <div className="helper-line">
              <strong>{conn.database}</strong> on {conn.host}{conn.port ? `:${conn.port}` : ''} <span className="dim">(login {conn.user})</span>
            </div>
            <div className="helper-line">
              {online === null ? 'Checking...' : online ? <span className="tone-good">Answering.</span> : <span className="tone-warn">Can't be reached right now.</span>}
              {' '}{versionLine}
            </div>
            {!overview.success && overview.error && <div className="helper-line dim">{overview.error}</div>}
          </>
        )}
      </HelperCard>

      <HelperCard
        title="Backups on this PC"
        actions={<button className="helper-open-backups" onClick={() => onOpenSettings('backups')}>Backups and restore</button>}
      >
        {!backups && <div className="status">Loading...</div>}
        {backups && !backups.success && <div className="tone-warn">{backups.error}</div>}
        {backups && backups.success && (
          <>
            <div className="helper-line">
              {last
                ? (last.ok
                  ? <>Last backup: {new Date(last.at).toLocaleString()}</>
                  : <span className="tone-warn">The last backup failed ({new Date(last.at).toLocaleString()}): {last.message}</span>)
                : <span className="dim">No backup made on this PC yet.</span>}
            </div>
            <div className="helper-line">
              {daily && daily.enabled
                ? <>Backs up every day at {daily.time}{daily.copyFolder ? ', with a second copy' : ''}. The app doesn't need to be open for it.</>
                : <span className="dim">The daily backup is off on this PC.</span>}
            </div>
          </>
        )}
      </HelperCard>

      <HelperCard
        title="PCs"
        actions={<button className="helper-open-pcs" onClick={() => onNavigate('pcs')}>See every PC</button>}
      >
        <div className="helper-line">
          {overview.pcs === null || overview.pcs === undefined
            ? <span className="dim">Shown once the database can be reached.</span>
            : `${overview.pcs} PC${overview.pcs === 1 ? '' : 's'} with the plugin use this database.`}
        </div>
      </HelperCard>

      <div className="alerts-help helper-switch">
        Want your fleet on this PC too?{' '}
        <button className="helper-show-fleet" onClick={() => window.api.setAppMode('fleet')}>Show the whole app</button>
        {' '}(also in Settings → General).
      </div>
    </div>
  );
}
