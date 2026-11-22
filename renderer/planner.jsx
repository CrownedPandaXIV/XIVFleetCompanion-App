// Sub Calculator → Planner: pick a build and a route, see its stats, voyage, the tiers each sector reaches, the loot
// it can bring back, and its gil, experience and repair cost a day (ipc/calculator.js, subs/calculator.js).

const PLANNER_SLOTS = ['Hull', 'Stern', 'Bow', 'Bridge'];
// How often an item comes, as a chance per voyage in words.
function plannerOften(chance) {
  if (!(chance > 0)) return '—';
  if (chance >= 0.95) return 'nearly every voyage';
  if (chance >= 0.45) return `about ${Math.round(chance * 10)} in 10 voyages`;
  return `about 1 in ${Math.round(1 / chance).toLocaleString()} voyages`;
}
const PLANNER_SCOPES = { world: 'World', dc: 'Data center', region: 'Region' };
const PLANNER_STATS = [['surveillance', 'Surveillance'], ['retrieval', 'Retrieval'], ['speed', 'Speed'], ['range', 'Range'], ['favor', 'Favor']];
const plannerN = (v, digits = 0) => (v === null || v === undefined ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits }));
const plannerHours = (h) => `${Math.floor(h)}h ${String(Math.round((h % 1) * 60)).padStart(2, '0')}m`;
const plannerRange = (bp) => (bp.low === bp.high ? plannerN(bp.low) : `${plannerN(bp.low)}–${plannerN(bp.high)}`);

// A result as a coloured word: sure (green), only by one source's figure (amber), not reached (red).
function PlannerPill({ sure, children }) {
  const tone = sure === 'yes' ? 'tone-good' : sure === 'maybe' ? 'tone-warn' : 'tone-danger';
  return <span className={`planner-pill ${tone}`}>{children}</span>;
}

// The "What this build reaches" table's columns. A sector without XIVStats data says so in its Loot tier cell.
const plannerNoData = (s) => !s.hasData;
const plannerDash = <span className="dim">—</span>;
const PLANNER_REACH_DEFS = [
  { key: 'sector', label: 'Sector', locked: true, cell: (s) => `${s.letter}: ${s.name}`, sort: (s) => s.letter },
  { key: 'tier', label: 'Loot tier', cell: (s) => (plannerNoData(s) ? <span className="dim">No XIVStats data for this sector yet.</span> : (
    <React.Fragment>
      <PlannerPill sure={s.result.tierSure}>Tier {s.result.tier}</PlannerPill>
      {s.result.tier < 3 ? <div className="dim">{plannerN(s.result.need.t3)} more surveillance for T3</div>
        : s.result.tierSure === 'maybe' ? <div className="tone-warn">{plannerN(s.result.need.t3)} more to be sure</div> : null}
    </React.Fragment>)), sort: (s) => (s.result ? s.result.tier : null) },
  { key: 'retrieval', label: 'Retrieval', cell: (s) => (plannerNoData(s) ? plannerDash : (
    <React.Fragment>
      <PlannerPill sure={s.result.retrieval === 'optimal' ? s.result.retrievalSure : s.result.retrieval === 'normal' ? 'maybe' : 'no'}>
        {s.result.retrieval[0].toUpperCase() + s.result.retrieval.slice(1)}</PlannerPill>
      {s.result.retrieval !== 'optimal' || s.result.retrievalSure === 'maybe'
        ? <div className="dim">{plannerN(s.result.need.optimal)} more retrieval for optimal</div> : null}
    </React.Fragment>)), sort: (s) => (s.result ? ['poor', 'normal', 'optimal'].indexOf(s.result.retrieval) : null) },
  { key: 'doubleDip', label: 'Double dip', cell: (s) => (plannerNoData(s) ? plannerDash : (
    <React.Fragment>
      <PlannerPill sure={s.result.doubleDip}>{s.result.doubleDip === 'yes' ? 'Yes' : s.result.doubleDip === 'maybe' ? 'Maybe' : 'No'}</PlannerPill>
      {s.result.doubleDip !== 'yes' && <div className="dim">{plannerN(s.result.need.favor)} more favor</div>}
    </React.Fragment>)), sort: (s) => (s.result ? ['no', 'maybe', 'yes'].indexOf(s.result.doubleDip) : null) },
  { key: 'tiers', label: 'T2 / T3 at', td: (s) => <td className="num">{plannerNoData(s) ? plannerDash : `${plannerRange(s.breakpoints[0])} / ${plannerRange(s.breakpoints[1])}`}</td>,
    sort: (s) => (s.breakpoints ? s.breakpoints[1].high : null) },
  { key: 'retrievals', label: 'Normal / Optimal at', td: (s) => <td className="num">{plannerNoData(s) ? plannerDash : `${plannerRange(s.breakpoints[2])} / ${plannerRange(s.breakpoints[3])}`}</td>,
    sort: (s) => (s.breakpoints ? s.breakpoints[3].high : null) },
  { key: 'favor', label: 'Favor at', td: (s) => <td className="num">{plannerNoData(s) ? plannerDash : plannerRange(s.breakpoints[4])}</td>,
    sort: (s) => (s.breakpoints ? s.breakpoints[4].high : null) },
  { key: 'bonus', label: 'Bonus exp', td: (s) => <td className="num" title={`${plannerN(s.exp)} experience before bonuses`}>
    {plannerNoData(s) ? plannerDash : `${s.bonus.sure > 0 ? `+${s.bonus.sure}% sure, ` : ''}up to +${s.bonus.best}%`}</td>, sort: (s) => (s.bonus ? s.bonus.best : null) },
];

// The "Possible loot" table's columns.
const PLANNER_LOOT_DEFS = [
  { key: 'item', label: 'Item', locked: true, cell: (l) => l.name, sort: (l) => l.name },
  { key: 'tier', label: 'Tier', cell: (l) => `T${l.tier}`, sort: (l) => l.tier },
  { key: 'sectors', label: 'Sectors', cell: (l) => l.sectors.join(', ') || '—', sort: (l) => l.sectors.join(',') || null },
  { key: 'amount', label: 'Amount each time', td: (l) => <td className="num">{l.low === l.high ? l.low : `${l.low}–${l.high}`}</td>, sort: (l) => l.high },
  // How often it comes at all, in words ("about 1 in 15 voyages"): a rare item's gil per voyage is an average.
  { key: 'often', label: 'How often', td: (l) => <td className={l.perVoyage > 0 ? '' : 'dim'} title={l.perVoyage > 0 ? `${plannerN(l.chance * 100, 1)}% of voyages` : ''}>
    {l.perVoyage > 0 ? plannerOften(l.chance) : '—'}</td>, sort: (l) => l.chance },
  { key: 'perVoyage', label: 'Per voyage', td: (l) => <td className="num">{l.perVoyage > 0 ? plannerN(l.perVoyage, 2) : '—'}</td>, sort: (l) => l.perVoyage },
  // One of it at the price used (market or vendor): something to aim for. Amber where the market price was adjusted
  // (a lone low listing skipped, or recent sales used): the hover says why.
  { key: 'price', label: 'Price each', td: (l) => <td className={`num gil${l.note ? ' tone-warn' : ''}`} title={l.note || ''}>{l.price > 0 ? plannerN(l.price) : '—'}</td>,
    sort: (l) => l.price },
  { key: 'gil', label: 'Gil per voyage', td: (l) => <td className="num gil" title="On average: how many a voyage × the price each">{l.gil > 0 ? plannerN(l.gil) : '—'}</td>,
    sort: (l) => l.gil },
];

// Where a sub is: out until a time (the day too when it isn't today), back waiting to be collected, or in port.
function plannerWhere(returnTime, now = Date.now() / 1000) {
  if (!returnTime) return { text: 'In port', tone: 'dim' };
  if (returnTime <= now) return { text: 'Back, waiting', tone: 'tone-good' };
  const at = new Date(returnTime * 1000);
  const sameDay = at.toDateString() === new Date(now * 1000).toDateString();
  const time = at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return { text: `At sea until ${sameDay ? time : `${at.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`}`, tone: '' };
}

// Choosing one of your subs: a panel grouped by account, then character (world, Free Company), each group folding
// away, with a search across character, world, account, Free Company and sub name. Each row: rank, build, route and
// where the sub is now.
function PlannerSubPicker({ subs, chosen, onChoose }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [folded, setFolded] = useState(() => new Set());
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = subs.filter((s) => {
    const hay = `${s.subName} ${s.character} ${s.world} ${s.account} ${s.fc}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  // Accounts in name order (no label last), characters as the roster orders them.
  const accounts = [];
  for (const s of shown) {
    const account = s.account || 'No account label';
    let a = accounts.find((x) => x.name === account);
    if (!a) accounts.push(a = { name: account, characters: [] });
    let c = a.characters.find((x) => x.cid === s.cid);
    if (!c) a.characters.push(c = { cid: s.cid, name: s.character, world: s.world, fc: s.fc, subs: [] });
    c.subs.push(s);
  }
  accounts.sort((a, b) => (a.name === 'No account label') - (b.name === 'No account label') || a.name.localeCompare(b.name));
  const toggle = (key) => setFolded((f) => { const n = new Set(f); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const isFolded = (key) => !words.length && folded.has(key);
  const now = Date.now() / 1000;

  return (
    <div className="planner-picker" ref={box}>
      <button type="button" className="planner-picker-button" onClick={() => setOpen(!open)} disabled={!subs.length}>
        {!subs.length ? 'No subs synced yet' : chosen ? `${chosen.subName} · ${chosen.character}` : 'Choose one of your subs…'}
        <span className="dim"> ▾</span>
      </button>
      {open && (
        <div className="planner-picker-panel">
          <input type="search" autoFocus placeholder="Search character, world, account, FC or sub" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="planner-picker-list">
            {!shown.length && <div className="dim planner-picker-empty">No sub matches “{search}”.</div>}
            {accounts.map((a) => (
              <div key={a.name}>
                <button type="button" className="planner-picker-account" onClick={() => toggle(`a|${a.name}`)}>
                  {isFolded(`a|${a.name}`) ? '▸' : '▾'} {a.name} <span className="dim">({a.characters.reduce((n, c) => n + c.subs.length, 0)})</span>
                </button>
                {!isFolded(`a|${a.name}`) && a.characters.map((c) => (
                  <div key={c.cid} className="planner-picker-character">
                    <button type="button" className="planner-picker-character-name" onClick={() => toggle(`c|${c.cid}`)}>
                      {isFolded(`c|${c.cid}`) ? '▸' : '▾'} {c.name}{c.world ? <span className="dim"> ({c.world})</span> : null}
                      {c.fc ? <span className="dim"> · {c.fc}</span> : null}
                    </button>
                    {!isFolded(`c|${c.cid}`) && c.subs.map((s) => {
                      const where = plannerWhere(s.returnTime, now);
                      const isChosen = chosen && chosen.cid === s.cid && chosen.subName === s.subName;
                      return (
                        <button type="button" key={s.subName} className={`planner-picker-sub${isChosen ? ' chosen' : ''}`}
                          onClick={() => { onChoose(s); setOpen(false); }}>
                          <span className="planner-picker-sub-name">{s.subName}</span>
                          <span>Rank {s.rank}</span>
                          <span>{s.parts.join('')}</span>
                          <span>{s.routeText || <span className="dim">no route</span>}</span>
                          <span className={where.tone}>{where.text}</span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// openSub: { cid, subName, at } from "Open in Planner" on the Subs or Route Optimization page; loaded once, then
// onOpenSubUsed clears it.
// The chosen sub's world, data center and region (else those of the world most of the player's subs are on):
// { world, dc, region } names, from Universalis's list (base.markets); null when the world isn't known.
function plannerHome(base, chosen) {
  const world = (chosen && chosen.world) || (base.worlds || [])[0];
  if (!world) return null;
  const known = ((base.markets && base.markets.world) || []).find((w) => w.name.toLowerCase() === String(world).toLowerCase());
  return known ? { world: known.name, dc: known.dc, region: known.region } : { world, dc: null, region: null };
}

// The world, data center or region the loot is priced on: the one picked for this scope, else the sub's own.
function pricePlaceOf(base, chosen, scope, picked) {
  if (picked[scope]) return picked[scope];
  const home = plannerHome(base, chosen);
  return home ? home[scope] : null;
}

function PlannerView({ refreshKey, openSub, onOpenSubUsed }) {
  const [base, setBase] = useState(null);
  const [error, setError] = useState(null);
  const [rank, setRank] = useState(100);
  const [parts, setParts] = useState(['W+', 'C+', 'W+', 'C+']);
  const [mapId, setMapId] = useState(null);
  const [route, setRoute] = useState([]);
  const [adding, setAdding] = useState('');
  const [plan, setPlan] = useState(null);
  const [chosen, setChosen] = useState(null);
  // Live Market Prices: the world to price on (the chosen sub's, else this one, else the most common) and the scope.
  // Where to price the loot: a scope, and a world, data center or region picked from all of them (loot can be moved
  // to a character elsewhere and sold there). Not picked: the chosen sub's own (else the most common world's).
  const [priceScope, setPriceScope] = useState('dc');
  const [pricePicked, setPricePicked] = useState({ world: null, dc: null, region: null });

  useEffect(() => {
    window.api.getSubCalculator().then((r) => {
      if (!r.success) { setError(r.error); return; }
      setError(null);
      setBase(r);
      setMapId((m) => m ?? (r.maps.length ? r.maps[r.maps.length - 1].id : null));
    });
  }, [refreshKey]);

  useEffect(() => {
    if (!base || base.missingGameData) return;
    let current = true;
    const place = base.live ? pricePlaceOf(base, chosen, priceScope, pricePicked) : null;
    window.api.planSubVoyage({ rank, parts, route, place, scope: priceScope }).then((r) => { if (current) setPlan(r.success ? r : { error: r.error }); });
    return () => { current = false; };
  }, [base, rank, parts, route, chosen, pricePicked, priceScope]);
  // Choosing another sub starts from its own world, data center and region again.
  useEffect(() => { setPricePicked({ world: null, dc: null, region: null }); }, [chosen]);

  // The two tables, as every page's: resizable columns you can drag to move, click to sort, and the Columns menu.
  const reachSort = useColumnSort();
  const reachCols = useTableColumns({ tableKey: 'plannerReach', ownDefs: PLANNER_REACH_DEFS, rows: plan && plan.sectors ? plan.sectors : null, idOf: () => null });
  const lootSort = useColumnSort();
  const lootCols = useTableColumns({ tableKey: 'plannerLoot', ownDefs: PLANNER_LOOT_DEFS, rows: plan && plan.loot ? plan.loot : null, idOf: () => null });

  // "Open in Planner": load that sub once the page has its subs.
  useEffect(() => {
    if (!openSub || !base || !base.subs) return;
    if (openSub.build) {
      // A build and route from the Build Finder.
      const { rank: r, parts: p, route: rt } = openSub.build;
      setChosen(null);
      setRank(r);
      setParts(p);
      setRoute((rt || []).slice(0, 5));
      const first = base.sectors.find((x) => x.id === (rt || [])[0]);
      if (first) setMapId(first.map);
      if (onOpenSubUsed) onOpenSubUsed();
      return;
    }
    const s = base.subs.find((x) => x.cid === String(openSub.cid) && x.subName === openSub.subName);
    if (s) {
      setChosen(s);
      setRank(s.rank);
      setParts(s.parts);
      setRoute(s.route.slice(0, 5));
      const first = base.sectors.find((x) => x.id === s.route[0]);
      if (first) setMapId(first.map);
    }
    if (onOpenSubUsed) onOpenSubUsed();
  }, [openSub, base]);

  if (error && !base) return <div className="error">Failed to load: {error}</div>;
  if (!base) return <div className="status">Loading...</div>;
  if (base.missingGameData) {
    return <div className="status">The Planner needs the game data's sub tables. Update them in Settings → Data → Game Data.</div>;
  }

  const sectorOf = new Map(base.sectors.map((s) => [s.id, s]));
  const onMap = base.sectors.filter((s) => s.map === mapId && !route.includes(s.id)).sort((a, b) => a.id - b.id);
  const stats = plan && plan.stats;
  const over = stats && plan.range !== null && plan.range > stats.range;
  const tooHigh = route.map((id) => sectorOf.get(id)).filter((s) => s && s.rankReq > rank);

  const loadSub = (s) => {
    if (!s) return;
    setChosen(s);
    setRank(s.rank);
    setParts(s.parts);
    setRoute(s.route.slice(0, 5));
    const first = sectorOf.get(s.route[0]);
    if (first) setMapId(first.map);
  };
  const add = () => {
    const id = Number(adding || (onMap[0] && onMap[0].id));
    if (id && route.length < 5) { setRoute([...route, id]); setAdding(''); }
  };
  const bestOrder = () => window.api.planSubVoyage({ rank, parts, route, bestOrder: true }).then((r) => { if (r.success && r.route) setRoute(r.route); });

  return (
    <div className="planner">
      <div className="controls">
        <label>Start from one of your subs</label>{' '}
        <PlannerSubPicker subs={base.subs} chosen={chosen} onChoose={loadSub} />
        {chosen && <span className="dim planner-picker-note">Change anything below to try other builds; your sub isn't changed.</span>}
      </div>

      <div className="planner-row">
        <div className="account-group planner-panel">
          <h2>Build</h2>
          <div className="planner-fields">
            <label>Rank<input type="number" min="1" max={base.maxRank} value={rank}
              onChange={(e) => setRank(Math.max(1, Math.min(base.maxRank, Number(e.target.value) || 1)))} /></label>
            {PLANNER_SLOTS.map((slot, i) => (
              <label key={slot}>{slot}
                <select value={parts[i]} onChange={(e) => setParts(parts.map((p, j) => (j === i ? e.target.value : p)))}>
                  {base.partLetters.map((p) => <option key={p.letter} value={p.letter}>{p.name}</option>)}
                </select>
              </label>
            ))}
          </div>
          <div className="planner-stats">
            {PLANNER_STATS.map(([key, label]) => (
              <div key={key} className="planner-stat"><b>{stats ? plannerN(stats[key]) : '—'}</b><span>{label}</span></div>
            ))}
          </div>
          {plan && !stats && <div className="supply-card-note">This rank or one of these parts isn't in the game data.</div>}
        </div>

        <div className="account-group planner-panel">
          <h2>Route <span className="count">{route.length} of 5 sectors</span></h2>
          <div className="planner-fields">
            <label>Map
              <select value={mapId ?? ''} onChange={(e) => { setMapId(Number(e.target.value)); setRoute([]); }}>
                {base.maps.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
            <label>Add a sector
              <span className="planner-add">
                <select value={adding} onChange={(e) => setAdding(e.target.value)} disabled={route.length >= 5}>
                  {onMap.map((s) => <option key={s.id} value={s.id}>{s.letter}: {s.name} (rank {s.rankReq}){s.hasData ? '' : ', no loot data yet'}</option>)}
                </select>
                <button onClick={add} disabled={route.length >= 5 || !onMap.length}>Add</button>
              </span>
            </label>
          </div>
          <div className="planner-route">
            {route.length === 0 && <span className="dim">Add up to 5 sectors.</span>}
            {route.map((id, i) => {
              const s = sectorOf.get(id);
              return (
                <span key={id} className="planner-chip">
                  <span className="dim">{i + 1}</span> {s ? `${s.letter}: ${s.name}` : `Sector ${id}`}
                  <button title="Remove" onClick={() => setRoute(route.filter((x) => x !== id))}>×</button>
                </span>
              );
            })}
            {route.length > 1 && <button onClick={bestOrder} title="Put the sectors in the fastest order this sub's range allows">Best order</button>}
          </div>
          {plan && plan.route && plan.route.length > 0 && stats && (
            <div className="planner-facts">
              <div><span>Range used</span><b className={over ? 'tone-danger' : ''}>{plannerN(plan.range)} / {plannerN(stats.range)}</b>
                {over && <div className="tone-danger">Out of range: needs {plannerN(plan.range - stats.range)} more range</div>}</div>
              <div><span>Voyage</span><b>{plannerHours(plan.hours)}</b></div>
              <div><span>Experience</span><b>{plannerN(plan.expSure)}</b>
                <div className="dim" title="Bonus experience, from Pepper's FFXIV Ship Guide: optimal retrieval +25% (sure once its breakpoint is met); T2 loot +25%, T3 loot +50%, HQ materials +25% and a double dip +25% (luck); at most +100% a sector">
                  {plan.expSure > plan.exp ? `${plannerN(plan.exp)} + sure bonus; ` : ''}up to {plannerN(plan.expBest)} with luck</div></div>
              <div><span>Ceruleum</span><b>{plannerN(plan.tanks)} tank{plan.tanks === 1 ? '' : 's'}</b></div>
            </div>
          )}
          {tooHigh.length > 0 && <div className="tone-warn">Rank {rank} can't go to {tooHigh.map((s) => s.letter).join(', ')} yet.</div>}
        </div>
      </div>

      {plan && plan.sectors && plan.sectors.length > 0 && (
        <React.Fragment>
          {base.live && (
            <div className="controls planner-prices">
              <span className="dim">Market prices on the</span>
              <span className="planner-scope">
                {Object.entries(PLANNER_SCOPES).map(([k, label]) => (
                  <button key={k} className={priceScope === k ? 'active' : ''} onClick={() => setPriceScope(k)}>{label}</button>
                ))}
              </span>
              {(() => {
                const home = plannerHome(base, chosen);
                const own = home ? home[priceScope] : null;
                const options = (base.markets && base.markets[priceScope]) || [];
                const value = pricePlaceOf(base, chosen, priceScope, pricePicked) || '';
                const whose = chosen ? `${chosen.subName}'s` : 'your most common';
                const label = (o) => (priceScope === 'region' ? o.label : o.name);
                return (
                  <select className="planner-place" value={value} onChange={(e) => setPricePicked({ ...pricePicked, [priceScope]: e.target.value })}>
                    {own && <option value={own}>{priceScope === 'region' ? ((options.find((o) => o.name === own) || {}).label || own) : own} ({whose} {PLANNER_SCOPES[priceScope].toLowerCase()})</option>}
                    {options.filter((o) => o.name !== own).map((o) => <option key={o.name} value={o.name}>{label(o)}{priceScope === 'world' ? ` (${o.dc})` : ''}</option>)}
                    {!options.length && !own && <option value="">Universalis's list couldn't be read</option>}
                  </select>
                );
              })()}
              {plan.pricing && plan.pricing.adjusted > 0 && (
                <span className="tone-warn" title="A lone listing far below the others was skipped, or the last week's sales were used: hover a price for why.">
                  {plan.pricing.adjusted} price{plan.pricing.adjusted === 1 ? '' : 's'} adjusted for odd listings</span>
              )}
              {plan.pricing && plan.pricing.error && <span className="tone-warn">Universalis: {plan.pricing.error} Vendor prices are shown.</span>}
              {plan.pricing && plan.pricing.stale && <span className="tone-warn">Some prices are from earlier: {plan.pricing.stale.problem}</span>}
            </div>
          )}
          <div className="supplies-summary planner-summary">
            <div className="account-group supply-card">
              <div className="supply-card-label">Gil per voyage</div>
              <div className="supply-card-value gil">{plannerN(plan.gilPerVoyage)}</div>
              <div className="supply-card-note">{plan.pricing && plan.pricing.source === 'market'
                ? `expected, at market prices (${PLANNER_SCOPES[plan.pricing.scope]}${plan.pricing.place ? `: ${plan.pricing.place}` : ''})`
                : 'expected, at vendor prices (salvage at the Salvage page\'s)'}</div>
            </div>
            <div className="account-group supply-card">
              <div className="supply-card-label">Gil per day</div>
              <div className="supply-card-value gil">{plannerN(plan.gilPerDay)}</div>
              <div className="supply-card-note">sent out again as soon as it's back ({plannerN(plan.voyagesPerDay, 2)} voyages a day)</div>
            </div>
            <div className="account-group supply-card">
              <div className="supply-card-label">Experience per day</div>
              <div className="supply-card-value">{plannerN(plan.expSure * plan.voyagesPerDay)}</div>
              <div className="supply-card-note">with the bonus it's sure of; up to {plannerN(plan.expBest * plan.voyagesPerDay)} with luck</div>
            </div>
            <div className="account-group supply-card">
              <div className="supply-card-label">Repairs</div>
              <div className="supply-card-value">{plan.kitsPerVoyage === null ? '—' : `${plannerN(plan.kitsPerVoyage * plan.voyagesPerDay, 1)} kits a day`}</div>
              <div className="supply-card-note">
                {plan.repairGilPerDay ? `${plannerN(plan.repairGilPerDay)} gil a day at ${plannerN(plan.repairKitCost)} a kit; ` : 'Set the repair kit price on the Supplies page for the gil; '}
                parts last {plan.wear.every(Boolean) ? `${Math.min(...plan.wear.map((w) => w.voyagesLasting ?? Infinity))} voyages` : '—'}
              </div>
            </div>
          </div>

          <div className="account-group">
            <h2>What this build reaches <span className="count">amber: the sources differ, so it might not</span></h2>
            <div className="controls"><ColumnPicker cols={reachCols} /></div>
            <ColumnTable cols={reachCols} sort={reachSort} rows={reachCols.rows} rowKey={(s) => s.id} />
          </div>

          <div className="account-group">
            <h2>Possible loot <span className="count">greyed: tiers this build can't count on</span></h2>
            <div className="controls"><ColumnPicker cols={lootCols} /></div>
            <ColumnTable cols={lootCols} sort={lootSort} rows={lootCols.rows} rowKey={(l) => l.itemId} rowClassName={(l) => (l.perVoyage > 0 ? '' : 'dim')} />
          </div>
        </React.Fragment>
      )}

      <div className="planner-foot dim">
        Loot and breakpoints: XIVStats (updated {base.about.xivstats.updated ? new Date(base.about.xivstats.updated).toLocaleDateString() : '—'})
        {base.about.pepper ? ", checked against Pepper's FFXIV Ship Guide" : ''}. Range, voyage time and wear as Submarine Tracker works them out.
        Expected loot counts a breakpoint only when both sources agree it's met. Bonus experience as Pepper's guide gives it.
      </div>
    </div>
  );
}
