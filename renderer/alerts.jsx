// Settings section: Discord alerts. The choices are shared by every PC (saved in the database); the
// webhook and the 5-minute scheduled check belong to the PC that sends the alerts.

const alertMinutesToTime = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const alertTimeToMinutes = (t) => {
  const [h, m] = String(t || '').split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : 0;
};

// Why the Discord Alerts tab needs a look, or null: alerts are on but no check has ever run (not set
// up yet), or the last one was more than 15 minutes ago (three missed 5-minute checks: the alert PC is
// off, signed out, or its scheduled task stopped). "Last check" is shared, so this works on any PC.
const ALERTS_STALE_SECONDS = 15 * 60;
function alertsNeedAttention(settings, nowSeconds = Date.now() / 1000) {
  if (!settings || !settings.enabled) return null;
  if (!settings.lastCheckAt) return 'Discord alerts are not set up yet: no alert check has run.';
  if (nowSeconds - settings.lastCheckAt > ALERTS_STALE_SECONDS) {
    return `No alert check since ${alertAgo(settings.lastCheckAt)}. Is the alert PC on, and are automatic checks on?`;
  }
  return null;
}

function alertAgo(unixSeconds) {
  if (!unixSeconds) return 'never';
  const minutes = Math.round((Date.now() / 1000 - unixSeconds) / 60);
  if (minutes < 1) return 'just now';
  if (minutes < 120) return `${minutes} min ago`;
  return new Date(unixSeconds * 1000).toLocaleString();
}

// The "How to set this up" popup: every step, in order, and what to do when something does not work.
function AlertsSetupHelp({ onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return ReactDOM.createPortal(
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal alerts-setup-help" role="dialog" aria-label="Setting up Discord alerts">
        <h2>Setting up Discord alerts</h2>
        <p>Do this once, in the app on the PC that is always on (the one with the database). The choices
          (which alerts, the numbers, quiet hours) can be changed later from any PC.</p>
        <ol>
          <li>
            <strong>Make a webhook in Discord.</strong> Pick the channel the alerts should go to (a private
            one is best). Hover over it → the gear (Edit Channel) → <em>Integrations</em> → <em>Webhooks</em> →
            <em> New Webhook</em> → <em>Copy Webhook URL</em>. Anyone with this address can post in that
            channel, so keep it to yourself.
          </li>
          <li>
            <strong>Save it here.</strong> Paste it into <em>Discord webhook</em> under <em>This PC</em> and click
            <em> Save</em>. It is kept encrypted for your Windows account on this PC only.
          </li>
          <li>
            <strong>Find your Discord user ID</strong> (so the alerts ping your phone). In Discord:
            <em> User Settings</em> → <em>Advanced</em> → turn on <em>Developer Mode</em>. Then right-click your
            own name (in a member list or a message) → <em>Copy User ID</em>. It is 17 to 20 digits.
          </li>
          <li>
            <strong>Save your choices.</strong> Paste the ID into <em>Your Discord user ID</em>, check the
            alerts and numbers (the defaults are fine to start), set quiet hours if you want them, and click
            <em> Save Alert Settings</em>.
          </li>
          <li>
            <strong>Send a test.</strong> Click <em>Send Test Message</em>. A "Test message from Fleet Companion"
            should appear in the channel within a few seconds, pinging you.
          </li>
          <li>
            <strong>Turn on automatic checks.</strong> Click <em>Check every 5 minutes</em>. This adds a Windows
            scheduled task, "Fleet Companion alerts", that checks in the background (no window opens). It runs
            while you are signed in to Windows, like the nightly backup.
          </li>
          <li>
            <strong>Confirm it is running.</strong> Within about 5 minutes, <em>Last check</em> at the top of this
            section should say "just now" or a few minutes ago (on any PC). The first check posts everything
            that needs attention right now, in one message.
          </li>
        </ol>
        <h3>If something does not work</h3>
        <ul>
          <li><strong>The test message fails:</strong> the message under the buttons says why. "No longer exists"
            means the webhook was deleted in Discord: Remove it here and paste a new one.</li>
          <li><strong>The message arrives but does not ping you:</strong> check the user ID (your own, not the
            channel's or the server's), and that the channel's notifications are not muted.</li>
          <li><strong>"Last check" does not update:</strong> make sure you are signed in to Windows on the alert
            PC and that <em>Automatic checks</em> says <em>on</em>; turn them off and on again if needed. Each
            check is logged in <code>alerts.log</code> in <code>%APPDATA%\XIV Fleet Companion</code>.</li>
          <li><strong>Too many messages:</strong> raise the hours, turn off the alerts you do not need, or use quiet
            hours. A problem is only repeated every few hours while it lasts.</li>
        </ul>
        <div className="modal-actions">
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// onLoaded(settings): told whenever the saved settings are (re)loaded, so the tab's dot stays current.
function AlertsSection({ onLoaded = () => {} }) {
  const [s, setS] = useState(null);
  const [thisPc, setThisPc] = useState({ webhookSaved: false, schedule: { supported: false, installed: false } });
  const [modeNow, setModeNow] = useState({ mode: 'normal', reason: null });
  const [error, setError] = useState('');
  const [webhookInput, setWebhookInput] = useState('');
  const [quietHours, setQuietHours] = useState('8');
  const [pauseHours, setPauseHours] = useState('8');
  const [status, setStatus] = useState('');
  const [showHelp, setShowHelp] = useState(false);

  function load() {
    window.api.getAlertSettings().then((result) => {
      setThisPc({ webhookSaved: result.webhookSaved, schedule: result.schedule || { supported: false, installed: false } });
      if (result.success) {
        setS(result.settings);
        onLoaded(result.settings);
        setModeNow(result.now || { mode: 'normal', reason: null });
        setError('');
      } else {
        setError(result.error);
      }
    });
  }
  useEffect(load, []);

  const set = (key, value) => setS((prev) => ({ ...prev, [key]: value }));
  async function act(label, call) {
    setStatus(`${label}...`);
    const result = await call();
    setStatus(result.success ? `${label}: done.${result.note ? ` ${result.note}` : ''}` : `${label} failed: ${result.error}`);
    // Reload only after a change went through, so a correction typed after a refusal is not overwritten.
    if (result.success) load();
    return result;
  }

  if (error && !s) return (
    <section className="settings-section alerts-section">
      <h3>Discord Alerts</h3>
      <div className="status">Could not load the alert settings: {error}</div>
    </section>
  );
  if (!s) return (
    <section className="settings-section alerts-section">
      <h3>Discord Alerts</h3>
      <div className="status">Loading...</div>
    </section>
  );

  const numberInput = (key, width = '60px', step = '1') => (
    <input type="number" step={step} value={s[key]} onChange={(e) => set(key, e.target.value === '' ? '' : Number(e.target.value))} style={{ width }} />
  );
  const check = (key) => <input type="checkbox" checked={!!s[key]} onChange={(e) => set(key, e.target.checked)} />;
  const untilText = (t) => (t && t * 1000 > Date.now()
    ? new Date(t * 1000).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })
    : null);
  const quietUntilText = untilText(s.quietUntil);
  const pausedUntilText = untilText(s.pausedUntil);

  return (
    <section className="settings-section alerts-section">
      <h3 className="alerts-title">
        Discord Alerts
        <button className="alerts-help-button" onClick={() => setShowHelp(true)}>How to set this up</button>
      </h3>
      {showHelp && <AlertsSetupHelp onClose={() => setShowHelp(false)} />}
      <div className="status alerts-last-check">
        Last check: {alertAgo(s.lastCheckAt)}{modeNow.reason ? ` · ${modeNow.reason}` : ''}
      </div>
      {alertsNeedAttention(s) && <div className="alerts-attention">{alertsNeedAttention(s)} See "How to set this up".</div>}

      <div className="settings-row">
        <label>{check('enabled')} Send alerts to Discord</label>
      </div>

      <h4>This PC</h4>
      <div className="alerts-help">The PC that sends the alerts (the one that is always on) keeps the Discord webhook and checks every 5 minutes. Other PCs only change the choices below.</div>
      {thisPc.webhookSaved ? (
        <div className="settings-row">
          <span className="alerts-webhook-saved">Discord webhook saved on this PC.</span>
          <button onClick={() => act('Remove webhook', () => window.api.clearAlertWebhook())}>Remove</button>
        </div>
      ) : (
        <div className="settings-row">
          <label>
            Discord webhook{' '}
            <input type="password" className="alerts-webhook" value={webhookInput} onChange={(e) => setWebhookInput(e.target.value)} placeholder="https://discord.com/api/webhooks/..." style={{ width: '300px' }} />
          </label>
          <button onClick={async () => {
            const result = await act('Save webhook', () => window.api.saveAlertWebhook(webhookInput));
            if (result.success) setWebhookInput('');
          }}>Save</button>
        </div>
      )}
      {!thisPc.webhookSaved && <div className="alerts-help">In Discord: Edit Channel → Integrations → Webhooks → New Webhook → Copy Webhook URL. Keep it private: anyone with it can post in that channel.</div>}
      {thisPc.webhookSaved && (
        <div className="settings-row">
          {thisPc.schedule.supported ? (
            thisPc.schedule.installed && thisPc.schedule.current === false ? (
              <>
                <span className="warning">Automatic checks run another copy of the app (for example the one you used before installing it).</span>
                <button onClick={() => act('Turn on checks', () => window.api.installAlertSchedule())}>Use this copy</button>
              </>
            ) : thisPc.schedule.installed ? (
              <>
                <span>Automatic checks: <strong>on</strong>, every 5 minutes while you are signed in to Windows.</span>
                <button onClick={() => act('Turn off checks', () => window.api.removeAlertSchedule())}>Turn off</button>
              </>
            ) : (
              <>
                <span>Automatic checks: <strong>off</strong>.</span>
                <button onClick={() => act('Turn on checks', () => window.api.installAlertSchedule())}>Check every 5 minutes</button>
              </>
            )
          ) : (
            <span>Automatic checks can only be set up on Windows.</span>
          )}
        </div>
      )}

      <h4>Who to @mention</h4>
      <div className="settings-row">
        <label>
          Your Discord user ID{' '}
          <input type="text" className="alerts-mention" value={s.mentionUserId} onChange={(e) => set('mentionUserId', e.target.value.trim())} placeholder="e.g. 123456789012345678" style={{ width: '200px' }} />
        </label>
      </div>
      <div className="alerts-help">In Discord: Settings → Advanced → turn on Developer Mode, then right-click your name → Copy User ID. Leave it blank for no @mention.</div>

      <h4>What to alert about</h4>
      <div className="settings-row"><label>{check('subsOn')} Subs back in port for more than {numberInput('subIdleHours', '60px', '0.5')} hours</label></div>
      <div className="settings-row"><label>{check('retainersOn')} Retainers without a venture for more than {numberInput('retainerIdleMinutes', '70px')} minutes</label></div>
      <div className="settings-row"><label>{check('suppliesOn')} Low ceruleum or repair kits (the warnings on the General tab)</label></div>
      <div className="settings-row"><label>{check('houseOn')} FC house not entered (the house warning on the General tab)</label></div>
      <div className="settings-row"><label>{check('syncOn')} Plugin has sent nothing new for {numberInput('syncStaleMinutes', '70px')} minutes</label></div>
      <div className="settings-row"><label>{check('buildOn')} A sub is ready for new parts (its rank calls for the next build on the Parts tab)</label></div>
      <div className="settings-row"><label>{check('undercutOn')} Someone sells cheaper than your listings on the same world (needs Live Market Prices on the General tab; checked every 30 minutes)</label></div>
      <div className="settings-row"><label>{check('backupOn')} The database backup on this PC failed, or none for 2 days (Settings → Backups)</label></div>
      <div className="settings-row"><label>Repeat a problem that is still going every {numberInput('repeatHours')} hours</label></div>
      <div className="settings-row"><label>Send at most one message every {numberInput('minGapMinutes')} minutes</label></div>
      <div className="alerts-help">Problems found in between wait and go out together in the next message, and one that comes and goes in between is not posted at all. 0 posts each check's news straight away.</div>

      <h4>Pause or quiet</h4>
      <div className="settings-row alerts-pause">
        {pausedUntilText ? (
          <>
            <span className="alerts-paused-until">Paused until {pausedUntilText}: nothing is posted.</span>
            <button onClick={() => act('Resume', () => window.api.pauseAlertsFor(0))}>Resume now</button>
          </>
        ) : (
          <>
            <label>Pause alerts for the next <input type="number" min="1" max="72" value={pauseHours} onChange={(e) => setPauseHours(e.target.value)} style={{ width: '50px' }} /> hours</label>
            <button onClick={() => act('Pause', () => window.api.pauseAlertsFor(Number(pauseHours)))}>Pause</button>
          </>
        )}
      </div>
      <div className="settings-row alerts-quiet-for">
        {quietUntilText ? (
          <>
            <span className="alerts-quiet-until">Quiet (no @mention) until {quietUntilText}.</span>
            <button onClick={() => act('End quiet time', () => window.api.setAlertsQuietFor(0))}>End quiet time now</button>
          </>
        ) : (
          <>
            <label>Quiet (no @mention) for the next <input type="number" min="1" max="72" value={quietHours} onChange={(e) => setQuietHours(e.target.value)} style={{ width: '50px' }} /> hours</label>
            <button onClick={() => act('Quiet time', () => window.api.setAlertsQuietFor(Number(quietHours)))}>Start</button>
          </>
        )}
      </div>
      <div className="alerts-help">Pause: nothing is posted; whatever is still wrong when it ends goes out in one message. Quiet: messages still arrive, without pinging you. Both end by themselves.</div>

      <h4>Quiet hours</h4>
      <div className="settings-row">
        <label>{check('quietOn')} Every day from{' '}
          <input type="time" className="alerts-quiet-start" value={alertMinutesToTime(s.quietStart)} onChange={(e) => set('quietStart', alertTimeToMinutes(e.target.value))} />
          {' '}to{' '}
          <input type="time" className="alerts-quiet-end" value={alertMinutesToTime(s.quietEnd)} onChange={(e) => set('quietEnd', alertTimeToMinutes(e.target.value))} />
        </label>
      </div>
      <div className="settings-row">
        <span>During quiet hours:</span>
        <label><input type="radio" name="alertQuietMode" checked={s.quietMode === 1} onChange={() => set('quietMode', 1)} /> hold alerts until they end</label>
        <label><input type="radio" name="alertQuietMode" checked={s.quietMode === 2} onChange={() => set('quietMode', 2)} /> post them without the @mention</label>
      </div>
      <div className="alerts-help">For a changing sleep schedule: set your usual hours here, and use Pause or Quiet above for nights that differ. Times are the alert PC's clock.</div>

      <h4>Summary</h4>
      <div className="settings-row alerts-summary">
        <label>Post a summary{' '}
          <select className="alerts-summary-every" value={s.summaryEvery} onChange={(e) => set('summaryEvery', Number(e.target.value))}>
            <option value={0}>never</option>
            <option value={1}>every day</option>
            <option value={7}>every week</option>
          </select>
        </label>
        {s.summaryEvery === 7 && (
          <label>on{' '}
            <select className="alerts-summary-day" value={s.summaryDay} onChange={(e) => set('summaryDay', Number(e.target.value))}>
              {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select>
          </label>
        )}
        {s.summaryEvery > 0 && (
          <label>at{' '}
            <input type="time" className="alerts-summary-time" value={alertMinutesToTime(s.summaryTime)} onChange={(e) => set('summaryTime', alertTimeToMinutes(e.target.value))} />
          </label>
        )}
        <button disabled={!thisPc.webhookSaved} title={thisPc.webhookSaved ? 'Post the summary now' : 'Save the webhook on this PC first'} onClick={() => act('Summary', () => window.api.sendAlertSummary())}>Send Summary Now</button>
      </div>
      <div className="alerts-help">One quiet message (no @mention): gil earned, loot and venture rewards, subs that ranked up or are ready for new parts, and supplies running out within a week. It waits while alerts are paused or held for quiet hours.</div>

      <div className="settings-row alerts-actions">
        <button onClick={() => act('Save alert settings', () => window.api.saveAlertSettings(s))}>Save Alert Settings</button>
        <button disabled={!thisPc.webhookSaved} title={thisPc.webhookSaved ? '' : 'Save the webhook on this PC first'} onClick={() => act('Test message', () => window.api.sendTestAlert(s.mentionUserId))}>Send Test Message</button>
        <button disabled={!thisPc.webhookSaved} title={thisPc.webhookSaved ? 'Run a check now and post anything new' : 'Save the webhook on this PC first'} onClick={() => act('Check', () => window.api.checkAlertsNow())}>Check Now</button>
      </div>
      {status && <div className="save-status alerts-status">{status}</div>}
    </section>
  );
}
