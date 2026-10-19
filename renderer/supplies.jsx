// Supplies tab: days until each character runs out of ceruleum and repair kits, worked out from how
// fast it used them over the last few days (ipc/supplies.js, supply-runway.js), and how many to buy so
// they last a chosen number of days. Characters in Roster order, grouped by account like other tabs.

// "6.2 days", "No use" or "Not enough history".
function supplyDaysText(days) {
  if (days === 'never') return 'No use';
  if (days === null || days === undefined) return 'Not enough history';
  if (days < 1) return 'Under a day';
  return `${days < 10 ? days.toFixed(1) : Math.round(days)} days`;
}

// Red under 3 days, amber under 7.
function supplyDaysClass(days) {
  if (typeof days !== 'number') return '';
  if (days < 3) return 'supply-danger';
  if (days < 7) return 'supply-warn';
  return '';
}

const supplyPerDayText = (perDay) => (perDay === null || perDay === undefined ? '—' : perDay < 100 ? perDay.toFixed(1) : Math.round(perDay).toLocaleString());
const supplyRunsOut = (at) => (at ? `Runs out about ${new Date(at).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : '');

// Four columns per supply: held, used per day, days left (amber/red, the date on hover) and how many to buy.
function supplyColumnDefs(metric, label) {
  return [
    { key: `${metric}_have`, label, cell: (r) => r[metric].have.toLocaleString(), sort: (r) => r[metric].have },
    { key: `${metric}_per_day`, label: `${label} / day`, cell: (r) => supplyPerDayText(r[metric].perDay), sort: (r) => r[metric].perDay },
    {
      key: `${metric}_days`, label: `${label}: days left`,
      td: (r) => <td className={supplyDaysClass(r[metric].days)} title={supplyRunsOut(r[metric].runsOutAt)}>{supplyDaysText(r[metric].days)}</td>,
      sort: (r) => (r[metric].days === 'never' ? Number.MAX_SAFE_INTEGER : r[metric].days),
    },
    { key: `${metric}_buy`, label: `Buy ${label.toLowerCase()}`, cell: (r) => (r[metric].restock ? r[metric].restock.toLocaleString() : ''), sort: (r) => r[metric].restock || null },
  ];
}

// The Supplies table's own columns (rows are characters with subs).
const SUPPLY_COLUMN_DEFS = [
  { key: 'character', label: 'Character', locked: true, cell: (r) => r.name, sort: (r) => r.name },
  { key: 'world', label: 'World', cell: (r) => r.world, sort: (r) => r.world },
  ...supplyColumnDefs('ceruleum', 'Ceruleum'),
  ...supplyColumnDefs('repair_kits', 'Repair kits'),
];
const SUPPLY_DUPLICATE_EXTRAS = ['x_world', 'x_ceruleum', 'x_repair_kits'];

// How long FC credits' tanks last: "12 days", "No use", "Not enough history".
const creditDaysText = (days) => supplyDaysText(days === Infinity ? 'never' : days);

// Ceruleum from FC credits: what each Free Company's company credits can buy, and how long that lasts
// at the fleet's use, for the fleet, each account and each Free Company (fc-credits.js).
const creditNumber = (v) => Number(v || 0).toLocaleString();
const creditDaysSort = (d) => (d === Infinity ? Number.MAX_SAFE_INTEGER : d);
const FC_CREDIT_ACCOUNT_COLUMN_DEFS = [
  { key: 'account', label: 'Account', locked: true, cell: (a) => a.label, sort: (a) => a.label },
  { key: 'fcs', label: 'Free Companies', cell: (a) => a.fcCount, sort: (a) => a.fcCount },
  { key: 'credits', label: 'Credits', cell: (a) => creditNumber(a.credits), sort: (a) => a.credits },
  { key: 'tanks', label: 'Tanks they buy', cell: (a) => creditNumber(a.tanks), sort: (a) => a.tanks },
  { key: 'held', label: 'Ceruleum held', cell: (a) => creditNumber(a.held), sort: (a) => a.held },
  { key: 'chest', label: 'In FC chests', cell: (a) => creditNumber(a.chest), sort: (a) => a.chest },
  { key: 'per_day', label: 'Use per day', cell: (a) => supplyPerDayText(a.perDay), sort: (a) => a.perDay },
  { key: 'days', label: 'Tanks last', cell: (a) => creditDaysText(a.days), sort: (a) => creditDaysSort(a.days) },
];
const FC_CREDIT_FC_COLUMN_DEFS = [
  { key: 'fc', label: 'Free Company', locked: true, cell: (fc) => fc.fc_name || '—', sort: (fc) => fc.fc_name },
  { key: 'world', label: 'World', cell: (fc) => fc.fc_world || '—', sort: (fc) => fc.fc_world },
  { key: 'account', label: 'Account', cell: (fc) => fc.account_label, sort: (fc) => fc.account_label },
  { key: 'credits', label: 'Credits', cell: (fc) => creditNumber(fc.credits), sort: (fc) => fc.credits },
  { key: 'tanks', label: 'Tanks they buy', cell: (fc) => creditNumber(fc.tanks), sort: (fc) => fc.tanks },
  { key: 'chest', label: 'In FC chest', cell: (fc) => creditNumber(fc.chest), sort: (fc) => fc.chest },
  { key: 'per_day', label: "Members' use per day", cell: (fc) => supplyPerDayText(fc.perDay), sort: (fc) => fc.perDay },
  { key: 'days', label: 'Tanks last', cell: (fc) => creditDaysText(fc.days), sort: (fc) => creditDaysSort(fc.days) },
];
const FC_CREDIT_DUPLICATE_EXTRAS = ['x_account', 'x_chest_ceruleum'];

function FcCreditsSection({ credits, onSaveTankCost, refreshKey }) {
  const [costInput, setCostInput] = useState(String(credits.tankCost));
  const accountSort = useColumnSort();
  const accountCols = useTableColumns({ tableKey: 'fcCreditAccounts', ownDefs: FC_CREDIT_ACCOUNT_COLUMN_DEFS, rows: credits.accounts, idOf: () => null });
  const fcSort = useColumnSort();
  const fcCols = useTableColumns({
    tableKey: 'fcCreditFcs', ownDefs: FC_CREDIT_FC_COLUMN_DEFS, subject: 'fc', excludeExtras: FC_CREDIT_DUPLICATE_EXTRAS,
    rows: credits.fcs, idOf: (fc) => fc.fc_id, refreshKey,
  });
  useEffect(() => setCostInput(String(credits.tankCost)), [credits.tankCost]);
  const f = credits.fleet;
  const n = creditNumber;
  return (
    <div className="fc-credits">
      <h2 style={{ padding: '8px 24px 0' }}>Ceruleum from FC Credits</h2>
      <div className="controls supplies-controls">
        <label>
          Company credits per ceruleum tank{' '}
          <input type="number" min={1} value={costInput} style={{ width: '80px' }}
            onChange={(e) => setCostInput(e.target.value)}
            onBlur={() => { if (Number(costInput) !== credits.tankCost) onSaveTankCost(Number(costInput)); }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }} />
        </label>
        <span className="supplies-note-inline">From the OIC Quartermaster at your Grand Company; check the price in game.</span>
      </div>
      <div className="supplies-summary">
        <div className="account-group supply-card">
          <div className="supply-card-label">Fleet: FC credits buy</div>
          <div className="supply-card-value">{n(f.tanks)} tanks</div>
          <div className="supply-card-note">{n(f.credits)} credits across {f.fcCount} Free Compan{f.fcCount === 1 ? 'y' : 'ies'}</div>
        </div>
        <div className="account-group supply-card">
          <div className="supply-card-label">Fleet: those tanks last</div>
          <div className="supply-card-value">{creditDaysText(f.days)}</div>
          <div className="supply-card-note">at {supplyPerDayText(f.perDay)} ceruleum a day, on top of the {n(f.held)} held and {n(f.chest)} in FC chests</div>
        </div>
      </div>
      {credits.accounts.length > 0 && (
        <React.Fragment>
          <div className="controls"><ColumnPicker cols={accountCols} /></div>
          <ColumnTable cols={accountCols} sort={accountSort} rows={accountCols.rows} rowKey={(a) => a.label} className="supplies-table fc-credit-accounts" />
        </React.Fragment>
      )}
      {credits.fcs.length > 0 && (
        <React.Fragment>
          <div className="controls"><ColumnPicker cols={fcCols} /></div>
          <ColumnTable cols={fcCols} sort={fcSort} rows={fcCols.rows} rowKey={(fc) => fc.fc_id} className="supplies-table fc-credit-fcs" />
        </React.Fragment>
      )}
      {credits.fcs.length === 0 && <div className="status">No Free Company credits recorded yet (they come from FC Tracker).</div>}
    </div>
  );
}

function SuppliesView({ refreshKey }) {
  const [data, setData] = useState(null);
  const supplySort = useColumnSort();
  const supplyCols = useTableColumns({
    tableKey: 'supplies', ownDefs: SUPPLY_COLUMN_DEFS, subject: 'character', excludeExtras: SUPPLY_DUPLICATE_EXTRAS,
    rows: data ? data.rows : null, idOf: (r) => r.cid, refreshKey,
  });
  const [error, setError] = useState(null);
  const [groupByAccountEnabled, setGroupByAccountEnabled] = useState(true);
  const [targetInput, setTargetInput] = useState('');
  const [saveError, setSaveError] = useState(null);

  function load() {
    window.api.getSupplies().then((result) => {
      if (result.success) {
        setData(result);
        setTargetInput(String(result.targetDays));
        setError(null);
      } else {
        setError(result.error);
      }
    });
  }

  useEffect(load, [refreshKey]);

  async function save(windowDays, targetDays, tankCost) {
    const result = await window.api.saveSupplySettings({ windowDays, targetDays, tankCost });
    if (result.success) {
      setSaveError(null);
      load();
    } else {
      setSaveError(result.error);
    }
  }

  if (error) return <div className="error">Failed to load: {error}</div>;
  if (data === null) return <div className="status">Loading...</div>;

  const rows = sortRows(supplyCols.rows);
  const suppliesTable = (list) => <ColumnTable cols={supplyCols} sort={supplySort} rows={list} rowKey={(r) => r.cid} className="supplies-table" />;
  const t = data.totals;
  const soonest = rows
    .flatMap((r) => [['ceruleum', r.ceruleum], ['repair kits', r.repair_kits]].map(([what, s]) => ({ r, what, days: s.days })))
    .filter((x) => typeof x.days === 'number')
    .sort((a, b) => a.days - b.days)[0];
  const kitGil = data.repairKitCost ? t.repairKitsRestock * data.repairKitCost : null;

  return (
    <div className="supplies">
      <div className="controls supplies-controls">
        <label>
          Use over the last{' '}
          <select value={data.windowDays} onChange={(e) => save(Number(e.target.value), data.targetDays)}>
            {data.windowChoices.map((d) => <option key={d} value={d}>{d} days</option>)}
          </select>
        </label>
        <label>
          Buy enough for{' '}
          <input type="number" min={1} max={data.maxTargetDays} value={targetInput} style={{ width: '60px' }}
            onChange={(e) => setTargetInput(e.target.value)}
            onBlur={() => { if (Number(targetInput) !== data.targetDays) save(data.windowDays, Number(targetInput)); }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }} />
          {' '}days
        </label>
        <label>
          <input type="checkbox" checked={groupByAccountEnabled} onChange={(e) => setGroupByAccountEnabled(e.target.checked)} />
          {' '}Group by account
        </label>
        <ColumnPicker cols={supplyCols} />
        {saveError && <span className="error-inline">{saveError}</span>}
      </div>

      <div className="supplies-summary">
        <div className="account-group supply-card">
          <div className="supply-card-label">Fleet use per day</div>
          <div className="supply-card-value">{supplyPerDayText(t.ceruleumPerDay)} ceruleum · {supplyPerDayText(t.repairKitsPerDay)} repair kits</div>
        </div>
        <div className="account-group supply-card">
          <div className="supply-card-label">To last {data.targetDays} days, buy</div>
          <div className="supply-card-value">
            {t.ceruleumRestock.toLocaleString()} ceruleum · {t.repairKitsRestock.toLocaleString()} repair kits
          </div>
          <div className="supply-card-note">
            {kitGil !== null ? `Repair kits ≈ ${kitGil.toLocaleString()} gil. ` : ''}
            FC chests hold {t.fcChestCeruleum.toLocaleString()} ceruleum.
          </div>
        </div>
        <div className="account-group supply-card">
          <div className="supply-card-label">Runs out first</div>
          <div className="supply-card-value">
            {soonest ? `${soonest.r.name}: ${soonest.what} in ${supplyDaysText(soonest.days).toLowerCase()}` : 'Nothing is running out'}
          </div>
        </div>
      </div>

      <div className="supplies-note">
        Use per day is every drop in the count over the last {data.windowDays} days (restocks are ignored), as of each
        character's last sync. Days left: what the character holds now at that rate (hover for the date).
        {data.withoutSubs ? ` ${data.withoutSubs} character${data.withoutSubs === 1 ? '' : 's'} with no subs built ${data.withoutSubs === 1 ? 'is' : 'are'} left out.` : ''}
      </div>

      {rows.length === 0 && <div className="status">No characters with subs built yet.</div>}
      {rows.length > 0 && groupByAccountEnabled && groupByAccount(rows).map((group) => (
        <div key={group.label} className="account-group">
          <h1 style={{ fontSize: '17px', padding: '16px 24px 4px' }}>{group.label}</h1>
          {suppliesTable(group.rows)}
        </div>
      ))}
      {rows.length > 0 && !groupByAccountEnabled && suppliesTable(rows)}

      {data.credits && <FcCreditsSection credits={data.credits} refreshKey={refreshKey} onSaveTankCost={(cost) => save(data.windowDays, data.targetDays, cost)} />}
    </div>
  );
}
