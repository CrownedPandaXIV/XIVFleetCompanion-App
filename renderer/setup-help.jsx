// Settings → Setup Help: connecting another PC (the details to type there, never the password), installing
// the plugin, and Tailscale, with a connection test that says what's wrong (ipc/setup-help.js).

const SETUP_HELP_PAGES = [
  { key: 'connect', label: 'Connect another PC' },
  { key: 'plugin', label: 'The plugin' },
  { key: 'tailscale', label: 'Tailscale' },
  { key: 'problem', label: 'Found a problem?' },
];

function SetupCopy({ text, label = 'Copy' }) {
  const [done, setDone] = useState(false);
  const copy = () => navigator.clipboard.writeText(text).then(() => {
    setDone(true);
    setTimeout(() => setDone(false), 1500);
  });
  return <button className="setup-copy" onClick={copy}>{done ? 'Copied' : label}</button>;
}

// A line to type or paste somewhere, with its own Copy button.
function SetupLine({ text }) {
  return <div className="setup-line"><code>{text}</code><SetupCopy text={text} /></div>;
}

function SetupHelpSection() {
  const [page, setPage] = useState('connect');
  const [details, setDetails] = useState(null);
  const [wizard, setWizard] = useState(false);
  const load = () => window.api.getSetupDetails().then(setDetails);
  useEffect(() => { load(); }, []);

  return (
    <section className="settings-section setup-help">
      <div className="setup-run">
        <button className="setup-run-button" onClick={() => setWizard(true)}>Set up this PC</button>
        <span className="alerts-help">Installs what this PC needs (PostgreSQL, Tailscale) and sets it up, step by step.</span>
      </div>
      {wizard && <SetupWizard onClose={() => { setWizard(false); load(); }} />}
      <div className="setup-pages" role="tablist">
        {SETUP_HELP_PAGES.map((p) => (
          <button key={p.key} role="tab" aria-selected={page === p.key} className={`setup-page${page === p.key ? ' active' : ''}`} onClick={() => setPage(p.key)}>{p.label}</button>
        ))}
      </div>
      {!details && <div className="status">Loading...</div>}
      {details && page === 'connect' && <SetupConnect details={details} />}
      {details && page === 'plugin' && <SetupPlugin details={details} onConnect={() => setPage('connect')} />}
      {details && page === 'tailscale' && <SetupTailscale details={details} />}
      {page === 'problem' && <SetupProblem />}
      <RemoveEverything />
    </section>
  );
}

// Found a problem?: where to report it (the app's GitHub page), what to include, and the app's log
// (app-log.js), which says what the app did and any errors.
function SetupProblem() {
  const [info, setInfo] = useState(null);
  const [status, setStatus] = useState('');
  useEffect(() => { window.api.getProblemInfo().then(setInfo); }, []);
  if (!info) return <div className="status">Loading...</div>;
  const summary = `XIV Fleet Companion ${info.version} on ${info.system}`;
  const openLogs = async () => {
    const r = await window.api.openLogFolder();
    setStatus(r && r.success ? '' : (r && r.error) || 'The log folder could not be opened.');
  };
  return (
    <div className="setup-steps setup-problem">
      <p>If something isn't working, or looks wrong, report it on the app's GitHub page. It's for the app and the
        plugin alike, and you'll need a free GitHub account.</p>
      <div className="settings-row">
        <button className="problem-report" onClick={() => window.api.reportProblem()}>Report a problem</button>
      </div>
      <h4>What to include</h4>
      <ul>
        <li>What you did, what you expected, and what happened instead.</li>
        <li>
          This app's version: <SetupLine text={summary} />
        </li>
        <li>The plugin's version on each PC: on the PCs tab, or in the title of the plugin's window in the game.</li>
        <li>For something about the plugin or the game: type <code>/xivfleet check</code> in the game, click
          <strong> Copy results</strong> and paste them in.</li>
        <li>The app's log: <code>app.log</code> in the log folder. It says what the app did and any errors, and never
          has passwords in it.</li>
      </ul>
      <div className="settings-row">
        <button className="problem-logs" onClick={openLogs}>Open the log folder</button>
        <span className="alerts-help">{info.logFolder}</span>
        {status && <span className="save-status">{status}</span>}
      </div>
    </div>
  );
}

// Remove everything from this PC (setup/remove-everything.js): folded behind a button, lists what goes and
// what stays, offers a final backup, and needs DELETE typed before it starts. Once done, the app closes and
// removes itself.
function RemoveEverything() {
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState(null);
  const [form, setForm] = useState({ backup: true, backupFolder: '', removeTailscale: false, masterPassword: '', confirm: '' });
  const [steps, setSteps] = useState(null);
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState(null);
  // null, 'closing', or why the last part couldn't start.
  const [finishing, setFinishing] = useState(null);
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const finish = async () => {
    setFinishing('closing');
    const r = await window.api.finishRemoval();
    if (!r.ok) setFinishing(r.error);
  };

  useEffect(() => {
    if (!open) return undefined;
    window.api.getRemovalPlan().then((r) => { setInfo(r); setForm((f) => ({ ...f, backupFolder: f.backupFolder || r.backupFolder })); });
    return window.api.onRemoveProgress(setSteps);
  }, [open]);

  const choose = async () => {
    const folder = await window.api.chooseBackupFolder({ title: 'Folder for the final backup', current: form.backupFolder });
    if (folder) set('backupFolder', folder);
  };
  const start = async () => {
    setWorking(true);
    setResult(null);
    setSteps(null);
    const r = await window.api.removeEverything(form);
    setWorking(false);
    setResult(r);
    setForm((f) => ({ ...f, masterPassword: '', confirm: '' }));
  };

  if (!open) {
    return (
      <div className="setup-remove">
        <h4>Remove everything from this PC</h4>
        <div className="alerts-help">For when you're done with the app on this PC. Uninstalling it from Windows only removes the app and keeps your data; this removes the rest too.</div>
        <button className="remove-open" onClick={() => setOpen(true)}>Remove everything...</button>
      </div>
    );
  }
  const plan = info && info.plan;
  return (
    <div className="setup-remove">
      <h4>Remove everything from this PC</h4>
      {!plan && <div className="status">Checking this PC...</div>}
      {plan && !result?.ok && (
        <>
          <p>This removes:</p>
          <ul className="remove-list">{plan.removes.map((r) => <li key={r}>{r}</li>)}</ul>
          {plan.canRemoveTailscale && (
            <label className="remove-tailscale"><input type="checkbox" checked={form.removeTailscale} onChange={(e) => set('removeTailscale', e.target.checked)} /> Also remove Tailscale (the app installed it; leave it if you use it for anything else)</label>
          )}
          <p>It leaves:</p>
          <ul className="keep-list">{plan.keeps.map((k) => <li key={k}>{k}</li>)}</ul>
          {plan.otherPcsLoseDatabase && (
            <p className="alerts-attention">Your other PCs use this database too. After this, they'll have nothing to connect to, and their history is gone with it.</p>
          )}
          {plan.offerBackup && (
            <div className="settings-row">
              <label><input type="checkbox" className="remove-backup" checked={form.backup} onChange={(e) => set('backup', e.target.checked)} /> Make a final backup first, to</label>
              <input type="text" className="remove-backup-folder" value={form.backupFolder} onChange={(e) => set('backupFolder', e.target.value)} disabled={!form.backup} style={{ width: '320px' }} />
              <button onClick={choose} disabled={!form.backup}>Choose...</button>
            </div>
          )}
          {plan.needsMasterPassword && (
            <div className="settings-row">
              <label>PostgreSQL's master password <input type="password" className="remove-master" value={form.masterPassword} onChange={(e) => set('masterPassword', e.target.value)} /></label>
              <span className="alerts-help">Chosen when PostgreSQL was installed. Only used for this.</span>
            </div>
          )}
          <div className="settings-row">
            <label>Type <strong>DELETE</strong> to confirm <input type="text" className="remove-typed" value={form.confirm} onChange={(e) => set('confirm', e.target.value)} style={{ width: '90px' }} /></label>
            <button className="remove-start danger" onClick={start} disabled={working || form.confirm.trim() !== 'DELETE' || !info.windows}>{working ? 'Removing...' : 'Remove everything'}</button>
            <button onClick={() => { setOpen(false); setResult(null); setSteps(null); }} disabled={working}>Cancel</button>
            {!info.windows && <span className="save-status">Only on Windows.</span>}
          </div>
        </>
      )}
      {steps && steps.length > 0 && (
        <ul className="setup-steps-list">
          {steps.map((s) => (
            <li key={s.id} className={`setup-step ${s.state}`}>
              <span className="setup-step-mark">{SETUP_STEP_MARK[s.state] || '○'}</span> {s.label}
              {s.detail && <span className="alerts-help"> {s.detail}</span>}
            </li>
          ))}
        </ul>
      )}
      {result && !result.ok && <div className="setup-test-status setup-problem remove-status">{result.error}</div>}
      {result && result.ok && (
        <>
          <p className="remove-status">Done. Last step: the app closes, removes itself, and deletes its settings.</p>
          <button className="remove-finish danger" disabled={finishing === 'closing'} onClick={finish}>{finishing === 'closing' ? 'Closing...' : 'Close and remove the app'}</button>
          {finishing && finishing !== 'closing' && <div className="setup-test-status setup-problem remove-status">{finishing}</div>}
        </>
      )}
    </div>
  );
}

function SetupConnect({ details }) {
  const [choice, setChoice] = useState(0);
  if (!details.saved) {
    return <p>This PC isn't connected to a database yet. Enter its details in the <strong>Database</strong> tab first; this page then shows what to type on your other PCs.</p>;
  }
  const address = details.choices[choice] ? details.choices[choice].address : '';
  return (
    <div className="setup-connect">
      <p>
        On each other PC, type these into the app (<strong>Settings → Database</strong>) and into the plugin
        (<code>/xivfleet</code>, then its settings). Every PC uses the same details.
      </p>
      {details.databaseHere && details.choices.length === 0 && (
        <p className="alerts-attention">
          The database is on this PC, but this PC has no address other PCs can use yet. Install Tailscale (see the
          Tailscale page), or connect this PC to your home network, then come back here.
        </p>
      )}
      {details.databaseHere && details.choices.length > 0 && (
        <p className="alerts-help">
          The database is on this PC. {details.choices.length > 1 ? 'Pick the address that suits the other PC: Tailscale works from anywhere, a home network address only from the same house.' : ''}
        </p>
      )}
      <table className="setup-details">
        <tbody>
          <tr>
            <th>Address</th>
            <td>
              {details.choices.length > 1 ? (
                <select value={choice} onChange={(e) => setChoice(Number(e.target.value))}>
                  {details.choices.map((c, i) => <option key={c.address} value={i}>{c.address} ({c.via})</option>)}
                </select>
              ) : <code>{address || '-'}</code>}
            </td>
          </tr>
          <tr><th>Port</th><td><code>{details.port}</code></td></tr>
          <tr><th>Database</th><td><code>{details.database}</code></td></tr>
          <tr><th>Username</th><td><code>{details.user}</code></td></tr>
          <tr><th>Password</th><td>the same one you use on this PC (never shown here)</td></tr>
        </tbody>
      </table>
      <div className="settings-row"><SetupCopy text={setupDetailsText(details, address)} label="Copy these details" /></div>
      <p className="alerts-help">
        Not connecting? Use <strong>Test connection</strong> on the Tailscale page of the other PC: it says what's wrong.
      </p>
      {details.databaseHere && details.choices.length > 0 && <SetupOpenConnections details={details} />}
    </div>
  );
}

// On the database PC: whether other PCs can connect (tried on this PC's own address), and the button that
// sets it up (setup/remote-access.js, with Windows' permission).
function SetupOpenConnections({ details }) {
  const address = details.choices[0].address;
  const [check, setCheck] = useState(null);
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState(null);
  const recheck = () => window.api.checkFromHere(address).then(setCheck);
  useEffect(() => { recheck(); }, []);

  const run = async () => {
    setWorking(true);
    setResult(null);
    const r = await window.api.letOtherPcsConnect();
    setWorking(false);
    setResult(r);
    recheck();
  };

  return (
    <div className="setup-open">
      <h4>Let other PCs connect</h4>
      <div className="setup-open-check">
        {!check && 'Checking whether other PCs can connect...'}
        {check && check.success && `Other PCs can connect: this PC answers on ${check.address}.`}
        {check && !check.success && `Other PCs can't connect yet (tried ${check.address || address}).`}
      </div>
      <p className="alerts-help">
        This sets PostgreSQL on this PC to let in your Tailscale PCs and this home network (always with the
        password), opens Windows Firewall for it, and restarts PostgreSQL, which takes a few seconds. Windows asks
        for permission first. Copies of PostgreSQL's two settings files are kept next to them.
      </p>
      <div className="settings-row">
        <button onClick={run} disabled={working || !details.windows}>{working ? 'Working...' : 'Let other PCs connect'}</button>
        {!details.windows && <span className="save-status">Only on Windows.</span>}
      </div>
      {result && result.success && (
        <div className="setup-test-status">
          Done. {result.changed.length ? result.changed.join('. ') + '.' : 'Everything was already set up.'}
        </div>
      )}
      {result && !result.success && <div className="setup-test-status">{result.error}</div>}
    </div>
  );
}

// Settings → Database: a new database on this PC, made with PostgreSQL's administrator login, which the app
// then switches to (setup/create-database.js). onCreated reloads the connection form. While a saved
// connection works (`connected`), only a button to open it is shown.
function NewDatabaseSection({ onCreated, connected }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ port: '5432', adminUser: 'postgres', adminPassword: '', database: 'fleet', user: 'fleet_app', password: '', repeat: '' });
  const [status, setStatus] = useState('');
  const [working, setWorking] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const create = async () => {
    if (form.password !== form.repeat) { setStatus("The two passwords for the app don't match."); return; }
    setWorking(true);
    setStatus('Creating...');
    const r = await window.api.createDatabase(form);
    setWorking(false);
    if (r.success) {
      setForm((f) => ({ ...f, adminPassword: '', password: '', repeat: '' }));
      setStatus(`Created "${form.database}". The app is now connected to it, and the first time it uses it, it sets up its tables and fills in the game data by itself (a minute or two).`);
      onCreated();
    } else {
      setStatus(r.error);
    }
  };
  if (connected && !open) {
    return (
      <section className="settings-section new-database">
        <h3>New database on this PC</h3>
        <div className="alerts-help">The connection above works, so you don't need this. It's only for starting a brand-new database on this PC.</div>
        <button className="newdb-open" onClick={() => setOpen(true)}>Make a new database instead</button>
      </section>
    );
  }
  return (
    <section className="settings-section new-database">
      <h3>New database on this PC</h3>
      <div className="alerts-help">
        For the PC that has PostgreSQL installed and no fleet database yet. The app makes the database and its own
        login, then connects to it instead of anything entered above. You need the password for PostgreSQL's
        "postgres" login, chosen when PostgreSQL was installed; it's only used for this and isn't saved.
      </div>
      <div className="settings-row">
        <label>PostgreSQL login <input type="text" className="newdb-admin-user" value={form.adminUser} onChange={set('adminUser')} style={{ width: '110px' }} /></label>
        <label>Its password <input type="password" className="newdb-admin-password" value={form.adminPassword} onChange={set('adminPassword')} /></label>
        <label>Port <input type="text" className="newdb-port" value={form.port} onChange={set('port')} style={{ width: '70px' }} /></label>
      </div>
      <div className="settings-row">
        <label>New database <input type="text" className="newdb-database" value={form.database} onChange={set('database')} style={{ width: '120px' }} /></label>
        <label>App username <input type="text" className="newdb-user" value={form.user} onChange={set('user')} style={{ width: '120px' }} /></label>
      </div>
      <div className="settings-row">
        <label>App password <input type="password" className="newdb-password" value={form.password} onChange={set('password')} /></label>
        <label>Again <input type="password" className="newdb-repeat" value={form.repeat} onChange={set('repeat')} /></label>
      </div>
      <div className="alerts-help">The app password is what you'll type on your other PCs and in the plugin, so pick one you can find again (at least 8 characters).</div>
      <div className="settings-row">
        <button onClick={create} disabled={working}>Create database</button>
      </div>
      {status && <div className="setup-test-status newdb-status">{status}</div>}
    </section>
  );
}

// Settings → Database: moving the database from the PC it's on now to this one (setup/move-database.js). Folded away
// until asked for, since it's rare. Every other PC switches by itself afterwards; the old database is kept.
function MoveDatabaseSection({ onMoved }) {
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState(null);
  const [form, setForm] = useState({ address: '', port: '5432', adminPassword: '', repeat: '' });
  const [steps, setSteps] = useState(null);
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState(null);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const load = () => {
    setInfo(null);
    window.api.getMoveInfo().then((r) => {
      setInfo(r);
      setForm((f) => ({ ...f, address: f.address || (r.choices[0] ? r.choices[0].address : '') }));
    });
  };
  useEffect(() => {
    if (!open) return undefined;
    load();
    return window.api.onMoveProgress(setSteps);
  }, [open]);

  const suggest = async () => {
    const pw = await window.api.suggestPassword();
    setForm((f) => ({ ...f, adminPassword: pw, repeat: pw }));
  };
  const start = async () => {
    if (info && !info.postgresInstalled && form.adminPassword !== form.repeat) {
      setResult({ ok: false, error: "The two master passwords don't match." });
      return;
    }
    setWorking(true);
    setResult(null);
    setSteps(null);
    const r = await window.api.moveDatabase({ address: form.address, port: form.port, adminPassword: form.adminPassword });
    setWorking(false);
    setResult(r);
    if (r.ok) {
      setForm((f) => ({ ...f, adminPassword: '', repeat: '' }));
      onMoved();
    }
  };

  if (!open) {
    return (
      <section className="settings-section move-database">
        <h3>Move the database to this PC</h3>
        <div className="alerts-help">For when the database should live on this PC instead of the one it's on now, for example a new PC replacing it. Your other PCs switch over by themselves.</div>
        <button className="move-open" onClick={() => setOpen(true)}>Move the database here...</button>
      </section>
    );
  }
  const check = info && info.check;
  const fresh = info && !info.postgresInstalled;
  const ready = info && check && check.ok && info.windows && form.address && form.adminPassword && (!fresh || form.repeat);
  return (
    <section className="settings-section move-database">
      <h3>Move the database to this PC</h3>
      {!info && <div className="status">Checking the database and your PCs...</div>}
      {info && !result?.ok && (
        <>
          {info.from && (
            <p>
              This copies the database <strong>{info.from.database}</strong> from <strong>{info.from.host}</strong> to this PC. Then
              every app and plugin switches to this PC by itself, at its next refresh or sync, with the same username and
              password. The database on {info.from.host} is left as it is, so if anything goes wrong, nothing is lost.
            </p>
          )}
          {check && check.ok && <div className="setup-test-status move-ready">Everything's ready to move.</div>}
          {check && !check.ok && (
            <div className="setup-test-status setup-problem move-problem">
              {check.error}
              {check.blocking.length > 0 && <ul>{check.blocking.map((b) => <li key={b}>{b}</li>)}</ul>}
            </div>
          )}
          {check && check.notes.length > 0 && <ul className="alerts-help move-notes">{check.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
          {check && !check.ok && <button className="move-recheck" onClick={load} disabled={working}>Check again</button>}
          <div className="settings-row">
            <label>
              Your other PCs reach this one at{' '}
              <select className="move-address" value={form.address} onChange={set('address')}>
                {info.choices.map((c) => <option key={c.address} value={c.address}>{c.address} ({c.via})</option>)}
              </select>
            </label>
            {info.choices.length === 0 && <span className="save-status">This PC has no Tailscale or home network address. Set up Tailscale first (Setup Help).</span>}
          </div>
          {fresh ? (
            <>
              <div className="alerts-help">
                PostgreSQL isn't on this PC yet, so the app downloads {info.postgresName} (about 350 MB) and installs it. Choose a
                master password for it. Keep it somewhere safe: it's only needed for jobs like this one, and isn't saved.
              </div>
              <div className="settings-row">
                <label>Master password <input type="password" className="move-admin-password" value={form.adminPassword} onChange={set('adminPassword')} /></label>
                <label>Again <input type="password" className="move-admin-repeat" value={form.repeat} onChange={set('repeat')} /></label>
                <button onClick={suggest} disabled={working}>Suggest one</button>
              </div>
            </>
          ) : (
            <div className="settings-row">
              <label>PostgreSQL's master password on this PC <input type="password" className="move-admin-password" value={form.adminPassword} onChange={set('adminPassword')} /></label>
              <label>Port <input type="text" className="move-port" value={form.port} onChange={set('port')} style={{ width: '70px' }} /></label>
              <span className="alerts-help">Chosen when PostgreSQL was installed here. Only used for this.</span>
            </div>
          )}
          <div className="settings-row">
            <button className="move-start" onClick={start} disabled={working || !ready}>{working ? 'Moving...' : 'Move the database here'}</button>
            <button onClick={() => { setOpen(false); setResult(null); setSteps(null); }} disabled={working}>Cancel</button>
            {!info.windows && <span className="save-status">Only on Windows.</span>}
          </div>
          {working && <p className="alerts-help">This takes a few minutes, longer for a big database. Keep the app open. The plugins pause while the copy is made and catch up afterwards.</p>}
        </>
      )}
      {steps && steps.length > 0 && (
        <ul className="setup-steps-list">
          {steps.map((s) => (
            <li key={s.id} className={`setup-step ${s.state}`}>
              <span className="setup-step-mark">{SETUP_STEP_MARK[s.state] || '○'}</span> {s.label}
              {s.detail && <span className="alerts-help"> {s.detail}</span>}
            </li>
          ))}
        </ul>
      )}
      {result && !result.ok && <div className="setup-test-status setup-problem move-status">{result.error}</div>}
      {result && result.ok && (
        <div className="move-status">
          <p><strong>Moved.</strong> This app now uses the database on this PC. Your other PCs switch to {result.to} by themselves at their next refresh or sync; the PCs tab shows which have.</p>
          <ul>
            <li>Turn on daily backups here (Backups tab), and turn them off on {info && info.from ? info.from.host : 'the old PC'}, since this PC has the data now.</li>
            <li>The old database stays on {info && info.from ? info.from.host : 'the old PC'}, unused. Once every PC has switched, you can remove it there: Settings → Database → Leftovers from moving the database.</li>
          </ul>
        </div>
      )}
    </section>
  );
}

// Settings → Database: what moving the database left in this PC's PostgreSQL (setup/leftovers.js), and removing
// it. Shown only on a PC with PostgreSQL. Nothing is looked for until the master password is typed.
function LeftoversSection() {
  const [info, setInfo] = useState(null);
  const [form, setForm] = useState({ adminPassword: '', port: '5432' });
  const [found, setFound] = useState(null);
  const [status, setStatus] = useState('');
  const [working, setWorking] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  useEffect(() => {
    window.api.getLeftoversInfo().then((r) => { setInfo(r); setForm((f) => ({ ...f, port: String(r.port) })); });
  }, []);

  const look = async () => {
    setWorking(true);
    setStatus('Looking...');
    const r = await window.api.findLeftovers(form);
    setWorking(false);
    if (r.success) { setFound(r); setStatus(''); } else { setFound(null); setStatus(r.error); }
  };
  const remove = async (name) => {
    const r = await window.api.removeLeftover({ ...form, name });
    if (!r.success) { setStatus(r.error); return false; }
    await look();
    setStatus(`Removed "${name}".`);
    return true;
  };
  const removePostgres = async () => {
    setStatus('Removing PostgreSQL (Windows asks for permission)...');
    const r = await window.api.removeLeftoverPostgres(form);
    if (!r.success) { setStatus(r.error); return false; }
    setFound(null);
    setForm((f) => ({ ...f, adminPassword: '' }));
    setInfo((i) => ({ ...i, removed: true }));
    return true;
  };

  if (!info || !info.show) return null;
  // Nothing left to look in: only the result shows, and the section is gone next time Settings opens.
  if (info.removed) {
    return (
      <section className="settings-section leftovers">
        <h3>Leftovers from moving the database</h3>
        <div className="setup-test-status leftovers-status">PostgreSQL is removed from this PC. The app stays, and keeps using the database on your other PC.</div>
      </section>
    );
  }
  const mb = (bytes) => `${Math.max(1, Math.round(bytes / 1048576))} MB`;
  return (
    <section className="settings-section leftovers">
      <h3>Leftovers from moving the database</h3>
      <div className="alerts-help">
        Moving the database leaves a copy behind: the one on the PC it moved away from, and on the PC it moved to, a
        database that was already there under the same name (kept as "..._before_move_..."). Neither is used. Type
        PostgreSQL's master password on this PC to look for them. The database the app uses is never listed.
      </div>
      <div className="settings-row">
        <label>Master password <input type="password" className="leftovers-password" value={form.adminPassword} onChange={set('adminPassword')} /></label>
        <label>Port <input type="text" className="leftovers-port" value={form.port} onChange={set('port')} style={{ width: '70px' }} /></label>
        <button className="leftovers-look" onClick={look} disabled={working || !form.adminPassword}>Look for leftovers</button>
      </div>
      {found && found.leftovers.length === 0 && <div className="status leftovers-none">Nothing left over from a move on this PC.</div>}
      {found && found.leftovers.length > 0 && (
        <ul className="leftovers-list">
          {found.leftovers.map((l) => (
            <li key={l.name}>
              <strong>{l.name}</strong> ({mb(l.bytes)}):{' '}
              {l.kind === 'kept' ? 'the copy that was here when the database moved here' : `left here when the database moved to ${l.movedTo}`}{' '}
              <RemoveButton what={`"${l.name}"`} label="Remove" title="Remove this unused copy" onRemove={() => remove(l.name)}>
                <p>This deletes the unused copy "{l.name}" from this PC's PostgreSQL. It can't be undone.</p>
                <p>The database the app uses isn't touched.</p>
              </RemoveButton>
            </li>
          ))}
        </ul>
      )}
      {found && found.canRemovePostgres && (
        <div className="leftovers-postgres">
          <p>Only leftovers are in PostgreSQL on this PC, and the app installed it, so PostgreSQL itself can go too. The app stays.</p>
          <RemoveButton what="PostgreSQL from this PC" label="Remove PostgreSQL from this PC" title="Uninstall PostgreSQL and its databases" onRemove={removePostgres}>
            <p>This uninstalls PostgreSQL from this PC, with the leftover copies in it. Windows asks for permission.</p>
            <p>The app stays, and keeps using the database on your other PC.</p>
          </RemoveButton>
        </div>
      )}
      {status && <div className="setup-test-status leftovers-status">{status}</div>}
    </section>
  );
}

// The details as text, for the Copy button. The password is never included.
function setupDetailsText(details, address) {
  return [
    `Address: ${address || '(see Setup Help on the database PC)'}`,
    `Port: ${details.port}`,
    `Database: ${details.database}`,
    `Username: ${details.user}`,
    'Password: the same one as on the database PC',
  ].join('\n');
}

function SetupPlugin({ details, onConnect }) {
  return (
    <div className="setup-steps">
      <p>
        The plugin runs inside the game (through Dalamud, the plugin system of XIVLauncher). While you play, or
        while AutoRetainer runs your characters, it sends your characters, subs, retainers and inventories to the
        database. Install it on every PC that plays the game; a PC that only shows the app doesn't need it.
      </p>
      <h4>1. Add the repositories</h4>
      <ol>
        <li>In the game, type <code>/xlsettings</code> and open the <strong>Experimental</strong> tab.</li>
        <li>Under <strong>Custom Plugin Repositories</strong>, paste each address into the empty box and click <strong>+</strong>:
          <div className="setup-repo-name">XIV Fleet Companion</div>
          <SetupLine text={details.pluginRepo} />
          {details.companionPlugins.filter((p) => p.repo).map((p) => (
            <React.Fragment key={p.name}>
              <div className="setup-repo-name">{p.name}{p.need === 'optional' ? ' (optional)' : ''}</div>
              <SetupLine text={p.repo} />
            </React.Fragment>
          ))}
        </li>
        <li>Tick <strong>Enabled</strong> next to each, then click <strong>Save and Close</strong>.</li>
      </ol>
      <h4>2. Install them</h4>
      <p>Type <code>/xlplugins</code>, search for <strong>XIV Fleet Companion</strong> and click <strong>Install</strong>. Install the plugins it works with the same way:</p>
      <table className="setup-plugins">
        <tbody>
          {details.companionPlugins.map((p) => (
            <tr key={p.name}>
              <th>{p.name}</th>
              <td>{p.need}</td>
              <td>{p.what}</td>
              <td className="alerts-help">{p.repo ? 'from the repository above' : "in Dalamud's own list"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="alerts-help">Only playing retainers? You can skip Submarine Tracker. Dalamud keeps them all up to date from then on.</p>
      <p className="setup-thanks">
        XIV Fleet Companion couldn't work without these plugins. A big thank you to their makers:{' '}
        {details.companionPlugins.map((p, i) => `${p.by} (${p.name})${i < details.companionPlugins.length - 1 ? ', ' : '.'}`).join('')}
      </p>
      <h4>3. Connect it to the database</h4>
      <ol>
        <li>Type <code>/xivfleet</code> and open its settings.</li>
        <li>Enter the address, port, database name, username and password: the same as in this app (<button className="link-button" onClick={onConnect}>see Connect another PC</button>). The password is kept in Windows Credential Manager.</li>
        <li>Under <strong>Characters</strong>, choose who to sync: everyone AutoRetainer knows (the default), or only the ones you tick.</li>
      </ol>
      <h4>4. Check it</h4>
      <ol>
        <li>Type <code>/xivfleet check</code>: it lists, character by character, what the plugin can see and what to open in the game to fill any gaps.</li>
        <li>In this app, the <strong>PCs</strong> tab shows every PC running the plugin, its version and when it last synced.</li>
      </ol>
    </div>
  );
}

function SetupTailscale({ details }) {
  const otherHost = details.databaseHere ? '' : (details.choices[0] ? details.choices[0].address : '');
  const [address, setAddress] = useState(otherHost);
  const [status, setStatus] = useState('');
  const [testing, setTesting] = useState(false);
  const test = async () => {
    setTesting(true);
    setStatus('Testing...');
    const r = await window.api.testSetupAddress(address);
    setTesting(false);
    setStatus(r.success ? `Connected: this PC can reach the database at ${address.trim()}.` : r.error);
  };

  return (
    <div className="setup-steps">
      <p>
        Tailscale links your PCs privately over the internet, as if they were on the same home network. The app
        and the plugin on any of your PCs can then reach the database PC wherever they are, with nothing to change
        on your router. It's free for personal use. All your PCs on one home network? You can skip Tailscale and
        use the database PC's home network address instead.
      </p>
      <p className="alerts-help">This PC: {details.tailscaleRunning ? 'Tailscale is running.' : 'Tailscale isn\'t running (or isn\'t installed).'}</p>
      <h4>1. Make an account</h4>
      <ol><li>Go to <code>tailscale.com</code>, click <strong>Get started</strong> and sign up (a Google, Microsoft or GitHub login works).</li></ol>
      <h4>2. Install it on every PC</h4>
      <ol>
        <li>Download Tailscale for Windows from <code>tailscale.com/download</code> and install it on the database PC and on every PC that runs the app or the game.</li>
        <li>On each one, click the Tailscale icon by the clock and <strong>Log in</strong> with the <strong>same account</strong>. PCs on different accounts can't see each other.</li>
      </ol>
      <h4>3. Find the database PC's address</h4>
      <ol>
        <li>On the database PC, open this app's <strong>Setup Help → Connect another PC</strong>: the Tailscale address is shown there (it looks like <code>100.x.x.x</code>).</li>
        <li>Or click the Tailscale icon by the clock on the database PC: its address is at the top of the menu.</li>
        <li>Use that as the address in the app and the plugin on your other PCs.</li>
      </ol>
      <h4>4. Test the connection</h4>
      <p className="alerts-help">On the PC you're setting up, type the database PC's address. The test uses the database name, username and password saved on this PC.</p>
      <div className="settings-row">
        <label>Address <input type="text" className="setup-test-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="100.x.x.x" /></label>
        <button onClick={test} disabled={testing}>Test connection</button>
      </div>
      {status && <div className="setup-test-status">{status}</div>}
      <h4>If other PCs can't connect</h4>
      <p className="alerts-help">
        On the database PC, <strong>Setup Help → Connect another PC → Let other PCs connect</strong> does all of this
        for you. To do it by hand instead (once, on the database PC):
      </p>
      <ol>
        <li>
          <strong>Let PostgreSQL listen for other PCs.</strong> Open <code>postgresql.conf</code> in PostgreSQL's data
          folder (usually <code>C:\Program Files\PostgreSQL\&lt;version&gt;\data</code>) in Notepad, run as administrator.
          Find the <code>listen_addresses</code> line and change it to:
          <SetupLine text="listen_addresses = '*'" />
        </li>
        <li>
          <strong>Let your PCs in.</strong> In <code>pg_hba.conf</code> in the same folder, add this line at the end
          (it lets in any of your Tailscale PCs, with the password):
          <SetupLine text="host all all 100.64.0.0/10 scram-sha-256" />
          For PCs on your home network instead, add:
          <SetupLine text="host all all 192.168.0.0/16 scram-sha-256" />
        </li>
        <li><strong>Restart PostgreSQL:</strong> open <strong>Services</strong> from the Start menu, right-click the one named <code>postgresql-x64-…</code> and click <strong>Restart</strong>.</li>
        <li>
          <strong>Open the firewall.</strong> Right-click the Start button, open <strong>Terminal (Admin)</strong> and paste:
          <SetupLine text={`New-NetFirewallRule -DisplayName "PostgreSQL" -Direction Inbound -Protocol TCP -LocalPort ${details.port} -Action Allow`} />
        </li>
      </ol>
    </div>
  );
}
