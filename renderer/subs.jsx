// Subs tab: each submarine's status, build, rank and route, with the Craft? toggle.

function formatCountdown(secondsRemaining) {
  const clamped = Math.max(0, secondsRemaining);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = Math.floor(clamped % 60);
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

// Status cell for a sub row: In Port, Returned / Awaiting Collection, or
// while it is out, a live HH:MM:SS countdown to return_time. Only ticks
// while it is out - no timer runs for In Port or Returned rows.
function SubStatusCell({ returnTime }) {
  const [nowEpoch, setNowEpoch] = useState(() => Math.floor(Date.now() / 1000));
  const returnEpoch = returnTime ? Number(returnTime) : 0;
  const isDeployed = returnEpoch > 0 && returnEpoch > nowEpoch;

  useEffect(() => {
    if (!isDeployed) return;
    const interval = setInterval(() => setNowEpoch(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(interval);
  }, [isDeployed]);

  if (!returnEpoch) return 'In Port';
  if (!isDeployed) return 'Returned / Awaiting Collection';
  return formatCountdown(returnEpoch - nowEpoch);
}

// Groups rows by character WITHOUT re-sorting - order of first
// appearance in the (already sort_index-ordered) row list is preserved,
// same reasoning as before. Plain function, not a hook, so it can be
// called once for the whole list OR once per account sub-group.
function groupSubsByCharacter(rows) {
  const order = [];
  const groups = {};
  for (const row of rows) {
    const key = `${row.character_name} (${row.world})`;
    if (!groups[key]) {
      groups[key] = [];
      order.push(key);
    }
    groups[key].push(row);
  }
  return order.map((key) => [key, groups[key]]);
}

// Rank displayed as rank.progress (e.g. "68.81" = rank 68, 81% of the
// way to 69), matching AutoRetainer's own in-game display convention.
// Progress omitted if unknown (rank blank/null).
function formatRank(rank, progressPct) {
  if (rank === null || rank === undefined) return '—';
  if (progressPct === null || progressPct === undefined) return String(rank);
  return `${rank}.${String(progressPct).padStart(2, '0')}`;
}

function formatGilDay(value) {
  return value === '' || value === null || value === undefined ? '—' : Number(value).toLocaleString();
}

// "in 2d 5h" / "in 7h" / "in 40 min" until a time; "now" once it is past.
function formatTimeUntil(at, now = Date.now()) {
  const minutes = Math.round((at - now) / 60000);
  if (minutes <= 0) return 'now';
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `in ${hours}h`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `in ${days}d ${hours % 24}h` : `in ${days}d`;
}

// How a sub's rank-up date was worked out, for the hover text. None of them looks ahead to better routes.
const RANK_UP_AHEAD = 'Assumes it carries on as now: moving to higher-experience routes as they unlock, or a faster build, would make it sooner.';
const RANK_UP_ROUTE = 'Assumes it stays on its current route: moving to a higher-experience route would make it sooner.';
function rankUpBasis(r) {
  const later = r.buildAhead ? ' Voyages get shorter as it ranks up and once it switches to its next build.' : ' Voyages get shorter as it ranks up.';
  if (r.method === 'voyages') {
    return `Worked out voyage by voyage: ${r.voyage.exp.toLocaleString()} experience a voyage on its route, ` +
      `including its bonus (×${r.bonus.factor.toFixed(2)} from its last ${r.bonus.voyages} voyages), ${r.voyage.hours.toFixed(1)}h each.${later} ${RANK_UP_ROUTE}`;
  }
  if (r.method === 'measured') {
    return `From its experience over the last week: ${Math.round(r.perDay).toLocaleString()} a day. ${RANK_UP_AHEAD}` +
      (r.outAtSea ? ' Experience comes in when a voyage is collected, so this is when it is back.' : '');
  }
  if (r.method === 'calculated') {
    return `Calculated from its route: ${r.voyage.exp.toLocaleString()} experience per ${r.voyage.hours.toFixed(1)}h voyage, ` +
      `without bonus experience.${later} ${RANK_UP_ROUTE} Its own bonus is used once the plugin (0.7.0+) has recorded a few of its voyages.`;
  }
  return '';
}

// "≈ in 2d 5h" (≈ when calculated rather than measured), with the date and how it was worked out on hover.
function RankUpWhen({ rankUp, at, voyages, label }) {
  if (!at) {
    const why = rankUp.method === 'measured' ? 'No experience gained over the last week.' : 'No route or game data to work it out from.';
    return <span title={why}>{rankUp.method === 'measured' ? 'No progress' : '—'}</span>;
  }
  const date = new Date(at).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const count = voyages ? ` (${voyages} voyage${voyages === 1 ? '' : 's'})` : '';
  return (
    <span title={`${label} about ${date}${count}. ${rankUpBasis(rankUp)}`}>
      {rankUp.method === 'calculated' ? '≈ ' : ''}{formatTimeUntil(at)}
    </span>
  );
}

// "2 · O-J": the map's number (dimmed, its name on hover) before the route's letters, which every map reuses.
function RouteCell({ sub }) {
  if (!sub.current_route) return '—';
  const map = sub.current_map;
  if (!map) return sub.current_route;
  return (
    <span>
      <span className="subs-dim route-map" title={map.name || `Map ${map.id}`}>{map.id} · </span>{sub.current_route}
    </span>
  );
}

function NextRankCell({ sub }) {
  const r = sub.rank_up;
  if (!r) return '—';
  if (!r.nextRank) return <span title={`Rank ${r.maxRank} is the highest.`}>Max rank</span>;
  return <RankUpWhen rankUp={r} at={r.nextRankAt} voyages={r.voyages} label={`Rank ${r.nextRank}`} />;
}

function NextBuildCell({ sub }) {
  const r = sub.rank_up;
  const b = r && r.nextBuild;
  if (!b) return <span title="No build change ahead in Sub Rules (or Fight Club for a Craft? sub).">—</span>;
  return (
    <span>
      {b.build} at {b.rank}
      {b.at ? <span className="subs-dim"> · <RankUpWhen rankUp={r} at={b.at} voyages={b.voyages} label={`Rank ${b.rank}`} /></span> : null}
    </span>
  );
}

// The Subs tab's own columns. Character and World are "context" columns: shown automatically when the tab is
// sorted (one flat table), and available to add in the per-character view.
const SUB_COLUMN_DEFS = [
  { key: 'sub', label: 'Sub', locked: true, cell: (s) => s.sub_name, sort: (r) => r.sub_name },
  { key: 'character', label: 'Character', default: false, cell: (s) => s.character_name, sort: (r) => r.character_name },
  { key: 'world', label: 'World', default: false, cell: (s) => s.world, sort: (r) => r.world },
  { key: 'status', label: 'Status', cell: (s) => <SubStatusCell returnTime={s.return_time} />, sort: (r) => (Number(r.return_time) > 0 ? Number(r.return_time) : null) },
  { key: 'rank', label: 'Rank', cell: (s) => formatRank(s.rank, s.rank_progress_pct), sort: (r) => r.rank + (Number(r.rank_progress_pct) || 0) / 100 },
  { key: 'nextRank', label: 'Next Rank', cell: (s) => <NextRankCell sub={s} />, sort: (r) => (r.rank_up && r.rank_up.nextRankAt) || null },
  { key: 'nextBuild', label: 'Next Build', cell: (s) => <NextBuildCell sub={s} />, sort: (r) => (r.rank_up && r.rank_up.nextBuild && r.rank_up.nextBuild.at) || null },
  { key: 'currentSetup', label: 'Current Setup', cell: (s) => s.current_setup, sort: (r) => r.current_setup },
  { key: 'speed', label: 'Speed', cell: (s) => (s.speed === '' ? '—' : s.speed), sort: (r) => (r.speed === '' ? null : r.speed) },
  { key: 'range', label: 'Range', cell: (s) => (s.range === '' ? '—' : s.range), sort: (r) => (r.range === '' ? null : r.range) },
  { key: 'currentRoute', label: 'Current Route', cell: (s) => <RouteCell sub={s} />, sort: (r) => (r.current_route ? `${r.current_map ? r.current_map.id : 0}|${r.current_route}` : null) },
  { key: 'currentGilDay', label: 'Current Gil/Day', cell: (s) => formatGilDay(s.current_gil_day), sort: (r) => (typeof r.current_gil_day === 'number' ? r.current_gil_day : null) },
  { key: 'targetRoute', label: 'Target Route', cell: (s) => s.target_route || '—', sort: (r) => r.target_route || null },
  { key: 'targetGilDay', label: 'Target Gil/Day', cell: (s) => formatGilDay(s.target_gil_day), sort: (r) => (typeof r.target_gil_day === 'number' ? r.target_gil_day : null) },
  { key: 'craft', label: 'Craft?', cell: (s, ctx) => (
      <input type="checkbox" checked={s.craft_enabled} onChange={(e) => ctx.onToggleCraft(s.cid, s.sub_name, e.target.checked)} />
    ), sort: (r) => (r.craft_enabled ? 1 : 0) }
];
// Master-list columns the Subs tab already has of its own.
const SUB_DUPLICATE_EXTRAS = ['x_world'];

function SubTable({ characterLabel, subs, cols, onToggleCraft, onSortClick }) {
  return (
    <div className="account-group">
      <h2>{characterLabel} <span className="count">({subs.length})</span></h2>
      <table>
        <thead>
          <tr><ColumnHeadCells cols={cols} onSortClick={onSortClick} /></tr>
        </thead>
        <tbody>
          {subs.map((sub) => (
            <tr key={sub.sub_name}><ColumnBodyCells cols={cols} row={sub} ctx={{ onToggleCraft }} /></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FlatSubTable({ rows, cols, sortColumn, sortDirection, onSortClick, onToggleCraft }) {
  return (
    <table>
      <thead>
        <tr><ColumnHeadCells cols={cols} sortColumn={sortColumn} sortDirection={sortDirection} onSortClick={onSortClick} /></tr>
      </thead>
      <tbody>
        {rows.map((sub) => (
          <tr key={`${sub.cid}-${sub.sub_name}`}><ColumnBodyCells cols={cols} row={sub} ctx={{ onToggleCraft }} /></tr>
        ))}
      </tbody>
    </table>
  );
}

function SubmarinesView({ refreshKey }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [groupByAccountEnabled, setGroupByAccountEnabled] = useState(true);
  const subSort = useColumnSort();
  const subCols = useTableColumns({
    tableKey: 'subs',
    ownDefs: SUB_COLUMN_DEFS,
    subject: 'character',
    excludeExtras: SUB_DUPLICATE_EXTRAS,
    rows,
    idOf: (r) => r.cid,
    refreshKey,
    contextKeys: ['character', 'world'],
    contextActive: !!subSort.sortColumn
  });
  const subRows = subCols.rows;

  useEffect(() => {
    window.api.getSubmarines().then((result) => {
      if (result.success) {
        setRows(result.rows);
      } else {
        setError(result.error);
      }
    });
  }, [refreshKey]);

  // Optimistic update: flips the checkbox immediately in local state,
  // then persists in the background. If the save fails, reverts back -
  // better feedback than waiting on a round-trip for every click.
  async function handleToggleCraft(cid, subName, enabled) {
    setRows((prev) =>
      prev.map((r) => (r.cid === cid && r.sub_name === subName ? { ...r, craft_enabled: enabled } : r))
    );

    const result = await window.api.setCraftEnabled({ cid, subName, enabled });
    if (!result.success) {
      setRows((prev) =>
        prev.map((r) => (r.cid === cid && r.sub_name === subName ? { ...r, craft_enabled: !enabled } : r))
      );
    }
  }

  if (error) return <div className="error">Failed to load: {error}</div>;
  if (rows === null) return <div className="status">Loading...</div>;
  if (rows.length === 0) return <div className="status">No built submarines found.</div>;

  const subSortOnClick = (col) => subSort.handleSortClick(col, groupByAccountEnabled, setGroupByAccountEnabled);

  return (
    <div>
      <div className="controls">
        {!subSort.sortColumn && (
          <label>
            <input
              type="checkbox"
              checked={groupByAccountEnabled}
              onChange={(e) => setGroupByAccountEnabled(e.target.checked)}
            />
            {' '}Group by account
          </label>
        )}
        {subSort.sortColumn && (
          <button onClick={() => subSort.resetSort(setGroupByAccountEnabled)}>
            Reset Sorting
          </button>
        )}
        <span style={{ marginLeft: '16px' }}><ColumnPicker cols={subCols} /></span>
      </div>

      {subSort.sortColumn && (
        <FlatSubTable
          rows={applyColumnSort(subRows, subSort.sortColumn, subSort.sortDirection, subCols.accessors)}
          cols={subCols}
          sortColumn={subSort.sortColumn}
          sortDirection={subSort.sortDirection}
          onSortClick={subSortOnClick}
          onToggleCraft={handleToggleCraft}
        />
      )}

      {!subSort.sortColumn && groupByAccountEnabled &&
        groupByAccount(subRows).map((accountGroup) => (
          <div key={accountGroup.label}>
            <h1 style={{ fontSize: '17px', padding: '16px 24px 4px' }}>{accountGroup.label}</h1>
            {groupSubsByCharacter(accountGroup.rows).map(([characterLabel, subs]) => (
              <SubTable key={characterLabel} characterLabel={characterLabel} subs={subs} cols={subCols} onToggleCraft={handleToggleCraft} onSortClick={subSortOnClick} />
            ))}
          </div>
        ))}

      {!subSort.sortColumn && !groupByAccountEnabled &&
        groupSubsByCharacter(subRows).map(([characterLabel, subs]) => (
          <SubTable key={characterLabel} characterLabel={characterLabel} subs={subs} cols={subCols} onToggleCraft={handleToggleCraft} onSortClick={subSortOnClick} />
        ))}
    </div>
  );
}
