// PCs tab: every PC running the plugin (0.10.0 and later, with database version 8), what it found and could not
// see at its last sync, and its last "Check what I can see" result (ipc/details.js).

const pcAgo = (at) => {
  if (!at) return 'never';
  const minutes = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} days ago`;
};
const pcYes = (value) => (value ? 'Yes' : value === false ? 'No' : '—');

// Compares "0.10.0"-style versions.
function pcVersionCompare(a, b) {
  const pa = String(a || '0').split('.').map(Number);
  const pb = String(b || '0').split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

function PcProblemsCell({ problems }) {
  const list = problems || [];
  return (
    <td className="pcs-problems">
      {list.length === 0 ? 'Nothing' : (
        <details>
          <summary>{list.length} thing{list.length === 1 ? '' : 's'}</summary>
          <ul>{list.map((text) => <li key={text}>{text}</li>)}</ul>
        </details>
      )}
    </td>
  );
}

// ctx.newest: the newest plugin version any PC runs; ctx.minVersion: the oldest this app works fully with.
const PC_COLUMN_DEFS = [
  {
    key: 'pc', label: 'PC', locked: true, sort: (p) => p.pc_name,
    td: (p, ctx) => (
      <td>
        {p.pc_name}
        <RemoveButton what={`${p.pc_name}${p.account_label ? ` (${p.account_label})` : ''}`} title="Remove this PC from the list (a PC no longer used, or renamed)"
          onRemove={() => ctx.onRemove(p)}>
          <p>This removes the PC's row and its last "Check what I can see" result. Characters and their data stay.</p>
          <p>If the plugin still runs there, the PC comes back at its next sync.</p>
        </RemoveButton>
      </td>
    ),
  },
  { key: 'account', label: 'Account', cell: (p) => p.account_label || '—', sort: (p) => p.account_label },
  {
    key: 'plugin', label: 'Plugin',
    td: (p, ctx) => {
      const tooOld = pcVersionCompare(p.plugin_version, ctx.minVersion) < 0;
      const old = pcVersionCompare(p.plugin_version, ctx.newest) < 0;
      const title = tooOld ? `Too old for this app: update the plugin to ${ctx.minVersion} or newer` : old ? `Older than ${ctx.newest} on another PC` : '';
      return <td className={tooOld ? 'supply-danger' : old ? 'supply-warn' : ''} title={title}>{p.plugin_version || '—'}{tooOld ? ' (update)' : ''}</td>;
    },
    sort: (p) => String(p.plugin_version || '').split('.').map((n) => n.padStart(5, '0')).join('.'),
  },
  { key: 'last_sync', label: 'Last sync', cell: (p) => pcAgo(p.last_sync_at), sort: (p) => (p.last_sync_at ? -Date.parse(p.last_sync_at) : null) },
  { key: 'characters', label: 'Characters', cell: (p) => `${p.characters_synced ?? '—'}${p.characters_left_out ? ` (${p.characters_left_out} left out)` : ''}`, sort: (p) => p.characters_synced },
  {
    key: 'autoretainer', label: 'AutoRetainer',
    td: (p) => <td className={p.autoretainer_ready === false ? 'supply-warn' : ''} title="AutoRetainer running (needed: nothing syncs without it)">{pcYes(p.autoretainer_ready)}</td>,
    sort: (p) => pcYes(p.autoretainer_ready),
  },
  { key: 'allagan', label: 'Allagan Tools', td: (p) => <td className={p.allagantools_ready === false ? 'supply-warn' : ''} title="Allagan Tools running (bags, retainers' items, FC chests and listings)">{pcYes(p.allagantools_ready)}</td>, sort: (p) => pcYes(p.allagantools_ready) },
  { key: 'fctracker', label: 'FC Tracker', td: (p) => <td title="FC Tracker running in that game (optional: Free Company house details).">{pcYes(p.fctracker_found)}</td>, sort: (p) => pcYes(p.fctracker_found) },
  { key: 'subtracker', label: 'Submarine Tracker', td: (p) => <td title="Submarine Tracker running in that game (loot per voyage; only needed with subs).">{pcYes(p.submarinetracker_found)}</td>, sort: (p) => pcYes(p.submarinetracker_found) },
  {
    key: 'ventures', label: 'Venture Log',
    td: (p) => <td title="AutoRetainer's venture statistics files found: what each retainer's ventures brought back, for venture income (only with retainers)">{pcYes(p.venture_stats_found)}</td>,
    sort: (p) => pcYes(p.venture_stats_found),
  },
  { key: 'problems', label: 'Could not see', td: (p) => <PcProblemsCell problems={p.problems} />, sort: (p) => (p.problems || []).length },
];

function PcsView({ refreshKey }) {
  const pcSort = useColumnSort();
  const pcCols = useTableColumns({ tableKey: 'pcs', ownDefs: PC_COLUMN_DEFS, rows: null, idOf: () => null });
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const [removeError, setRemoveError] = useState(null);
  const load = () => window.api.getPcs().then((result) => {
    if (result.success) { setData(result); setError(null); } else setError(result.error);
  });

  useEffect(() => { load(); }, [refreshKey]);

  // A PC no longer used (or renamed) stays listed until removed here.
  const removePc = async (p) => {
    const result = await window.api.removePc(p.pc_name, p.account_label);
    if (!result.success) { setRemoveError(result.error); return false; }
    setRemoveError(null);
    await load();
    return true;
  };

  if (error) return <div className="error">Failed to load: {error}</div>;
  if (data === null) return <div className="status">Loading...</div>;
  if (data.missing) {
    return (
      <div className="supplies-note pcs-missing" style={{ paddingTop: '16px' }}>
        The database doesn't have the PCs table yet. The app adds it when it connects; if it couldn't, the banner at the top says why.
        Each PC then reports here at its next sync.
      </div>
    );
  }
  const newest = data.pcs.reduce((v, p) => (pcVersionCompare(p.plugin_version, v) > 0 ? p.plugin_version : v), '0');
  const minVersion = data.minPluginVersion || '0';
  const tooOld = data.pcs.filter((p) => pcVersionCompare(p.plugin_version, minVersion) < 0);

  return (
    <div className="pcs">
      <div className="supplies-note" style={{ paddingTop: '12px' }}>
        Each PC running the plugin, per account label, as of its last sync. The plugin's "Check what I can see" (/xivfleet check)
        on a PC also shows its result here. A PC no longer used can be removed with the × beside its name.
      </div>
      {removeError && <div className="error">Could not remove the PC: {removeError}</div>}
      {data.moved && data.moved.waiting.length > 0 && (
        <div className="pcs-update-plugin pcs-moved" role="status">
          <strong>The database moved here from {data.moved.from} {pcAgo(data.moved.at)}.</strong> Still to switch over:
          {' '}{data.moved.waiting.join(', ')}. Each switches by itself at its next sync, while {data.moved.from} is still on. A PC
          that's no longer used can be removed with the × beside its name.
        </div>
      )}
      {data.moved && data.moved.waiting.length === 0 && (Date.now() - new Date(data.moved.at).getTime()) < 14 * 24 * 60 * 60 * 1000 && (
        <div className="supplies-note pcs-moved-done" style={{ paddingTop: '8px' }}>
          The database moved here from {data.moved.from} {pcAgo(data.moved.at)}, and every PC has switched over. The old copy on
          {' '}{data.moved.from} isn't used any more; you can remove it there (Settings → Database → Leftovers from moving the database).
        </div>
      )}
      {tooOld.length > 0 && (
        <div className="pcs-update-plugin" role="status">
          <strong>Update the plugin on {tooOld.map((p) => `${p.pc_name}${p.account_label ? ` (${p.account_label})` : ''}`).join(', ')}.</strong>
          {' '}This version of the app needs plugin {data.minPluginVersion} or newer; some columns stay empty until then. In the game:
          type /xlplugins, open Installed Plugins, and update XIV Fleet Companion.
        </div>
      )}
      {data.pcs.length === 0 && <div className="status">No PC has reported yet: update the plugin to 0.10.0 and let it sync.</div>}
      {data.pcs.length > 0 && (
        <React.Fragment>
          <div className="controls"><ColumnPicker cols={pcCols} /></div>
          <ColumnTable cols={pcCols} sort={pcSort} rows={data.pcs} rowKey={(p) => `${p.pc_name}|${p.account_label}`} className="pcs-table" ctx={{ newest, minVersion, onRemove: removePc }} />
        </React.Fragment>
      )}

      {data.pcs.filter((p) => p.check_text).map((p) => (
        <details key={`check|${p.pc_name}|${p.account_label}`} className="account-group pcs-check">
          <summary>
            Check what I can see: {p.pc_name}{p.account_label ? ` (${p.account_label})` : ''}, {pcAgo(p.check_at)},
            {' '}{p.check_to_fix ? `${p.check_to_fix} thing${p.check_to_fix === 1 ? '' : 's'} to fix` : 'nothing to fix'}
          </summary>
          <pre>{p.check_text}</pre>
        </details>
      ))}

      {data.unreported.length > 0 && (
        <div className="warning pcs-unreported">
          No PC has reported for: {data.unreported.map((a) => `${a.account_label || 'no account label'} (${a.characters} character${a.characters === 1 ? '' : 's'}, last synced ${pcAgo(a.last_synced_at)})`).join(', ')}.
          Its PC runs a plugin older than 0.10.0.
        </div>
      )}
    </div>
  );
}
