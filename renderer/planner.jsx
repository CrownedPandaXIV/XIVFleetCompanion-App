// Sub Calculator → Planner: pick a build and a route, see its stats, voyage, the tiers each sector reaches, the loot
// it can bring back, and its gil, experience and repair cost a day (ipc/calculator.js, subs/calculator.js).

const PLANNER_SLOTS = ['Hull', 'Stern', 'Bow', 'Bridge'];
const PLANNER_STATS = [['surveillance', 'Surveillance'], ['retrieval', 'Retrieval'], ['speed', 'Speed'], ['range', 'Range'], ['favor', 'Favor']];
const plannerN = (v, digits = 0) => (v === null || v === undefined ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits }));
const plannerHours = (h) => `${Math.floor(h)}h ${String(Math.round((h % 1) * 60)).padStart(2, '0')}m`;
const plannerRange = (bp) => (bp.low === bp.high ? plannerN(bp.low) : `${plannerN(bp.low)}–${plannerN(bp.high)}`);

// A result as a coloured word: sure (green), only by one source's figure (amber), not reached (red).
function PlannerPill({ sure, children }) {
  const tone = sure === 'yes' ? 'tone-good' : sure === 'maybe' ? 'tone-warn' : 'tone-danger';
  return <span className={`planner-pill ${tone}`}>{children}</span>;
}

function PlannerView({ refreshKey }) {
  const [base, setBase] = useState(null);
  const [error, setError] = useState(null);
  const [rank, setRank] = useState(100);
  const [parts, setParts] = useState(['W+', 'C+', 'W+', 'C+']);
  const [mapId, setMapId] = useState(null);
  const [route, setRoute] = useState([]);
  const [adding, setAdding] = useState('');
  const [plan, setPlan] = useState(null);

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
    window.api.planSubVoyage({ rank, parts, route }).then((r) => { if (current) setPlan(r.success ? r : { error: r.error }); });
    return () => { current = false; };
  }, [base, rank, parts, route]);

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

  const loadSub = (i) => {
    const s = base.subs[Number(i)];
    if (!s) return;
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
        <label>Load from my sub{' '}
          <select value="" onChange={(e) => loadSub(e.target.value)} disabled={!base.subs.length}>
            <option value="">{base.subs.length ? 'Choose a sub…' : 'No subs synced yet'}</option>
            {base.subs.map((s, i) => <option key={i} value={i}>{s.label}, rank {s.rank}</option>)}
          </select>
        </label>
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
            {route.length > 1 && <button onClick={bestOrder} title="Put the sectors in the order that uses the least range">Best order</button>}
          </div>
          {plan && plan.route && plan.route.length > 0 && stats && (
            <div className="planner-facts">
              <div><span>Range used</span><b className={over ? 'tone-danger' : ''}>{plannerN(plan.range)} / {plannerN(stats.range)}</b>
                {over && <div className="tone-danger">Out of range: needs {plannerN(plan.range - stats.range)} more range</div>}</div>
              <div><span>Voyage</span><b>{plannerHours(plan.hours)}</b></div>
              <div><span>Experience</span><b>{plannerN(plan.exp)}</b><div className="dim">before bonuses</div></div>
              <div><span>Ceruleum</span><b>{plannerN(plan.tanks)} tank{plan.tanks === 1 ? '' : 's'}</b></div>
            </div>
          )}
          {tooHigh.length > 0 && <div className="tone-warn">Rank {rank} can't go to {tooHigh.map((s) => s.letter).join(', ')} yet.</div>}
        </div>
      </div>

      {plan && plan.sectors && plan.sectors.length > 0 && (
        <React.Fragment>
          <div className="supplies-summary planner-summary">
            <div className="account-group supply-card">
              <div className="supply-card-label">Gil per voyage</div>
              <div className="supply-card-value gil">{plannerN(plan.gilPerVoyage)}</div>
              <div className="supply-card-note">expected, at vendor prices (salvage at the Salvage page's)</div>
            </div>
            <div className="account-group supply-card">
              <div className="supply-card-label">Gil per day</div>
              <div className="supply-card-value gil">{plannerN(plan.gilPerDay)}</div>
              <div className="supply-card-note">sent out again as soon as it's back ({plannerN(plan.voyagesPerDay, 2)} voyages a day)</div>
            </div>
            <div className="account-group supply-card">
              <div className="supply-card-label">Experience per day</div>
              <div className="supply-card-value">{plannerN(plan.expPerDay)}</div>
              <div className="supply-card-note">before bonuses</div>
            </div>
            <div className="account-group supply-card">
              <div className="supply-card-label">Repairs</div>
              <div className="supply-card-value">{plan.kitsPerVoyage === null ? '—' : `${plannerN(plan.kitsPerVoyage * plan.voyagesPerDay, 1)} kits a day`}</div>
              <div className="supply-card-note">
                {plan.repairGilPerDay ? `${plannerN(plan.repairGilPerDay)} gil a day at ${plannerN(plan.repairKitCost)} a kit; ` : 'Set the repair kit price in Settings for the gil; '}
                parts last {plan.wear.every(Boolean) ? `${Math.min(...plan.wear.map((w) => w.voyagesLasting ?? Infinity))} voyages` : '—'}
              </div>
            </div>
          </div>

          <div className="account-group">
            <h2>What this build reaches <span className="count">amber: the sources differ, so it might not</span></h2>
            <table>
              <thead><tr><th>Sector</th><th>Loot tier</th><th>Retrieval</th><th>Double dip</th>
                <th className="num">T2 / T3 at</th><th className="num">Normal / Optimal at</th><th className="num">Favor at</th></tr></thead>
              <tbody>
                {plan.sectors.map((s) => (
                  <tr key={s.id}>
                    <td>{s.letter}: {s.name}</td>
                    {!s.hasData ? <td colSpan="6" className="dim">No XIVStats data for this sector yet.</td> : (
                      <React.Fragment>
                        <td><PlannerPill sure={s.result.tierSure}>Tier {s.result.tier}</PlannerPill>
                          {s.result.tier < 3 ? <div className="dim">{plannerN(s.result.need.t3)} more surveillance for T3</div>
                            : s.result.tierSure === 'maybe' ? <div className="tone-warn">{plannerN(s.result.need.t3)} more to be sure</div> : null}</td>
                        <td><PlannerPill sure={s.result.retrieval === 'optimal' ? s.result.retrievalSure : s.result.retrieval === 'normal' ? 'maybe' : 'no'}>
                          {s.result.retrieval[0].toUpperCase() + s.result.retrieval.slice(1)}</PlannerPill>
                          {s.result.retrieval !== 'optimal' || s.result.retrievalSure === 'maybe'
                            ? <div className="dim">{plannerN(s.result.need.optimal)} more retrieval for optimal</div> : null}</td>
                        <td><PlannerPill sure={s.result.doubleDip}>{s.result.doubleDip === 'yes' ? 'Yes' : s.result.doubleDip === 'maybe' ? 'Maybe' : 'No'}</PlannerPill>
                          {s.result.doubleDip !== 'yes' && <div className="dim">{plannerN(s.result.need.favor)} more favor</div>}</td>
                        <td className="num">{plannerRange(s.breakpoints[0])} / {plannerRange(s.breakpoints[1])}</td>
                        <td className="num">{plannerRange(s.breakpoints[2])} / {plannerRange(s.breakpoints[3])}</td>
                        <td className="num">{plannerRange(s.breakpoints[4])}</td>
                      </React.Fragment>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="account-group">
            <h2>Possible loot <span className="count">greyed: tiers this build can't count on</span></h2>
            <table>
              <thead><tr><th>Item</th><th>Tier</th><th>Sectors</th><th className="num">Amount each time</th><th className="num">Per voyage</th><th className="num">Gil per voyage</th></tr></thead>
              <tbody>
                {plan.loot.map((l) => (
                  <tr key={l.itemId} className={l.perVoyage > 0 ? '' : 'dim'}>
                    <td>{l.name}</td><td>T{l.tier}</td><td>{l.sectors.join(', ') || '—'}</td>
                    <td className="num">{l.low === l.high ? l.low : `${l.low}–${l.high}`}</td>
                    <td className="num">{l.perVoyage > 0 ? plannerN(l.perVoyage, 2) : '—'}</td>
                    <td className="num gil">{l.gil > 0 ? plannerN(l.gil) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </React.Fragment>
      )}

      <div className="planner-foot dim">
        Loot and breakpoints: XIVStats (updated {base.about.xivstats.updated ? new Date(base.about.xivstats.updated).toLocaleDateString() : '—'})
        {base.about.pepper ? ", checked against Pepper's FFXIV Ship Guide" : ''}. Range, voyage time and wear as Submarine Tracker works them out.
        Expected loot counts a breakpoint only when both sources agree it's met.
      </div>
    </div>
  );
}
