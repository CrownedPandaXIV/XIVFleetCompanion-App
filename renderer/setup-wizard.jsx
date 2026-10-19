// "Set up this PC" (first start with no connection, or Settings → Setup Help): what the PC is for, then the
// app downloads and installs what it needs (PostgreSQL, Tailscale), makes the database, signs in to Tailscale
// and shows what to do next (ipc/setup-wizard.js). Pages: role → details → running → tailscale → finish.

const SETUP_STEP_MARK = { waiting: '○', working: '…', done: '✓', failed: '✕' };

function SetupWizard({ onClose, firstRun = false }) {
  const [info, setInfo] = useState(null);
  const [page, setPage] = useState('role');
  const [role, setRole] = useState('');
  const [sameNetwork, setSameNetwork] = useState(false);
  const [planned, setPlanned] = useState(null);
  const [form, setForm] = useState({ master: '', master2: '', app: '', app2: '', database: 'fleet', user: 'fleet_app' });
  const [shown, setShown] = useState({});
  const [problem, setProblem] = useState('');
  const [steps, setSteps] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => { window.api.getWizardInfo().then(setInfo); }, []);
  useEffect(() => window.api.onSetupProgress(setSteps), []);

  if (!info) return <div className="modal-overlay"><div className="modal setup-wizard"><div className="status">Loading...</div></div></div>;
  const chosen = info.roles.find((r) => r.key === role);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const suggest = async (a, b) => {
    const pw = await window.api.suggestPassword();
    setForm((f) => ({ ...f, [a]: pw, [b]: pw }));
    setShown((s) => ({ ...s, [a]: pw }));
  };
  const afterRun = (plan) => setPage(plan.tailscale ? 'tailscale' : 'finish');

  const toDetails = async () => {
    const p = await window.api.getSetupPlan({ role, sameNetwork });
    setPlanned(p);
    setProblem('');
    const nothingToRun = !p.plan.installPostgres && !p.plan.installTailscale && !p.plan.createDatabase && !p.plan.openConnections;
    if (nothingToRun) afterRun(p.plan); else setPage('details');
  };

  const start = async () => {
    const plan = planned.plan;
    if (plan.createDatabase) {
      if (form.master.length < 8) return setProblem('The master password needs at least 8 characters.');
      if (form.master !== form.master2) return setProblem("The two master passwords don't match.");
      if (form.app.length < 8) return setProblem("The app's password needs at least 8 characters.");
      if (form.app !== form.app2) return setProblem("The two passwords for the app don't match.");
      if (form.app === form.master) return setProblem("Use a different password for the app than the master password: the app's one gets typed on every PC.");
    }
    setProblem('');
    setError('');
    setSteps(planned.steps.map((s) => ({ ...s, state: 'waiting' })));
    setPage('running');
    const r = await window.api.runSetup({ role, sameNetwork, masterPassword: form.master, appPassword: form.app, database: form.database, user: form.user });
    if (r.steps && r.steps.length) setSteps(r.steps);
    if (r.ok) {
      setForm((f) => ({ ...f, master: '', master2: '', app: '', app2: '' }));
      setShown({});
      afterRun(plan);
    } else {
      setError(r.error || 'Something went wrong.');
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal setup-wizard" role="dialog" aria-label="Set up this PC">
        <h2>Set up this PC</h2>

        {page === 'role' && (
          <>
            {firstRun && <p>Welcome! A few questions, and the app installs and sets up what this PC needs.</p>}
            <p>What is this PC for?</p>
            <div className="setup-roles">
              {info.roles.map((r) => (
                <label key={r.key} className={`setup-role${role === r.key ? ' active' : ''}`}>
                  <input type="radio" name="setup-role" value={r.key} checked={role === r.key} onChange={() => setRole(r.key)} />
                  <span><strong>{r.label}</strong><br /><span className="alerts-help">{r.detail}</span></span>
                </label>
              ))}
            </div>
            {chosen && chosen.otherPcs && (
              <label className="setup-same-network">
                <input type="checkbox" checked={sameNetwork} onChange={(e) => setSameNetwork(e.target.checked)} />
                {' '}All my PCs are in the same house, on one network (or the database is online), so Tailscale isn't needed
              </label>
            )}
            <p className="alerts-help">
              Already on this PC: {[info.installed.postgres && 'PostgreSQL', info.installed.tailscale && 'Tailscale'].filter(Boolean).join(' and ') || 'neither PostgreSQL nor Tailscale'}.
              Anything already installed is used as it is. Uninstalling the app never removes PostgreSQL or your database.
            </p>
            <div className="modal-actions">
              <button onClick={() => onClose(false)}>{firstRun ? "Skip: I'll enter the connection in Settings" : 'Cancel'}</button>
              <button className="setup-next" disabled={!role} onClick={toDetails}>Next</button>
            </div>
          </>
        )}

        {page === 'details' && planned && (
          <>
            <p><strong>{chosen.label}.</strong> The app will:</p>
            <ul className="setup-plan">
              {planned.steps.map((s) => <li key={s.id}>{s.label}</li>)}
            </ul>
            {(planned.plan.alreadyPostgres || planned.plan.alreadyTailscale) && (
              <p className="alerts-help">Already installed, so not downloaded: {[planned.plan.alreadyPostgres && 'PostgreSQL', planned.plan.alreadyTailscale && 'Tailscale'].filter(Boolean).join(' and ')}.</p>
            )}
            {planned.plan.createDatabase && (
              <>
                <h4>Master password</h4>
                <p className="alerts-help">
                  {planned.plan.alreadyPostgres
                    ? 'PostgreSQL is already on this PC: enter the master password ("postgres" login) chosen when it was installed.'
                    : "The master key to your database. Write it down somewhere safe: you'll need it if you ever move or rebuild the database. The app doesn't keep it."}
                </p>
                <div className="settings-row">
                  <label>Master password <input type="password" className="setup-master" value={form.master} onChange={set('master')} /></label>
                  <label>Again <input type="password" className="setup-master2" value={form.master2} onChange={set('master2')} /></label>
                  {!planned.plan.alreadyPostgres && <button className="setup-suggest-master" onClick={() => suggest('master', 'master2')}>Suggest one</button>}
                </div>
                {shown.master && <div className="setup-line"><code>{shown.master}</code><SetupCopy text={shown.master} /></div>}
                <h4>The app's password</h4>
                <p className="alerts-help">For the app's own database login. This is the one you'll type on your other PCs and in the plugin.</p>
                <div className="settings-row">
                  <label>App password <input type="password" className="setup-app" value={form.app} onChange={set('app')} /></label>
                  <label>Again <input type="password" className="setup-app2" value={form.app2} onChange={set('app2')} /></label>
                  <button className="setup-suggest-app" onClick={() => suggest('app', 'app2')}>Suggest one</button>
                </div>
                {shown.app && <div className="setup-line"><code>{shown.app}</code><SetupCopy text={shown.app} /></div>}
                <details className="setup-names">
                  <summary>Database name and username</summary>
                  <div className="settings-row">
                    <label>Database <input type="text" value={form.database} onChange={set('database')} style={{ width: '120px' }} /></label>
                    <label>Username <input type="text" value={form.user} onChange={set('user')} style={{ width: '120px' }} /></label>
                  </div>
                </details>
              </>
            )}
            {problem && <div className="setup-test-status setup-problem">{problem}</div>}
            <div className="modal-actions">
              <button onClick={() => setPage('role')}>Back</button>
              <button className="setup-start" onClick={start} disabled={!info.windows}>Set up this PC</button>
              {!info.windows && <span className="save-status">Only on Windows.</span>}
            </div>
          </>
        )}

        {page === 'running' && (
          <>
            <ul className="setup-steps-list">
              {steps.map((s) => (
                <li key={s.id} className={`setup-step ${s.state}`}>
                  <span className="setup-step-mark">{SETUP_STEP_MARK[s.state] || '○'}</span> {s.label}
                  {s.detail && <span className="alerts-help"> {s.detail}</span>}
                </li>
              ))}
            </ul>
            {!error && <p className="alerts-help">This can take a few minutes. Keep the app open.</p>}
            {error && (
              <>
                <div className="setup-test-status setup-problem">{error}</div>
                <div className="modal-actions">
                  <button onClick={() => onClose(false)}>Close</button>
                  <button onClick={() => setPage('details')}>Try again</button>
                </div>
              </>
            )}
          </>
        )}

        {page === 'tailscale' && <SetupWizardTailscale unattended={chosen.database} onNext={() => setPage('finish')} />}

        {page === 'finish' && <SetupWizardFinish role={role} onClose={onClose} />}
      </div>
    </div>
  );
}

// Signing in to Tailscale: the button starts it and opens Tailscale's page; the status is checked every few
// seconds until it's signed in.
function SetupWizardTailscale({ unattended, onNext }) {
  const [status, setStatus] = useState(null);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let stop = false;
    const check = () => window.api.getTailscaleStatus().then((s) => { if (!stop) setStatus(s); });
    check();
    const timer = setInterval(check, 3000);
    return () => { stop = true; clearInterval(timer); };
  }, []);
  const signIn = async () => {
    setMessage('Opening Tailscale\'s sign-in page...');
    const r = await window.api.signInToTailscale({ unattended });
    setMessage(r.ok ? (r.opened ? "Sign in on the page that opened in your browser, then come back here." : 'Waiting for Tailscale...') : r.error);
  };
  return (
    <>
      <h4>Sign in to Tailscale</h4>
      <p className="alerts-help">
        Use the same Tailscale account on every one of your PCs, so they can see each other. No account yet? The
        sign-in page lets you make one for free (a Google, Microsoft or GitHub login works).
      </p>
      <div className="setup-ts-status">
        {!status && 'Checking Tailscale...'}
        {status && !status.installed && "Tailscale isn't installed on this PC."}
        {status && status.installed && status.signedIn && `Signed in. This PC's Tailscale address is ${status.address || '(not known yet)'}.`}
        {status && status.installed && !status.signedIn && 'Not signed in yet.'}
      </div>
      {status && status.installed && !status.signedIn && <div className="settings-row"><button className="setup-ts-signin" onClick={signIn}>Sign in to Tailscale</button></div>}
      {message && <div className="alerts-help">{message}</div>}
      <div className="modal-actions">
        <button className="setup-next" onClick={onNext}>{status && status.signedIn ? 'Next' : 'Skip for now'}</button>
      </div>
    </>
  );
}

// The last page: what to do next for this kind of PC.
function SetupWizardFinish({ role, onClose }) {
  const [details, setDetails] = useState(null);
  const [conn, setConn] = useState({ host: '', port: '5432', database: '', user: '', newPassword: '' });
  const [status, setStatus] = useState('');
  useEffect(() => { window.api.getSetupDetails().then(setDetails); }, []);
  const set = (key) => (e) => setConn((c) => ({ ...c, [key]: e.target.value }));
  const test = async () => {
    setStatus('Testing...');
    const r = await window.api.testPostgresConnection(conn);
    setStatus(r.success ? 'Connected.' : `Failed: ${r.error}`);
  };
  const save = async () => {
    const r = await window.api.savePostgresConfig(conn);
    if (r.success) onClose(true); else setStatus(`Failed: ${r.error}`);
  };
  if (!details) return <div className="status">Loading...</div>;
  return (
    <div className="setup-finish">
      {(role === 'onepc' || role === 'dbhost') && (
        <>
          <p><strong>This PC is set up.</strong> The database is ready and the app is connected to it.</p>
          {role === 'dbhost' && <><p>On each of your other PCs, install the app and choose "This PC uses a database on another PC". Then type in these details:</p><SetupConnect details={details} /></>}
          <p>Next: install the plugin in the game, on every PC that plays, along with AutoRetainer (needed), Allagan Tools (recommended), and FC Tracker and Submarine Tracker (optional). Settings → Setup Help → The plugin shows how, step by step, with the addresses to paste.</p>
          <p className="alerts-help">The app now fills in the game data (item names, worlds, recipes) by itself. That takes a minute or two, and a note at the top says when it's done.</p>
          <div className="modal-actions"><button className="setup-done" onClick={() => onClose(true)}>Done</button></div>
        </>
      )}
      {role === 'connect' && (
        <>
          <p><strong>Last step:</strong> type in the details shown on the database PC (Settings → Setup Help → Connect another PC).</p>
          <div className="settings-row">
            <label>Address <input type="text" className="setup-conn-host" value={conn.host} onChange={set('host')} placeholder="100.x.x.x" /></label>
            <label>Port <input type="text" className="setup-conn-port" value={conn.port} onChange={set('port')} style={{ width: '70px' }} /></label>
          </div>
          <div className="settings-row">
            <label>Database <input type="text" className="setup-conn-database" value={conn.database} onChange={set('database')} /></label>
            <label>Username <input type="text" className="setup-conn-user" value={conn.user} onChange={set('user')} /></label>
          </div>
          <div className="settings-row">
            <label>Password <input type="password" className="setup-conn-password" value={conn.newPassword} onChange={set('newPassword')} /></label>
          </div>
          {status && <div className="setup-test-status setup-conn-status">{status}</div>}
          <div className="modal-actions">
            <button onClick={() => onClose(false)}>Later</button>
            <button className="setup-conn-test" onClick={test}>Test connection</button>
            <button className="setup-conn-save" onClick={save}>Save and finish</button>
          </div>
        </>
      )}
      {role === 'plugin' && (
        <>
          <p><strong>This PC is ready.</strong> Now install the plugin in the game and enter the database PC's details in it:</p>
          <SetupPlugin details={details} onConnect={() => {}} />
          <div className="modal-actions"><button className="setup-done" onClick={() => onClose(true)}>Done</button></div>
        </>
      )}
    </div>
  );
}
