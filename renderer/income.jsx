// Income tab: each character's real net income from its subs over the last few days (salvage that came
// in, at its vendor price, less the repair kits used) against what Fight Club says their routes should
// earn (the Subs tab's Current Gil/Day). ipc/income.js and income.js do the working out. Characters in
// Roster order, grouped by account like other tabs.

const incomeGil = (value) => (value === null || value === undefined ? '—' : Math.round(value).toLocaleString());
const incomeSigned = (value) => (value === null || value === undefined ? '—' : `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(Math.round(value)).toLocaleString()}`);
const incomeShare = (share) => (share === null || share === undefined ? '—' : `${Math.round(share * 100)}%`);

function IncomeExpectedCell({ row }) {
  const unmatched = row.subs_unmatched > 0
    ? `${row.subs_unmatched} of ${row.subs} sub${row.subs === 1 ? ' is' : 's are'} on a route Fight Club does not list, so ${row.subs_unmatched === 1 ? 'it is' : 'they are'} left out of expected.`
    : '';
  return <td title={unmatched}>{incomeGil(row.expectedPerDay)}{unmatched ? ' *' : ''}</td>;
}

const incomeIf = (r, value) => (r.enough ? value : null);

// The Income table's own columns (rows are characters with subs). A character with less than a day of
// salvage history says so in the Salvage column and leaves the other real-income columns blank.
const INCOME_COLUMN_DEFS = [
  { key: 'character', label: 'Character', locked: true, cell: (r) => r.name, sort: (r) => r.name },
  { key: 'world', label: 'World', cell: (r) => r.world, sort: (r) => r.world },
  { key: 'subs', label: 'Subs', cell: (r) => r.subs, sort: (r) => r.subs },
  {
    key: 'salvage', label: 'Salvage / day',
    td: (r) => (r.enough
      ? <td title={`${r.pieces.toLocaleString()} salvage pieces came in over ${r.spanDays.toFixed(1)} days`
          + (r.fromChest ? `; ${r.fromChest.toLocaleString()} taken out of the FC chest are not counted` : '')
          + (r.firstStored ? `; ${r.firstStored.toLocaleString()} seen for the first time (a retainer first opened on a PC) are not counted` : '')}>{incomeGil(r.salvagePerDay)}</td>
      : <td className="income-none">Not enough history</td>),
    sort: (r) => incomeIf(r, r.salvagePerDay),
  },
  {
    key: 'repairs', label: 'Repairs / day',
    td: (r) => (r.enough
      ? <td title={`${r.kitsUsed.toLocaleString()} repair kits used over ${r.spanDays.toFixed(1)} days`}>{r.kitPerDay ? `−${incomeGil(r.kitPerDay)}` : '0'}</td>
      : <td></td>),
    sort: (r) => incomeIf(r, r.kitPerDay),
  },
  { key: 'real', label: 'Real net / day', td: (r) => <td className="income-real">{r.enough ? incomeGil(r.perDay) : ''}</td>, sort: (r) => incomeIf(r, r.perDay) },
  { key: 'expected', label: 'Expected / day', td: (r) => <IncomeExpectedCell row={r} />, sort: (r) => r.expectedPerDay },
  { key: 'difference', label: 'Difference / day', td: (r) => <td className={r.status}>{r.enough ? incomeSigned(r.differencePerDay) : ''}</td>, sort: (r) => incomeIf(r, r.differencePerDay) },
  { key: 'share', label: 'Of expected', td: (r) => <td className={r.status}>{r.enough ? incomeShare(r.share) : ''}</td>, sort: (r) => incomeIf(r, r.share) },
];
const INCOME_DUPLICATE_EXTRAS = ['x_world'];

const LOOT_SUB_COLUMN_DEFS = [
  { key: 'character', label: 'Character', locked: true, cell: (s) => s.character_name || '—', sort: (s) => s.character_name },
  { key: 'sub', label: 'Sub', cell: (s) => s.subName || '—', sort: (s) => s.subName },
  { key: 'route', label: 'Route', cell: (s) => s.route, sort: (s) => s.route },
  { key: 'voyages', label: 'Voyages', cell: (s) => s.voyages, sort: (s) => s.voyages },
  { key: 'per_voyage', label: 'Vendor gil / voyage', cell: (s) => incomeGil(s.perVoyage), sort: (s) => s.perVoyage },
  { key: 'real', label: 'Vendor value / day', td: (s) => <td className="income-real">{incomeGil(s.perDay)}</td>, sort: (s) => s.perDay },
  { key: 'expected', label: 'Expected / day', cell: (s) => incomeGil(s.expectedPerDay), sort: (s) => s.expectedPerDay },
];
const LOOT_ROUTE_COLUMN_DEFS = [
  { key: 'route', label: 'Route', locked: true, cell: (r) => r.route, sort: (r) => r.route },
  { key: 'subs', label: 'Subs', cell: (r) => r.subs, sort: (r) => r.subs },
  { key: 'voyages', label: 'Voyages', cell: (r) => r.voyages, sort: (r) => r.voyages },
  { key: 'per_voyage', label: 'Vendor gil / voyage', cell: (r) => incomeGil(r.perVoyage), sort: (r) => r.perVoyage },
];
const VENTURE_COLUMN_DEFS = [
  { key: 'character', label: 'Character', locked: true, cell: (r) => r.name, sort: (r) => r.name },
  { key: 'world', label: 'World', cell: (r) => r.world || '—', sort: (r) => r.world },
  { key: 'retainers', label: 'Retainers', cell: (r) => r.retainers, sort: (r) => r.retainers },
  { key: 'rewards', label: 'Rewards', cell: (r) => r.rewards, sort: (r) => r.rewards },
  { key: 'per_day', label: 'Vendor value / day', td: (r) => <td className="income-real">{incomeGil(r.perDay)}</td>, sort: (r) => r.perDay },
  { key: 'top', label: 'Most valuable', cell: (r) => r.top.map((t) => `${t.name} ×${t.n.toLocaleString()}`).join(', '), sortable: false },
];

// With live prices (Settings → Live Market Prices): the same value at the cheapest listing on the
// character's world, data center and region (universalis.js). `field`: 'perVoyage' or 'perDay'.
const MARKET_SCOPE_LABELS = { world: 'World', dc: 'DC', region: 'Region' };
function marketColumnDefs(field, unit) {
  return ['world', 'dc', 'region'].map((scope) => ({
    key: `market_${scope}`,
    label: `${MARKET_SCOPE_LABELS[scope]} market ${unit}`,
    td: (r) => {
      const m = r.market && r.market[scope];
      return <td className={`income-market market-${scope}`} title={`At the cheapest listing on the ${scope === 'world' ? "character's world" : scope === 'dc' ? 'data center' : 'region'} (Universalis); items not on the market board at what a vendor pays.`}>{m ? incomeGil(m[field]) : '—'}</td>;
    },
    sort: (r) => (r.market && r.market[scope] ? r.market[scope][field] : null),
  }));
}
const LOOT_SUB_MARKET_DEFS = marketColumnDefs('perDay', '/ day');
const LOOT_ROUTE_MARKET_DEFS = marketColumnDefs('perVoyage', '/ voyage');
const VENTURE_MARKET_DEFS = marketColumnDefs('perDay', '/ day');

// Universalis did not answer this time, so some prices are from an earlier check.
function MarketStaleNote({ stale }) {
  if (!stale) return null;
  const at = new Date(stale.since).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return <div className="warning market-stale-note">Some live prices are from {at}: {stale.problem} They update at the next refresh.</div>;
}

// Where the live prices came from, or why there are none.
function MarketNote({ market }) {
  if (!market) return null;
  if (market.error) return <div className="warning market-error">Live prices: {market.error} Vendor prices are shown.</div>;
  const places = (market.places || []).map((p) => [p.world, p.dc, p.region].filter(Boolean).join(' / ')).join('; ');
  return (
    <React.Fragment>
      <div className="supplies-note market-note">Live prices from Universalis: cheapest listings on {places || 'your worlds'}. Items not sold on the market board count at what a vendor pays.</div>
      <MarketStaleNote stale={market.stale} />
    </React.Fragment>
  );
}

// Loot per voyage and venture income (ipc/details.js, loot.js): what Submarine Tracker recorded for each
// voyage and AutoRetainer for each venture, copied by plugin 0.10.0 (database version 8).
// uses: what the player runs (play-style.js); Loot per Voyage is only for subs, Retainer Ventures only for retainers.
function IncomeLootSection({ refreshKey, uses = { subs: true, retainers: true } }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  // The market columns only exist while live prices are on.
  const live = !!(data && data.market && !data.market.error);
  const lootDefs = React.useMemo(() => (live ? [...LOOT_SUB_COLUMN_DEFS, ...LOOT_SUB_MARKET_DEFS] : LOOT_SUB_COLUMN_DEFS), [live]);
  const routeDefs = React.useMemo(() => (live ? [...LOOT_ROUTE_COLUMN_DEFS, ...LOOT_ROUTE_MARKET_DEFS] : LOOT_ROUTE_COLUMN_DEFS), [live]);
  const ventureDefs = React.useMemo(() => (live ? [...VENTURE_COLUMN_DEFS.slice(0, -1), ...VENTURE_MARKET_DEFS, VENTURE_COLUMN_DEFS[VENTURE_COLUMN_DEFS.length - 1]] : VENTURE_COLUMN_DEFS), [live]);
  const lootSort = useColumnSort();
  const lootCols = useTableColumns({ tableKey: 'lootSubs', ownDefs: lootDefs, rows: data && data.subs ? data.subs : null, idOf: () => null });
  const routeSort = useColumnSort();
  const routeCols = useTableColumns({ tableKey: 'lootRoutes', ownDefs: routeDefs, rows: null, idOf: () => null });
  const ventureSort = useColumnSort();
  const ventureCols = useTableColumns({
    tableKey: 'ventureIncome', ownDefs: ventureDefs, subject: 'character', excludeExtras: INCOME_DUPLICATE_EXTRAS,
    rows: data && data.ventures ? data.ventures : null, idOf: (r) => r.ownerCid, refreshKey,
  });
  useEffect(() => {
    window.api.getLoot().then((result) => {
      if (result.success) { setData(result); setError(null); } else setError(result.error);
    });
  }, [refreshKey]);

  if (error) return <div className="error">Loot per voyage failed to load: {error}</div>;
  if (data === null) return null;
  if (data.missing) {
    return (
      <div className="supplies-note income-loot-missing">
        Loot per voyage and venture income: the database doesn't have these tables yet. The app adds them when it connects; if it
        couldn't, the banner at the top says why. Submarine Tracker records each voyage's loot; AutoRetainer records venture rewards.
      </div>
    );
  }
  const subs = sortRows(lootCols.rows.map((s) => ({ ...s, name: s.character_name })));
  const v = data.ventureTotals;
  return (
    <div className="income-loot">
      <MarketNote market={data.market} />
      {uses.subs && (<React.Fragment>
      <h2 style={{ padding: '16px 24px 0' }}>Loot per Voyage</h2>
      <div className="supplies-note">
        What each voyage really brought back over the last {data.windowDays} days, from Submarine Tracker (items at what a vendor pays;
        salvage at the Salvage tab's prices). {data.totals.voyages.toLocaleString()} voyage{data.totals.voyages === 1 ? '' : 's'},
        {' '}{incomeGil(data.totals.gil)} gil, {incomeGil(data.totals.perDay)} gil a day.
        {live && ` At market prices: ${['world', 'dc', 'region'].map((sc) => `${incomeGil(data.market.loot[sc].perDay)} a day (${MARKET_SCOPE_LABELS[sc]})`).join(', ')}.`}
      </div>
      {subs.length === 0 && <div className="status">No voyages recorded in this time. Submarine Tracker records a voyage when its loot is collected on a PC running it.</div>}
      {subs.length > 0 && (
        <React.Fragment>
          <div className="controls"><ColumnPicker cols={lootCols} /></div>
          <ColumnTable cols={lootCols} sort={lootSort} rows={subs} rowKey={(s) => `${s.fcId}|${s.register}`} className="income-table loot-subs" />
        </React.Fragment>
      )}
      {data.routes.length > 0 && (
        <React.Fragment>
          <div className="controls"><ColumnPicker cols={routeCols} /></div>
          <ColumnTable cols={routeCols} sort={routeSort} rows={data.routes} rowKey={(r) => r.route} className="income-table loot-routes" />
        </React.Fragment>
      )}
      </React.Fragment>)}

      {uses.retainers && (<React.Fragment>
      <h2 style={{ padding: '16px 24px 0' }}>Retainer Ventures</h2>
      <div className="supplies-note">
        Venture rewards AutoRetainer recorded over the last {data.windowDays} days, at what a vendor pays (items are often worth more on
        the market board). {v.rewards.toLocaleString()} reward{v.rewards === 1 ? '' : 's'}, {incomeGil(v.gil)} gil, {incomeGil(v.perDay)} gil a day.
        {live && ` At market prices: ${['world', 'dc', 'region'].map((sc) => `${incomeGil(data.market.ventures[sc].perDay)} a day (${MARKET_SCOPE_LABELS[sc]})`).join(', ')}.`}
      </div>
      {data.ventures.length === 0 && <div className="status">No venture rewards recorded in this time (AutoRetainer: "Record statistics").</div>}
      {data.ventures.length > 0 && (
        <React.Fragment>
          <div className="controls"><ColumnPicker cols={ventureCols} /></div>
          <ColumnTable cols={ventureCols} sort={ventureSort} rows={sortRows(ventureCols.rows)} rowKey={(r) => r.ownerCid} className="income-table venture-income" />
        </React.Fragment>
      )}
      </React.Fragment>)}
    </div>
  );
}

function IncomeView({ refreshKey, uses = { subs: true, retainers: true } }) {
  const [data, setData] = useState(null);
  const incomeSort = useColumnSort();
  const incomeCols = useTableColumns({
    tableKey: 'income', ownDefs: INCOME_COLUMN_DEFS, subject: 'character', excludeExtras: INCOME_DUPLICATE_EXTRAS,
    rows: data ? data.rows : null, idOf: (r) => r.cid, refreshKey,
  });
  const [error, setError] = useState(null);
  const [groupByAccountEnabled, setGroupByAccountEnabled] = useState(true);
  const [saveError, setSaveError] = useState(null);

  function load() {
    window.api.getIncome().then((result) => {
      if (result.success) {
        setData(result);
        setError(null);
      } else {
        setError(result.error);
      }
    });
  }

  useEffect(load, [refreshKey]);

  async function saveWindow(windowDays) {
    const result = await window.api.saveIncomeSettings({ windowDays });
    if (result.success) {
      setSaveError(null);
      load();
    } else {
      setSaveError(result.error);
    }
  }

  if (error) return <div className="error">Failed to load: {error}</div>;
  if (data === null) return <div className="status">Loading...</div>;

  const windowChoice = (
    <label>
      Income over the last{' '}
      <select value={data.windowDays} onChange={(e) => saveWindow(Number(e.target.value))}>
        {data.windowChoices.map((d) => <option key={d} value={d}>{d} days</option>)}
      </select>
    </label>
  );
  // Retainers only: the salvage income and Loot per Voyage are for subs, so only venture income is shown.
  if (!uses.subs) {
    return (
      <div className="income">
        <div className="controls income-controls">
          {windowChoice}
          {saveError && <span className="error-inline">{saveError}</span>}
        </div>
        <IncomeLootSection refreshKey={refreshKey} uses={uses} />
      </div>
    );
  }

  const rows = sortRows(incomeCols.rows);
  const incomeTable = (list) => <ColumnTable cols={incomeCols} sort={incomeSort} rows={list} rowKey={(r) => r.cid} className="income-table" />;
  const t = data.totals;
  const behind = rows.filter((r) => r.status === 'income-danger' || r.status === 'income-warn').length;

  return (
    <div className="income">
      <div className="controls income-controls">
        {windowChoice}
        <label>
          <input type="checkbox" checked={groupByAccountEnabled} onChange={(e) => setGroupByAccountEnabled(e.target.checked)} />
          {' '}Group by account
        </label>
        <ColumnPicker cols={incomeCols} />
        {saveError && <span className="error-inline">{saveError}</span>}
      </div>

      <div className="supplies-summary">
        <div className="account-group supply-card">
          <div className="supply-card-label">Fleet real net per day</div>
          <div className="supply-card-value">{incomeGil(t.perDay)} gil</div>
          <div className="supply-card-note">{incomeGil(t.salvagePerDay)} salvage − {incomeGil(t.kitPerDay)} repairs</div>
        </div>
        <div className="account-group supply-card">
          <div className="supply-card-label">Against expected</div>
          <div className="supply-card-value">
            {t.share === null ? '—' : `${incomeShare(t.share)} of ${incomeGil(t.expectedPerDay)} gil a day`}
          </div>
          <div className="supply-card-note">
            {t.compared} character{t.compared === 1 ? '' : 's'} compared{t.share === null ? '' : `: ${incomeSigned(t.comparedPerDay - t.expectedPerDay)} gil a day`}
          </div>
        </div>
        <div className="account-group supply-card">
          <div className="supply-card-label">Below expected</div>
          <div className="supply-card-value">{behind === 0 ? 'Nobody' : `${behind} character${behind === 1 ? '' : 's'}`}</div>
          <div className="supply-card-note">Amber under 90% of expected, red under 75%.</div>
        </div>
      </div>

      <div className="supplies-note">
        Salvage: every piece that came into a character's bags or retainers over the last {data.windowDays} days, at its
        vendor price (selling or moving it is not counted). Repairs: repair kits used
        {data.kitCost ? ` at ${data.kitCost.toLocaleString()} gil each` : ' (set the repair kit cost in Settings to count them)'}.
        Expected: the subs' Current Gil/Day from the Subs tab, for the routes they are on now.
        {t.notEnough ? ` ${t.notEnough} character${t.notEnough === 1 ? ' has' : 's have'} less than a day of salvage history.` : ''}
        {data.withoutSubs ? ` ${data.withoutSubs} character${data.withoutSubs === 1 ? '' : 's'} with no subs built ${data.withoutSubs === 1 ? 'is' : 'are'} left out.` : ''}
      </div>

      {rows.length === 0 && <div className="status">No characters with subs built yet.</div>}
      {rows.length > 0 && groupByAccountEnabled && groupByAccount(rows).map((group) => (
        <div key={group.label} className="account-group">
          <h1 style={{ fontSize: '17px', padding: '16px 24px 4px' }}>{group.label}</h1>
          {incomeTable(group.rows)}
        </div>
      ))}
      {rows.length > 0 && !groupByAccountEnabled && incomeTable(rows)}

      <IncomeLootSection refreshKey={refreshKey} uses={uses} />
    </div>
  );
}
