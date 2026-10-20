// Settings section: backups of the database, made on this PC (normally the one with the database) with
// PostgreSQL's own tools: a daily backup, an optional second copy elsewhere, testing a backup and
// restoring one. Everything here belongs to this PC (ipc/backups.js).

const backupSize = (bytes) => (bytes === null || bytes === undefined ? '' : `${(bytes / 1048576).toFixed(1)} MB`);
const backupWhen = (ms) => (ms ? new Date(ms).toLocaleString() : '');

function BackupsSection() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('');
  const [working, setWorking] = useState('');
  const [confirmRestore, setConfirmRestore] = useState(null);

  const load = async (keepForm) => {
    const r = await window.api.getBackups();
    if (!r || !r.success) { setError((r && r.error) || 'Could not load the backup settings.'); return; }
    setError(null);
    setData(r);
    if (!keepForm) setForm(r.settings);
  };
  useEffect(() => { load(false); }, []);

  if (error) return <section className="settings-section backups-section"><h3>Backups</h3><div className="status">{error}</div></section>;
  if (!data || !form) return <section className="settings-section backups-section"><h3>Backups</h3><div className="status">Loading...</div></section>;

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const busy = !!working;
  const act = async (label, call, after) => {
    setWorking(label);
    setStatus('');
    let message;
    try {
      const r = await call();
      message = r && r.success ? (after ? after(r) : 'Done.') : `${(r && r.error) || 'Something went wrong.'}`;
    } catch (err) {
      message = err.message;
    }
    // What was saved or made is shown before the message, so the buttons match it.
    await load(true);
    setWorking('');
    setStatus(message);
  };
  const choose = async (key, title) => {
    const folder = await window.api.chooseBackupFolder({ title, current: form[key] });
    if (folder) set(key, folder);
  };
  const save = () => act('Saving...', () => window.api.saveBackupSettings(form),
    (r) => `Saved.${form.enabled ? ` Backs up every day at ${form.time}.` : ''}${r.note ? ` ${r.note}` : ''}`);
  // "Restore from a file...": checked as a real backup first, then the same question as Restore.
  const pickFile = async () => {
    setStatus('');
    const r = await window.api.chooseBackupFile();
    if (!r) return;
    if (!r.success) { setStatus(r.error || 'That file could not be used.'); return; }
    setConfirmRestore({ ...r, picked: true });
  };
  // Get the backup tools: progress ("Downloading... 40%") shows where the status goes.
  const getBackupTools = () => {
    const stop = window.api.onBackupToolsProgress((text) => setWorking(text));
    return act('Starting...', () => window.api.getBackupTools(), (r) => `Got the backup tools: ${r.version}.`).finally(stop);
  };
  const takeOverLegacy = () => setForm((f) => ({ ...f, ...data.schedule.legacy.settings, enabled: true }));

  const { tools, schedule, last } = data;
  const unsaved = JSON.stringify(form) !== JSON.stringify(data.settings);

  return (
    <section className="settings-section backups-section">
      <h3>Backups</h3>
      <div className="alerts-help">
        A copy of the whole database, made every day on this PC with PostgreSQL's own tools. Turn this on in the
        app on the PC that has the database, or on any PC once it has the backup tools. Everything here is for this
        PC only.
      </div>

      <div className="backups-last">
        {last
          ? (last.ok
            ? <>Last backup: {backupWhen(last.at)} ({backupSize(last.size)}){last.copyError ? <span className="warning"> The second copy failed: {last.copyError}</span> : ''}</>
            : <span className="warning">The last backup failed ({backupWhen(last.at)}): {last.message}</span>)
          : 'No backup made by the app on this PC yet.'}
      </div>

      {!tools.found && <div className="warning backups-no-tools">{tools.error}</div>}
      {!tools.found && data.windows && (
        <div className="settings-row backups-get-tools">
          <button className="backups-get-tools-button" onClick={getBackupTools} disabled={busy}>Get the backup tools</button>
          <span className="alerts-help">
            For a PC without PostgreSQL. Downloads PostgreSQL from its maker (about {data.toolsDownloadMb} MB, once), keeps
            the 11 MB backups and restores need, and deletes the rest. Nothing is installed.
          </span>
        </div>
      )}

      {schedule.legacy && (
        <div className="settings-row backups-legacy">
          <span className="warning">This PC still has the old backup task from the PowerShell scripts{schedule.legacy.settings.folder ? ` (to ${schedule.legacy.settings.folder})` : ''}.</span>
          <button onClick={takeOverLegacy} disabled={busy}>Use its settings here</button>
          <span className="alerts-help">Then Save: the app makes the backups from then on and the old task is removed.</span>
        </div>
      )}

      <div className="settings-row">
        <label><input type="checkbox" checked={form.enabled} onChange={(e) => set('enabled', e.target.checked)} /> Back up every day at</label>
        <input type="time" className="backups-time" value={form.time} onChange={(e) => set('time', e.target.value)} />
        {schedule.supported
          ? (schedule.installed
            ? <span className="alerts-help">{schedule.current === false ? 'The daily backup starts another copy of the app: Save to use this one.' : `Scheduled${schedule.nextRun ? `; next: ${schedule.nextRun}` : ''}.`}</span>
            : <span className="alerts-help">Not scheduled on this PC.</span>)
          : <span className="alerts-help">Daily backups are scheduled on Windows only.</span>}
      </div>
      <div className="alerts-help">If the PC is off at that time, the backup runs when it is next on (while you are signed in).</div>

      <div className="settings-row">
        <label>Backup folder <input type="text" className="backups-folder" value={form.folder} onChange={(e) => set('folder', e.target.value)} placeholder="E:\FleetBackups" /></label>
        <button onClick={() => choose('folder', 'Where should backups go?')} disabled={busy}>Browse...</button>
        {data.settings.folder && <button onClick={() => window.api.openBackupFolder(data.settings.folder)}>Open</button>}
      </div>
      <div className="settings-row">
        <label>Second copy (optional) <input type="text" className="backups-copy-folder" value={form.copyFolder} onChange={(e) => set('copyFolder', e.target.value)} placeholder="\\LAPTOP\FleetBackups" /></label>
        <button onClick={() => choose('copyFolder', 'Where should the second copy go?')} disabled={busy}>Browse...</button>
        {form.copyFolder && <button onClick={() => set('copyFolder', '')} disabled={busy}>Clear</button>}
      </div>
      <div className="alerts-help">
        A second copy somewhere other than this PC protects against losing the PC itself: another PC's shared folder, a USB
        drive, or a folder synced to OneDrive or Google Drive. If it cannot be reached, the backup itself is still made.
      </div>
      <div className="settings-row">
        <label>Keep the newest <input type="number" min="1" max="365" className="backups-keep" value={form.keep} onChange={(e) => set('keep', Number(e.target.value))} /> backups in each folder</label>
      </div>
      <div className="settings-row">
        <label>PostgreSQL's tools folder <input type="text" className="backups-pgbin" value={form.pgBin} onChange={(e) => set('pgBin', e.target.value)} placeholder={tools.found ? (tools.bin || 'found') : 'not found'} /></label>
        <button onClick={() => choose('pgBin', 'Choose PostgreSQL\'s "bin" folder')} disabled={busy}>Browse...</button>
      </div>
      <div className="alerts-help">
        {tools.found ? `Found: ${tools.version}${tools.bin ? ` in ${tools.bin}` : ''}${tools.fromApp ? ' (from Get the backup tools)' : ''}. ` : ''}Leave it blank unless they are not found: it is the
        "bin" folder of PostgreSQL's install, with pg_dump.exe in it.
      </div>

      <div className="settings-row">
        <button onClick={save} disabled={busy}>Save</button>
        <button onClick={() => act('Backing up...', () => window.api.backUpNow(), (r) => r.message)} disabled={busy || unsaved || !data.settings.folder || !tools.found}>Back up now</button>
        {unsaved && <span className="alerts-help">Save first.</span>}
        {(working || status) && <span className="save-status backups-status">{working || status}</span>}
      </div>

      <h4>Backups in {data.settings.folder || 'the backup folder'}</h4>
      <div className="settings-row">
        <button className="backups-pick" onClick={pickFile} disabled={busy || !tools.found || !data.settings.folder}>Restore from a file...</button>
        <span className="alerts-help">{data.settings.folder
          ? "A backup from anywhere else, such as a USB drive or another PC's backup folder."
          : 'Choose and save a backup folder first: the database as it is now is backed up there before restoring.'}</span>
      </div>
      {data.backups.length === 0
        ? <div className="status">None yet.</div>
        : (
          <table className="backups-list">
            <thead><tr><th>Taken</th><th>Size</th><th></th></tr></thead>
            <tbody>
              {data.backups.map((b) => (
                <tr key={b.name}>
                  <td>{backupWhen(b.takenAt)}</td>
                  <td>{backupSize(b.size)}</td>
                  <td>
                    <button onClick={() => act('Testing the backup (loading it into a temporary database)...', () => window.api.testBackup(b.file), (r) => r.message)} disabled={busy || !tools.found}>Test</button>
                    <button onClick={() => setConfirmRestore(b)} disabled={busy || !tools.found}>Restore...</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      {data.settings.copyFolder && <div className="alerts-help">Second copies in {data.settings.copyFolder}: {data.copies.length}{data.copies[0] ? `, newest ${backupWhen(data.copies[0].takenAt)}` : ''}.</div>}
      <div className="alerts-help">Test loads a backup into a temporary database and compares it with the live one; nothing is changed.</div>

      {data.log.length > 0 && (
        <details className="backups-log">
          <summary>Backup log</summary>
          <pre>{data.log.join('\n')}</pre>
        </details>
      )}

      {confirmRestore && ReactDOM.createPortal(
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setConfirmRestore(null); }}>
          <div className="modal backups-confirm" role="dialog" aria-label="Restore a backup">
            <h2>{confirmRestore.picked ? `Restore ${confirmRestore.name} (${backupWhen(confirmRestore.takenAt)})?` : `Restore the backup from ${backupWhen(confirmRestore.takenAt)}?`}</h2>
            <p>The whole database goes back to how it was then: everything recorded since (by every PC) is replaced.</p>
            <p>First, the database as it is now is backed up, so this can be undone by restoring that backup. If anything goes
              wrong while restoring, nothing is changed.</p>
            <div className="modal-actions">
              <button onClick={() => setConfirmRestore(null)}>Cancel</button>
              <button className="danger" onClick={() => {
                const b = confirmRestore;
                setConfirmRestore(null);
                act('Restoring (backing up first)...', () => (b.picked ? window.api.restoreBackupFile(b.file) : window.api.restoreBackup(b.file)), (r) => r.message);
              }}>Restore</button>
            </div>
          </div>
        </div>,
        document.body)}
    </section>
  );
}
