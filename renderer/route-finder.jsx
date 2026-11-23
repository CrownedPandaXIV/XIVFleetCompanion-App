// Sub Calculator → Route Finder, in two tabs. Best routes: a build on one map, and the routes it can fly ranked by
// experience, gil or an item (ipc/calculator.js find-sub-routes, subs/route-finder.js), only through sectors the Free
// Company has discovered. Unlocks: what the FC can explore next, what could open by chance, and the way to the next map
// (get-fc-unlocks). The plugin's Route Finder page is the same.

const RF_HOURS = [[12, '12h'], [24, '24h'], [36, '36h'], [48, '48h'], [null, 'Any']];
const RF_RANK_BY = [['exp', 'Experience'], ['gil', 'Gil'], ['item', 'An item']];
const RF_STATE_TEXT = { explored: 'explored', discovered: 'explore next', chance: 'could open by chance', locked: 'not yet' };
const RF_ODDS = "New sectors open by chance, about 20–30% a voyage to the sector before (Pepper's guess); stats don't change the odds.";

function rfWhen(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// A sector letter as a tag: green explored, amber to explore, blue dashed could open, grey not yet; outlined when a must.
function RfLetter({ sector, state, must, title }) {
  const cls = state === 'explored' ? 'g' : state === 'discovered' ? 'a' : state === 'chance' ? 'c' : state === 'locked' ? 'l' : '';
  return <span className={`rf-letter ${cls}${must ? ' must' : ''}`} title={title || (sector ? sector.name : '')}>{sector ? sector.letter : '?'}</span>;
}

// A bar out of the best shown.
function RfBar({ value, max, dim }) {
  const pct = max > 0 ? Math.max(2, Math.min(100, (value / max) * 100)) : 0;
  return <span className={`rf-bar${dim ? ' dim' : ''}`}><i style={{ width: `${pct}%` }} /></span>;
}

// The loot tier each stop reaches: green when sure, amber when only by the lower figure, grey T1.
function RfTiers({ stops }) {
  return (
    <span className="rf-tiers">
      {stops.map((s) => {
        const cls = !s.tier || s.tier === 1 ? 't1' : s.tierSure === 'yes' ? 'sure' : 'maybe';
        return <span key={s.id} className={`rf-tier ${cls}`} title={s.tier ? `Tier ${s.tier}${s.tierSure === 'maybe' ? ', might not: the sources differ' : ''}` : 'No loot data yet'}>{s.tier ? `T${s.tier}` : '?'}</span>;
      })}
    </span>
  );
}

// A route's chances at new sectors, by the stop that may open them: "J and M open from I, P from L, Q from E: each voyage
// there is about a 20–30% chance (Pepper's guess); stats don't change the odds."
function rfChancesText(route, ctx) {
  const parts = route.map((id) => {
    const opens = [...ctx.sectorOf.values()].filter((s) => s.from === id && ctx.stateOf(s.id) === 'chance').sort((a, b) => a.id - b.id).map((s) => s.letter);
    if (!opens.length) return null;
    const list = opens.length === 1 ? opens[0] : `${opens.slice(0, -1).join(', ')} and ${opens[opens.length - 1]}`;
    return { list, from: ctx.sectorOf.get(id).letter, many: opens.length > 1 };
  }).filter(Boolean);
  const text = parts.map((p, i) => (i === 0 ? `${p.list} ${p.many ? 'open' : 'opens'} from ${p.from}` : `${p.list} from ${p.from}`)).join(', ');
  return `${text}: each voyage there is about a 20–30% chance (Pepper's guess); stats don't change the odds.`;
}

const RF_COLUMN_DEFS = [
  { key: 'route', label: 'Route', locked: true, td: (r, ctx) => (
    <td>
      <span className="rf-route">{r.route.map((id) => <RfLetter key={id} sector={ctx.sectorOf.get(id)} state={ctx.stateOf(id) === 'discovered' ? 'discovered' : null} must={ctx.must.includes(id)} />)}</span>
      {r.explores > 0 && <span className="rf-tag new" title="Sectors discovered but not explored yet: this voyage explores them">explores {r.route.filter((id) => ctx.stateOf(id) === 'discovered').map((id) => ctx.sectorOf.get(id).letter).join(', ')}</span>}
      {r.chances > 0 && <span className="rf-tag chance" title={rfChancesText(r.route, ctx)}>{r.chances} chance{r.chances === 1 ? '' : 's'} at new sectors</span>}
      {r === ctx.top && <span className="rf-tag best">best</span>}
    </td>
  ), sort: (r) => r.route.length },
  { key: 'voyage', label: 'Voyage', td: (r, ctx) => <td className="num"><span className="rf-barcell">{plannerHours(r.hours)}<RfBar value={r.hours} max={ctx.max.hours} dim /></span></td>, sort: (r) => r.hours },
  { key: 'exp', label: 'Exp / hour', td: (r, ctx) => <td className="num"><span className="rf-barcell"><span className={ctx.rankBy === 'exp' ? 'rf-lead' : ''}>{plannerN(r.expPerHour)}</span><RfBar value={r.expPerHour} max={ctx.max.exp} /></span></td>, sort: (r) => r.expPerHour },
  { key: 'gil', label: 'Gil / day', td: (r, ctx) => <td className="num"><span className="rf-barcell"><span className={ctx.rankBy === 'gil' ? 'rf-lead' : ''}>{plannerN(r.gilPerDay)}</span><RfBar value={r.gilPerDay} max={ctx.max.gil} /></span></td>, sort: (r) => r.gilPerDay },
  { key: 'item', label: 'Item / day', td: (r, ctx) => <td className="num">{r.itemPerDay === null ? <span className="dim">—</span>
    : <span className="rf-barcell"><span className="rf-lead">{r.itemPerDay.toFixed(2)}</span><RfBar value={r.itemPerDay} max={ctx.max.item} /></span>}</td>, sort: (r) => r.itemPerDay || 0 },
  { key: 'tiers', label: 'Loot tier per stop', td: (r) => <td><RfTiers stops={r.stops} /></td>, sort: (r) => r.stops.reduce((s, x) => s + (x.tier || 0), 0) },
  { key: 'range', label: 'Range', td: (r, ctx) => <td className="num" title={`${plannerN(ctx.range - r.range)} more range than this route uses (${plannerN(r.range)})`}><span className="finder-spare">+{plannerN(ctx.range - r.range)}</span></td>, sort: (r) => -r.range },
  { key: 'planner', label: 'Voyage Planner', td: (r, ctx) => <td><button className="finder-open" onClick={() => ctx.onOpen(r)}>Open in Voyage Planner</button></td> },
];

function RouteFinderView({ refreshKey, onOpenPlanner }) {
  const [base, setBase] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('routes');
  const [chosen, setChosen] = useState(null);
  const [rank, setRank] = useState(100);
  const [parts, setParts] = useState(['W+', 'C+', 'W+', 'C+']);
  const [editBuild, setEditBuild] = useState(false);
  const [mapId, setMapId] = useState(null);
  const [rankBy, setRankBy] = useState('exp');
  const [itemId, setItemId] = useState('');
  const [maxHours, setMaxHours] = useState(24);
  const [maxStops, setMaxStops] = useState(5);
  const [must, setMust] = useState([]);
  const [leaveOut, setLeaveOut] = useState([]);
  const [exploreFirst, setExploreFirst] = useState(false);
  const [fcId, setFcId] = useState(null);
  const [found, setFound] = useState(null);
  const [busy, setBusy] = useState(false);
  const [unlocks, setUnlocks] = useState(null);

  useEffect(() => {
    window.api.getSubCalculator().then((r) => {
      if (!r.success) { setError(r.error); return; }
      setError(null);
      setBase(r);
      setRank((k) => Math.min(k, r.maxRank || k));
      setMapId((m) => m ?? (r.maps.length ? r.maps[0].id : null));
      setFcId((f) => f ?? ((r.fcs || []).find((x) => x.readAt) || (r.fcs || [])[0] || {}).fcId ?? null);
    });
  }, [refreshKey]);

  // Worked out again a moment after each change (the newest answer only).
  const latest = useRef(0);
  useEffect(() => {
    if (!base || base.missingGameData || !mapId) return undefined;
    const call = ++latest.current;
    setBusy(true);
    const place = base.live ? pricePlaceOf(base, chosen, 'dc', {}) : null;
    const timer = setTimeout(() => {
      window.api.findSubRoutes({ rank, parts, mapId, maxStops, maxHours, must, leaveOut, rankBy: rankBy === 'item' && !itemId ? 'exp' : rankBy,
        itemId: rankBy === 'item' ? itemId : null, exploreFirst, fcId, place, scope: 'dc', limit: 100 }).then((r) => {
        if (call !== latest.current || r.stopped) return;
        setBusy(false);
        setFound(r.success ? r : { error: r.error });
      });
    }, 200);
    return () => clearTimeout(timer);
  }, [base, rank, parts, mapId, maxStops, maxHours, must, leaveOut, rankBy, itemId, exploreFirst, fcId, chosen, refreshKey]);

  useEffect(() => {
    if (!base || base.missingGameData || !fcId) { setUnlocks(null); return; }
    let current = true;
    window.api.getFcUnlocks(fcId).then((r) => { if (current) setUnlocks(r.success ? r : { error: r.error }); });
    return () => { current = false; };
  }, [base, fcId]);

  const sort = useColumnSort();
  const rowsIn = found && found.routes ? found.routes : null;
  const cols = useTableColumns({ tableKey: 'routeFinder', ownDefs: RF_COLUMN_DEFS, rows: rowsIn, idOf: () => null, contextKeys: ['item'], contextActive: rankBy === 'item' });

  if (error && !base) return <div className="error">Failed to load: {error}</div>;
  if (!base) return <div className="status">Loading...</div>;
  if (base.missingGameData) return <div className="status">The Route Finder needs the game data's sub tables. Update them in Settings → Data → Game Data.</div>;

  const sectorOf = new Map(base.sectors.map((s) => [s.id, s]));
  const mapName = (id) => (base.maps.find((m) => m.id === id) || {}).name || `Map ${id}`;
  const fc = (base.fcs || []).find((f) => f.fcId === fcId) || null;
  const tileOf = new Map((found && found.tiles ? found.tiles : []).map((t) => [t.id, t]));
  const stateOf = (id) => (tileOf.get(id) || {}).state ?? null;
  const onMap = base.sectors.filter((s) => s.map === mapId).sort((a, b) => a.id - b.id);
  const stats = found && found.stats;
  const mapItems = [...new Map(onMap.flatMap((s) => s.items.map((it) => [it.itemId, it]))).values()].sort((a, b) => a.name.localeCompare(b.name));

  const loadSub = (s) => {
    if (!s) return;
    setChosen(s);
    setRank(s.rank);
    setParts(s.parts);
    if (s.fcId) setFcId(s.fcId);
    const first = sectorOf.get(s.route[0]);
    if (first) { if (first.map !== mapId) setItemId(''); setMapId(first.map); setMust([]); setLeaveOut([]); }
  };
  const pickMap = (id) => { setMapId(id); setMust([]); setLeaveOut([]); setItemId(''); };
  // A tile: any → must → left out → any. Sectors the sub can't go to don't change.
  const cycle = (id) => {
    const t = tileOf.get(id);
    if (!t || !(t.state === null || t.state === 'explored' || t.state === 'discovered') || !t.rankOk) return;
    if (must.includes(id)) { setMust(must.filter((x) => x !== id)); setLeaveOut([...leaveOut, id]); return; }
    if (leaveOut.includes(id)) { setLeaveOut(leaveOut.filter((x) => x !== id)); return; }
    if (must.length >= maxStops) return;
    setMust([...must, id]);
  };
  // From the Unlocks tab: routes on that sector's map that go through it.
  const findThrough = (ids, explore) => {
    const first = sectorOf.get(ids[0]);
    if (!first) return;
    if (first.map !== mapId) setItemId('');
    setMapId(first.map);
    setLeaveOut([]);
    setMust(ids.length === 1 ? ids : []);
    if (explore) setExploreFirst(true);
    setTab('routes');
  };

  const routes = rowsIn ? (sort.sortColumn ? applyColumnSort(cols.rows, sort.sortColumn, sort.sortDirection, cols.accessors) : cols.rows) : [];
  const max = { hours: 0, exp: 0, gil: 0, item: 0 };
  for (const r of routes) {
    max.hours = Math.max(max.hours, r.hours); max.exp = Math.max(max.exp, r.expPerHour);
    max.gil = Math.max(max.gil, r.gilPerDay); max.item = Math.max(max.item, r.itemPerDay || 0);
  }
  const ctx = { sectorOf, stateOf, must, max, rankBy, range: stats ? stats.range : 0, top: routes[0],
    onOpen: (r) => onOpenPlanner({ rank, parts, route: r.route }) };
  const discoveredHere = onMap.filter((s) => stateOf(s.id) === 'discovered');
  const chanceHere = onMap.filter((s) => stateOf(s.id) === 'chance');
  const fcSelect = <FcPicker fcs={base.fcs} value={fcId} onChange={setFcId} />;
  const notRead = (
    <span className="dim">Not read yet: every sector is allowed. The plugin reads it in the workshop once the Voyage Control Panel's submarines
      are opened (AutoRetainer does at each collection).</span>
  );

  return (
    <div className="finder rf">
      <div className="rf-tabs" role="tablist">
        <button role="tab" className={tab === 'routes' ? 'on' : ''} onClick={() => setTab('routes')}>Best routes</button>
        <button role="tab" className={tab === 'unlocks' ? 'on' : ''} onClick={() => setTab('unlocks')}>Unlocks</button>
      </div>

      {tab === 'routes' && (
        <React.Fragment>
          <section className="finder-band">
            <h2 className="finder-heading">Your sub</h2>
            <div className="rf-sub">
              <PlannerSubPicker subs={base.subs} chosen={chosen} onChoose={loadSub} />
              {chosen && <button className="link-button" onClick={() => setChosen(null)} title="Stop starting from this sub; the build stays as it is">Clear sub</button>}
              {chosen && <span className="rf-subname">{chosen.subName}</span>}
              {chosen && <span className="dim">{[chosen.character, chosen.world, chosen.fc].filter(Boolean).join(' · ')}</span>}
              <span className="rf-pill">Rank {rank}</span>
              <span className="finder-parts">{parts.map((p, i) => <span key={i} className="finder-part">{p}</span>)}</span>
              <button className="link-button" onClick={() => setEditBuild(!editBuild)}>{editBuild ? 'Done' : 'Change parts or rank'}</button>
            </div>
            {editBuild && (
              <div className="finder-row">
                <label className="finder-field">Rank<input type="number" min="1" max={base.maxRank} value={rank}
                  onChange={(e) => setRank(Math.max(1, Math.min(base.maxRank, Number(e.target.value) || 1)))} /></label>
                {PLANNER_SLOTS.map((slot, i) => (
                  <label key={slot} className="finder-field">{slot}
                    <select value={parts[i]} onChange={(e) => setParts(parts.map((p, j) => (j === i ? e.target.value : p)))}>
                      {base.partLetters.map((p) => <option key={p.letter} value={p.letter}>{p.name}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            )}
            <div className="finder-needs">
              {PLANNER_STATS.map(([key, label]) => (
                <span key={key} className="finder-need"><span className="k">{label}</span><span className="v">{stats ? plannerN(stats[key]) : '—'}</span></span>
              ))}
            </div>
          </section>

          <section className="finder-band">
            <h2 className="finder-heading">Where it goes</h2>
            <div className="finder-row">
              <label className="finder-field">Map
                <select value={mapId ?? ''} onChange={(e) => pickMap(Number(e.target.value))}>
                  {base.maps.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </label>
              <span className="finder-field">Best for
                <span className="rf-seg">{RF_RANK_BY.map(([k, label]) => <button key={k} className={rankBy === k ? 'on' : ''} onClick={() => setRankBy(k)}>{label}</button>)}</span>
              </span>
              {rankBy === 'item' && (
                <select value={itemId} onChange={(e) => setItemId(e.target.value)}>
                  <option value="">Choose an item…</option>
                  {mapItems.map((it) => <option key={it.itemId} value={it.itemId}>{it.name}</option>)}
                </select>
              )}
              <span className="finder-field">Longest voyage
                <span className="rf-seg">{RF_HOURS.map(([h, label]) => <button key={label} className={maxHours === h ? 'on' : ''} onClick={() => setMaxHours(h)}>{label}</button>)}</span>
              </span>
              <label className="finder-field">Stops
                <select value={maxStops} onChange={(e) => setMaxStops(Number(e.target.value))}>
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>Up to {n}</option>)}
                </select>
              </label>
            </div>
            <div className="rf-note">
              <span className="finder-field">Sectors explored by {fcSelect}</span>
              {fc && fc.readAt ? <span className="dim">read at the workshop {rfWhen(fc.readAt)}.</span> : notRead}
            </div>
            <div className="finder-legend">
              <span><RfLetter sector={{ letter: 'A' }} state="explored" /> explored</span>
              <span><RfLetter sector={{ letter: 'B' }} state="discovered" /> explore next</span>
              <span><RfLetter sector={{ letter: 'C' }} state="chance" /> could open by chance</span>
              <span><RfLetter sector={{ letter: 'D' }} state="locked" /> not yet</span>
              <span><RfLetter sector={{ letter: 'E' }} must /> must be in the route</span>
              <span>Click a sector to make it a must, again to leave it out.</span>
            </div>
            <div className="rf-tiles">
              {onMap.map((s) => {
                const t = tileOf.get(s.id) || { state: null, rankOk: s.rankReq <= rank };
                const usable = (t.state === null || t.state === 'explored' || t.state === 'discovered') && t.rankOk;
                const isMust = must.includes(s.id);
                const out = leaveOut.includes(s.id);
                const status = isMust ? 'must be in the route' : out ? 'left out' : !t.rankOk ? `needs rank ${s.rankReq}`
                  : t.state === 'chance' ? `opens from ${(sectorOf.get(s.from) || {}).letter || '?'}`
                    : t.state === 'locked' ? (sectorOf.get(s.from) ? `after ${sectorOf.get(s.from).letter}` : 'not yet')
                      : t.state ? RF_STATE_TEXT[t.state] : `rank ${s.rankReq}`;
                return (
                  <button key={s.id} className={`rf-tile ${t.state || ''}${usable ? '' : ' off'}${isMust ? ' must' : ''}${out ? ' out' : ''}`}
                    onClick={() => cycle(s.id)} title={`${s.letter}: ${s.name}, rank ${s.rankReq}${s.from ? `; opens from ${(sectorOf.get(s.from) || {}).letter || '?'}` : ''}`}>
                    <span className="top"><RfLetter sector={s} state={t.state} /><span className="nm">{s.name}</span></span>
                    <span className="st">{status}</span>
                  </button>
                );
              })}
            </div>
            {(must.length > 0 || leaveOut.length > 0) && (
              <div className="rf-marks dim">{must.length > 0 && <span>Must go to <b>{must.map((id) => sectorOf.get(id).letter).join(', ')}</b>. </span>}
                {leaveOut.length > 0 && <span>Left out: <b>{leaveOut.map((id) => sectorOf.get(id).letter).join(', ')}</b>. </span>}
                <button className="link-button" onClick={() => { setMust([]); setLeaveOut([]); }}>Clear marks</button></div>
            )}
            {(discoveredHere.length > 0 || chanceHere.length > 0) && (
              <div className="rf-strip">
                {discoveredHere.length > 0 && <span><b>{discoveredHere.map((s) => s.letter).join(', ')}</b> can be explored next.</span>}
                <label className="finder-check"><input type="checkbox" checked={exploreFirst} onChange={(e) => setExploreFirst(e.target.checked)} /> Put routes that explore something new first</label>
              </div>
            )}
          </section>

          <section className="finder-band">
            <h2 className="finder-heading">Routes <span className="count">{exploreFirst ? 'new sectors first, then ' : ''}{rankBy === 'gil' ? 'most gil a day' : rankBy === 'item' && itemId ? 'most of the item a day' : 'best experience an hour'} first</span></h2>
            <Working busy={busy}>Working out the routes…</Working>
            {found && found.error && <div className="error">{found.error}</div>}
            {found && !found.error && (
              <div className="finder-tally">
                {found.total === null
                  ? <span>The best <b>{plannerN(routes.length)}</b> routes that fit{maxHours ? ` in ${maxHours}h` : ''} and are in range</span>
                  : <span><b>{plannerN(found.total)}</b> route{found.total === 1 ? '' : 's'} fit{maxHours ? ` in ${maxHours}h` : ''} and in range</span>}
                {must.length > 0 && <span>with <b>{must.map((id) => sectorOf.get(id).letter).join(', ')}</b></span>}
                {found.newOnes > 0 && <span className="warn"><b>{plannerN(found.newOnes)}</b> {found.total === null ? 'of these ' : ''}explore or could open something new</span>}
                <span>{found.pricing && found.pricing.source === 'market' ? `gil at market prices (${found.pricing.place})` : 'gil at vendor prices'}</span>
              </div>
            )}
            {routes.length > 0 && (
              <React.Fragment>
                <div className="controls finder-columns"><ColumnPicker cols={cols} /></div>
                <div className={`finder-table${busy ? ' is-busy' : ''}`}>
                  <table>
                    <thead><tr><ColumnHeadCells cols={cols} sortColumn={sort.sortColumn} sortDirection={sort.sortDirection} onSortClick={(k) => sort.handleSortClick(k)} /></tr></thead>
                    <tbody>{routes.map((r) => <tr key={r.route.join('-')}><ColumnBodyCells cols={cols} row={r} ctx={ctx} /></tr>)}</tbody>
                  </table>
                </div>
                {found.total !== null && found.total > routes.length && <div className="finder-more dim">Showing the best {routes.length} of {plannerN(found.total)}.</div>}
                <div className="finder-legend">
                  <span className="rf-tiers"><span className="rf-tier sure">T3</span><span className="rf-tier maybe">T2</span></span> loot tier this build reaches at each stop (amber: the sources differ, so it might not)
                  <span className="finder-spare">+11</span> range to spare
                </div>
              </React.Fragment>
            )}
            {found && !found.error && routes.length === 0 && !busy && (
              <div className="status">{!stats ? "This rank or one of these parts isn't in the game data."
                : must.some((id) => !(tileOf.get(id) || {}).allowed) ? "A must isn't a sector this sub can go to."
                  : `No route fits${maxHours ? ` in ${maxHours}h` : ''} with this sub's range${must.length ? ' and these musts' : ''}. Try a longer voyage or fewer musts.`}</div>
            )}
          </section>
        </React.Fragment>
      )}

      {tab === 'unlocks' && (
        <React.Fragment>
          <div className="rf-note">
            <span className="finder-field">Free Company {fcSelect}</span>
            {fc && fc.readAt ? <span className="dim">Read at the workshop {rfWhen(fc.readAt)}. {RF_ODDS}</span> : notRead}
          </div>
          {unlocks && unlocks.error && <div className="error">{unlocks.error}</div>}
          {unlocks && unlocks.read && (
            <React.Fragment>
              <div className="rf-cards">
                <section className="rf-card sure">
                  <h3>Sure next <span className="count">{unlocks.sure.length} sector{unlocks.sure.length === 1 ? '' : 's'}</span></h3>
                  <div className="dim rf-card-sub">Discovered, not explored yet: any voyage there explores it.</div>
                  {unlocks.sure.length === 0 && <div className="dim">Nothing waiting.</div>}
                  {unlocks.sure.map((id) => {
                    const s = sectorOf.get(id);
                    return (
                      <div key={id} className="rf-step">
                        <RfLetter sector={s} state="discovered" />
                        <span className="what">{s.name}<small>{mapName(s.map)} · rank {s.rankReq}</small></span>
                        <button className="finder-open" onClick={() => findThrough([id])}>Find a route</button>
                      </div>
                    );
                  })}
                </section>
                <section className="rf-card chance">
                  <h3>Could open <span className="count">{unlocks.chance.length} sector{unlocks.chance.length === 1 ? '' : 's'}</span></h3>
                  <div className="dim rf-card-sub">Go to the sector before it; each voyage there is a roll.</div>
                  {unlocks.chance.length === 0 && <div className="dim">Nothing yet.</div>}
                  {unlocks.chance.map(({ id, from }) => {
                    const s = sectorOf.get(id);
                    const f = sectorOf.get(from);
                    return (
                      <div key={id} className="rf-step">
                        <RfLetter sector={s} state="chance" />
                        <span className="what">{s.name}<small>{mapName(s.map)} · opens from <b>{f ? f.letter : '?'}</b>{f ? `, ${f.name}` : ''} · rank {s.rankReq}</small></span>
                        {f && <button className="finder-open" onClick={() => findThrough([from], true)}>Routes via {f.letter}</button>}
                      </div>
                    );
                  })}
                </section>
                <section className="rf-card map">
                  <h3>Next map <span className="count">{unlocks.nextMap ? unlocks.nextMap.name : 'all open'}</span></h3>
                  {!unlocks.nextMap && <div className="dim">Every map is open.</div>}
                  {unlocks.nextMap && (
                    <React.Fragment>
                      <div className="dim rf-card-sub">{unlocks.nextMap.name} opens from {(() => { const s = sectorOf.get(unlocks.nextMap.steps[unlocks.nextMap.steps.length - 2] ? unlocks.nextMap.steps[unlocks.nextMap.steps.length - 2].id : 0); return s ? `${s.letter}, ${s.name}, on ${mapName(s.map)}` : 'a sector not open yet'; })()}.</div>
                      <div className="rf-path">
                        {unlocks.nextMap.steps.map((step, i) => {
                          const s = sectorOf.get(step.id);
                          const last = i === unlocks.nextMap.steps.length - 1;
                          const text = step.how === 'explore' ? `Explore ${s.name}` : step.how === 'go' ? `Go to ${s.name}`
                            : last ? `${unlocks.nextMap.name} opens from ${sectorOf.get(unlocks.nextMap.steps[i - 1].id).letter}`
                              : `${s.name} opens from ${sectorOf.get(unlocks.nextMap.steps[i - 1].id).letter}`;
                          return (
                            <div key={step.id} className="rf-step">
                              <RfLetter sector={s} state={step.how === 'explore' ? 'discovered' : step.how === 'go' ? 'explored' : 'locked'} />
                              <span className="what">{text}</span>
                              <span className={step.how === 'chance' ? 'rf-tag chance' : 'rf-tag new'}>{step.how === 'chance' ? 'by chance' : 'sure'}</span>
                            </div>
                          );
                        })}
                      </div>
                      <div className="dim">{unlocks.nextMap.steps.filter((x) => x.how === 'chance').length} sector{unlocks.nextMap.steps.filter((x) => x.how === 'chance').length === 1 ? '' : 's'} to open by chance on the way.</div>
                    </React.Fragment>
                  )}
                </section>
              </div>

              <section className="finder-band">
                <h2 className="finder-heading">Your maps</h2>
                <div className="finder-legend">
                  <span><RfLetter sector={{ letter: 'A' }} state="explored" /> explored</span>
                  <span><RfLetter sector={{ letter: 'B' }} state="discovered" /> discovered, explore next</span>
                  <span><RfLetter sector={{ letter: 'C' }} state="chance" /> could open by chance</span>
                  <span><RfLetter sector={{ letter: 'D' }} state="locked" /> not yet</span>
                </div>
                {unlocks.maps.map((m) => {
                  const list = base.sectors.filter((s) => s.map === m.id).sort((a, b) => a.id - b.id);
                  const opener = !m.open && list[0] && list[0].from ? sectorOf.get(list[0].from) : null;
                  return (
                    <div key={m.id} className="rf-map">
                      <div className="rf-map-head">
                        <span className="rf-map-name">{m.name}</span>
                        <span className="dim">{(() => { const lo = Math.min(...list.map((s) => s.rankReq)); const hi = Math.max(...list.map((s) => s.rankReq)); return lo === hi ? `rank ${lo}` : `ranks ${lo}–${hi}`; })()}</span>
                        <span className="rf-prog"><RfBar value={m.explored} max={m.total} />{m.open ? `${m.explored} of ${m.total} explored${m.discovered ? ` · ${m.discovered} to explore` : ''}` : 'not open yet'}</span>
                      </div>
                      {m.open ? (
                        <div className="rf-grid">
                          {list.map((s) => {
                            const st = unlocks.states[s.id];
                            return <span key={s.id} className={`rf-sq ${st}`} title={`${s.letter}: ${s.name}, ${RF_STATE_TEXT[st]}, rank ${s.rankReq}`}><RfLetter sector={s} state={st} /><span className="nm">{s.name}</span></span>;
                          })}
                        </div>
                      ) : (
                        <div className="dim">Opens from {opener ? <React.Fragment><RfLetter sector={opener} state={unlocks.states[opener.id]} /> {opener.name} on {mapName(opener.map)}</React.Fragment> : 'a sector on the map before'}, by chance.</div>
                      )}
                    </div>
                  );
                })}
              </section>
            </React.Fragment>
          )}
        </React.Fragment>
      )}

      <div className="planner-foot dim">
        Routes: every set of up to 5 sectors, each in the fastest order the sub's range allows. Loot and breakpoints: XIVStats
        {base.about && base.about.pepper ? ", checked against Pepper's FFXIV Ship Guide" : ''}; what opens what: XIVStats; unlock odds: Pepper's guide.
      </div>
    </div>
  );
}
