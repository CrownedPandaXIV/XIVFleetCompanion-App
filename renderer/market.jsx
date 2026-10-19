// Gil & Market tab: gil held per account (characters and their retainers) and the retainers' market
// listings that have sat unsold a long time (ipc/details.js, market.js). Listings need plugin 0.10.0
// and database version 8. With live prices (Settings → Live Market Prices, universalis.js), each listing also shows
// the cheapest someone else sells it for on its world, data center and region, and undercut listings are listed.

const marketGil = (n) => Math.round(Number(n) || 0).toLocaleString();
const marketAge = (days) => (days < 1 ? 'under a day' : `${Math.floor(days)} day${Math.floor(days) === 1 ? '' : 's'}`);

const MARKET_ACCOUNT_COLUMN_DEFS = [
  { key: 'account', label: 'Account', locked: true, cell: (a) => a.label, sort: (a) => a.label },
  { key: 'characters', label: 'Characters', cell: (a) => a.characters, sort: (a) => a.characters },
  { key: 'character_gil', label: 'Character gil', cell: (a) => marketGil(a.characterGil), sort: (a) => a.characterGil },
  { key: 'retainers', label: 'Retainers', cell: (a) => a.retainers, sort: (a) => a.retainers },
  { key: 'retainer_gil', label: 'Retainer gil', cell: (a) => marketGil(a.retainerGil), sort: (a) => a.retainerGil },
  { key: 'total', label: 'Total', cell: (a) => marketGil(a.total), sort: (a) => a.total },
];
// The cheapest someone else sells the same item and quality for (market.js compareListings).
const MARKET_SCOPE_NAMES = { world: 'World', dc: 'DC', region: 'Region' };
const MARKET_CHEAPEST_DEFS = ['world', 'dc', 'region'].map((scope) => ({
  key: `cheapest_${scope}`,
  label: `Cheapest on ${MARKET_SCOPE_NAMES[scope]}`,
  td: (l) => {
    const o = l.others && l.others[scope];
    const cheaper = o && o.price < Number(l.unit_price);
    return (
      <td className={`market-cheapest market-${scope}${cheaper ? ' supply-warn' : ''}`} title={o && o.world ? `On ${o.world}` : ''}>
        {o ? `${marketGil(o.price)}${o.world && scope !== 'world' ? ` (${o.world})` : ''}` : 'None'}
      </td>
    );
  },
  sort: (l) => (l.others && l.others[scope] ? l.others[scope].price : null),
}));

const MARKET_LISTING_COLUMN_DEFS = [
  { key: 'item', label: 'Item', locked: true, cell: (l) => `${l.item_name}${l.hq ? ' (HQ)' : ''}`, sort: (l) => l.item_name },
  { key: 'qty', label: 'Qty', cell: (l) => l.quantity, sort: (l) => l.quantity },
  { key: 'price', label: 'Price each', cell: (l) => marketGil(l.unit_price), sort: (l) => Number(l.unit_price) },
  {
    key: 'vendor', label: 'Vendor price',
    td: (l) => <td className="market-vendor" title="What a vendor pays for one (game data; salvage at the Salvage tab's prices)">{l.vendor_price ? marketGil(l.vendor_price) : '—'}</td>,
    sort: (l) => l.vendor_price,
  },
  { key: 'total', label: 'Total', cell: (l) => marketGil(l.value), sort: (l) => l.value },
  { key: 'age', label: 'Up for', cell: (l) => marketAge(l.ageDays), sort: (l) => l.ageDays },
  { key: 'retainer', label: 'Retainer', cell: (l) => l.retainer_name || '—', sort: (l) => l.retainer_name },
  { key: 'character', label: 'Character', cell: (l) => l.owner_name || '—', sort: (l) => l.owner_name },
  { key: 'account', label: 'Account', cell: (l) => l.account_label || '—', sort: (l) => l.account_label },
];
const MARKET_UNDERCUT_COLUMN_DEFS = [
  ...MARKET_LISTING_COLUMN_DEFS.slice(0, 4), // item, qty, price each, vendor price
  { key: 'cheaper_by', label: 'Cheaper by', cell: (l) => marketGil(l.undercutBy), sort: (l) => l.undercutBy },
  ...MARKET_CHEAPEST_DEFS,
  ...MARKET_LISTING_COLUMN_DEFS.slice(5), // up for, retainer, character, account
];

// uses: what the player runs (play-style.js); listings are only for retainers.
function MarketView({ refreshKey, uses = { subs: true, retainers: true } }) {
  const accountSort = useColumnSort();
  const accountCols = useTableColumns({ tableKey: 'marketAccounts', ownDefs: MARKET_ACCOUNT_COLUMN_DEFS, rows: null, idOf: () => null });
  const listingSort = useColumnSort();
  const [data, setData] = useState(null);
  const live = !!(data && data.market && data.market.live && !data.market.live.error);
  const listingDefs = React.useMemo(() => (live ? [...MARKET_LISTING_COLUMN_DEFS.slice(0, 5), ...MARKET_CHEAPEST_DEFS, ...MARKET_LISTING_COLUMN_DEFS.slice(5)] : MARKET_LISTING_COLUMN_DEFS), [live]);
  const listingCols = useTableColumns({ tableKey: 'marketListings', ownDefs: listingDefs, rows: null, idOf: () => null });
  const undercutSort = useColumnSort();
  const undercutCols = useTableColumns({ tableKey: 'marketUndercut', ownDefs: MARKET_UNDERCUT_COLUMN_DEFS, rows: null, idOf: () => null });
  const [error, setError] = useState(null);
  const [daysInput, setDaysInput] = useState('');
  const [saveError, setSaveError] = useState(null);

  function load() {
    window.api.getMarket().then((result) => {
      if (result.success) {
        setData(result);
        setDaysInput(String(result.minDays));
        setError(null);
      } else {
        setError(result.error);
      }
    });
  }

  useEffect(load, [refreshKey]);

  async function saveDays() {
    const minDays = Number(daysInput);
    if (minDays === data.minDays) return;
    const result = await window.api.saveMarketSettings({ minDays });
    if (result.success) { setSaveError(null); load(); } else setSaveError(result.error);
  }

  if (error) return <div className="error">Failed to load: {error}</div>;
  if (data === null) return <div className="status">Loading...</div>;
  const f = data.fleet;
  const m = uses.retainers ? data.market : null;

  return (
    <div className="market">
      <div className="supplies-summary">
        <div className="account-group supply-card">
          <div className="supply-card-label">Fleet gil</div>
          <div className="supply-card-value">{marketGil(f.total)} gil</div>
          <div className="supply-card-note">{marketGil(f.characterGil)} on {f.characters} characters · {marketGil(f.retainerGil)} on {f.retainers} retainers</div>
        </div>
        {m && (
          <div className="account-group supply-card">
            <div className="supply-card-label">Up for sale</div>
            <div className="supply-card-value">{m.totals.listings.toLocaleString()} listing{m.totals.listings === 1 ? '' : 's'} · {marketGil(m.totals.value)} gil</div>
            <div className="supply-card-note">{m.totals.stale.toLocaleString()} up for {data.minDays}+ days ({marketGil(m.totals.staleValue)} gil)</div>
          </div>
        )}
      </div>

      <h2 style={{ padding: '8px 24px 0' }}>Gil per Account</h2>
      <div className="controls"><ColumnPicker cols={accountCols} /></div>
      <ColumnTable cols={accountCols} sort={accountSort} rows={data.accounts} rowKey={(a) => a.label} className="market-accounts" />

      {m && m.live && m.live.error && <div className="warning market-error">Live prices: {m.live.error}</div>}
      {live && <MarketStaleNote stale={m.live.stale} />}
      {live && (
        <React.Fragment>
          <h2 style={{ padding: '16px 24px 0' }}>Undercut Listings</h2>
          <div className="supplies-note">
            Your listings that someone else sells cheaper on the same world (same item and quality), from Universalis, with the cheapest on
            the data center and region. Biggest gap first.
          </div>
          {m.live.undercut.length === 0 && <div className="status market-undercut-none">None of your listings is undercut on its world.</div>}
          {m.live.undercut.length > 0 && (
            <React.Fragment>
              <div className="controls"><ColumnPicker cols={undercutCols} /></div>
              <ColumnTable cols={undercutCols} sort={undercutSort} rows={m.live.undercut} className="market-undercut"
                rowKey={(l) => `${l.retainer_id}|${l.slot}|${l.item_id}|${l.first_seen_at}`} />
            </React.Fragment>
          )}
        </React.Fragment>
      )}

      {uses.retainers && <h2 style={{ padding: '16px 24px 0' }}>Listings Unsold for a While</h2>}
      {uses.retainers && !m && (
        <div className="supplies-note market-missing">
          Market listings: the database doesn't have this table yet. The app adds it when it connects; if it couldn't, the banner at
          the top says why. A retainer's listings are seen when it is opened at a summoning bell with Allagan Tools running.
        </div>
      )}
      {m && (
        <React.Fragment>
          <div className="controls">
            <label>
              Up for at least{' '}
              <input type="number" min={1} max={data.maxStaleDays} value={daysInput} style={{ width: '60px' }}
                onChange={(e) => setDaysInput(e.target.value)} onBlur={saveDays}
                onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }} />
              {' '}days
            </label>
            <ColumnPicker cols={listingCols} />
            {saveError && <span className="error-inline">{saveError}</span>}
          </div>
          <div className="supplies-note">
            Since the plugin first saw each listing (a repriced listing keeps its time). Prices are what you listed them at; whether
            they are undercut is not checked.
          </div>
          {m.stale.length === 0 && <div className="status">Nothing has been up for {data.minDays} days or more.</div>}
          {m.stale.length > 0 && (
            <ColumnTable cols={listingCols} sort={listingSort} rows={m.stale} className="market-stale"
              rowKey={(l) => `${l.retainer_id}|${l.item_id}|${l.first_seen_at}|${l.quantity}|${l.unit_price}`} />
          )}
        </React.Fragment>
      )}
    </div>
  );
}
