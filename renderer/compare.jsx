// Sub Calculator → Compare: up to three builds side by side (ipc/calculator.js compare-sub-builds, subs/compare.js).
// Same route: every build flies the one route you set, so the numbers compare the builds alone. Best route each: each
// build gets its own best route on a map (as the Route Finder ranks them), so the numbers compare build and route
// together. The best figure in each row is green. The builds come from your subs, typed in, or Add to compare on the
// Build Finder and Voyage Planner; the app keeps them while you move between pages. The plugin's Compare page is the same.

const CMP_MAX = 3;
const CMP_MODES = [['same', 'Same route'], ['best', 'Best route each']];
const CMP_RANK_BY = [['exp', 'Experience'], ['gil', 'Gil']];
const CMP_HOURS = [[12, '12h'], [24, '24h'], [36, '36h'], [48, '48h'], [null, 'Any']];

// A build's key, to know one already in the list.
const cmpKey = (b) => `${b.rank}|${b.parts.join(',')}`;

// The number rows: label, how it's shown, and a hover.
const CMP_STAT_ROWS = PLANNER_STATS.map(([key, label]) => ({ key, label, show: (v) => plannerN(v) }));
const CMP_VOYAGE_ROWS = [
  { key: 'hours', label: 'Voyage', show: (v) => plannerHours(v), title: 'Shorter is better: it is sent out again sooner.' },
  { key: 'expPerVoyage', label: 'Experience a voyage', show: (v) => plannerN(v), title: 'With the bonus it is sure of' },
  { key: 'expPerDay', label: 'Experience a day', show: (v) => plannerN(v), title: 'Sent out again as soon as it is back' },
  { key: 'gilPerVoyage', label: 'Gil a voyage', show: (v) => plannerN(v), gil: true },
  { key: 'gilPerDay', label: 'Gil a day', show: (v) => plannerN(v), gil: true },
  { key: 'kitsPerDay', label: 'Repair kits a day', show: (v) => plannerN(v, 1), title: 'Fewer is better' },
  { key: 'netPerDay', label: 'Gil a day after repairs', show: (v) => plannerN(v), gil: true, title: 'Gil a day less the repair kits, at the Supplies page\'s kit price' },
];

// "Add to compare" on the Build Finder and Voyage Planner (compare: the app's link to the Compare page). Once the build is
// in, the button opens Compare; with three in, it says so.
function CmpAddButton({ compare, build }) {
  if (!compare) return null;
  const inIt = compare.keys.includes(cmpKey(build));
  if (inIt) return <button type="button" className="finder-open" onClick={compare.open} title="This build is in Compare Builds: open it">In Compare ({compare.count}) ›</button>;
  const full = compare.count >= CMP_MAX;
  return (
    <button type="button" className="finder-open" disabled={full} onClick={() => compare.add(build)}
      title={full ? 'Compare Builds holds 3 builds: take one out there first.' : 'Add this build to Sub Calculator → Compare Builds, to see it beside others.'}>Add to compare</button>
  );
}

// One build's heading: its name, whose it is, rank and parts; Change opens the rank and parts, × takes it out.
function CmpBuildHead({ build, base, editing, onEdit, onChange, onRemove }) {
  return (
    <div className="cmp-head">
      <div className="cmp-head-top">
        <span className="cmp-name">{build.label}{build.changed ? <span className="dim"> · changed</span> : null}</span>
        <button className="cmp-x" title="Take this build out" onClick={onRemove}>×</button>
      </div>
      {build.who && <div className="dim cmp-who">{build.who}</div>}
      <div className="cmp-build">
        <span className="rf-pill">Rank {build.rank}</span>
        <span className="finder-parts">{build.parts.map((p, i) => <span key={i} className="finder-part">{p}</span>)}</span>
      </div>
      <PartRankNote base={base} rank={build.rank} parts={build.parts} />
      <button className="link-button" onClick={onEdit}>{editing ? 'Done' : 'Change'}</button>
      {editing && (
        <div className="cmp-edit">
          <label className="finder-field">Rank<input type="number" min="1" max={base.maxRank} value={build.rank}
            onChange={(e) => onChange({ rank: Math.max(1, Math.min(base.maxRank, Number(e.target.value) || 1)) })} /></label>
          {PLANNER_SLOTS.map((slot, i) => (
            <label key={slot} className="finder-field">{slot}
              <select value={build.parts[i]} onChange={(e) => onChange({ parts: build.parts.map((p, j) => (j === i ? e.target.value : p)) })}>
                {base.partLetters.map((p) => <option key={p.letter} value={p.letter}>{p.name}</option>)}
              </select>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// What a build reaches at one stop: the loot tier, retrieval and double dip as coloured words.
function CmpStop({ s }) {
  if (!s) return <span className="dim">—</span>;
  if (!s.hasData || !s.result) return <span className="dim">no loot data</span>;
  const r = s.result;
  return (
    <span className="cmp-stop">
      <PlannerPill sure={r.tierSure}>T{r.tier}</PlannerPill>
      <PlannerPill sure={r.retrieval === 'optimal' ? r.retrievalSure : r.retrieval === 'normal' ? 'maybe' : 'no'}>{r.retrieval[0].toUpperCase() + r.retrieval.slice(1)}</PlannerPill>
      {r.doubleDip !== 'no' && <PlannerPill sure={r.doubleDip}>Double dip</PlannerPill>}
    </span>
  );
}

// state: { builds, route, mapId } kept by the app (so Add to compare elsewhere lands here); setState changes it.
function CompareView({ refreshKey, state, setState, onOpenPlanner }) {
  const [base, setBase] = useState(null);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState('same');
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState('');
  const [rankBy, setRankBy] = useState('exp');
  const [maxHours, setMaxHours] = useState(24);
  const [must, setMust] = useState([]);
  const [fcId, setFcId] = useState(null);
  const [answer, setAnswer] = useState(null);
  const [busy, setBusy] = useState(false);
  const { builds, route } = state;

  useEffect(() => {
    window.api.getSubCalculator().then((r) => {
      if (!r.success) { setError(r.error); return; }
      setError(null);
      setBase(r);
    });
  }, [refreshKey]);

  // The map: the route's, else the one picked, else the last map.
  const mapId = (() => {
    if (!base) return null;
    const first = route.length ? base.sectors.find((s) => s.id === route[0]) : null;
    if (first) return first.map;
    return state.mapId ?? (base.maps.length ? base.maps[base.maps.length - 1].id : null);
  })();
  // The FC whose explored sectors limit the best routes: the one picked, else the first build's, else the first read.
  const fcShown = fcId ?? ((builds.find((b) => b.fcId) || {}).fcId || ((base && base.fcs) || []).find((f) => f.readAt)?.fcId || null);

  const latest = useRef(0);
  useEffect(() => {
    if (!base || base.missingGameData || !builds.length) { setAnswer(null); latest.current += 1; setBusy(false); return undefined; }
    const call = ++latest.current;
    setBusy(true);
    const home = builds.find((b) => b.world);
    const place = base.live ? pricePlaceOf(base, home ? { world: home.world } : null, 'dc', {}) : null;
    const timer = setTimeout(() => {
      window.api.compareSubBuilds({ builds: builds.map((b) => ({ rank: b.rank, parts: b.parts })), mode, route, mapId, rankBy, maxHours, must,
        fcId: fcShown, place, scope: 'dc' }).then((r) => {
        if (call !== latest.current) return;
        setBusy(false);
        setAnswer(r.success ? r : { error: r.error });
      });
    }, 200);
    return () => clearTimeout(timer);
  }, [base, builds, mode, route, mapId, rankBy, maxHours, must, fcShown, refreshKey]);

  if (error && !base) return <div className="error">Failed to load: {error}</div>;
  if (!base) return <div className="status">Loading...</div>;
  if (base.missingGameData) return <div className="status">Compare Builds needs the game data's sub tables. Update them in Settings → Data → Game Data.</div>;

  const sectorOf = new Map(base.sectors.map((s) => [s.id, s]));
  const onMap = base.sectors.filter((s) => s.map === mapId).sort((a, b) => a.id - b.id);
  const full = builds.length >= CMP_MAX;
  const setBuilds = (next) => setState({ ...state, builds: next });
  const addBuild = (b) => {
    if (full || builds.some((x) => cmpKey(x) === cmpKey(b))) return;
    setBuilds([...builds, b]);
  };
  const addSub = (s) => addBuild({ label: s.subName, who: [s.character, s.world].filter(Boolean).join(' · '), world: s.world, fcId: s.fcId,
    rank: s.rank, parts: s.parts });
  const addTyped = () => {
    if (full) return;
    let n = builds.length + 1;
    while (builds.some((b) => b.label === `Build ${n}`)) n++;
    const parts = ['W+', 'C+', 'W+', 'C+'];
    let rank = base.maxRank;
    while (builds.some((b) => cmpKey(b) === cmpKey({ rank, parts })) && rank > 1) rank--;
    setBuilds([...builds, { label: `Build ${n}`, rank, parts }]);
    setEditing(builds.length);
  };
  const change = (i, patch) => setBuilds(builds.map((b, j) => (j === i ? { ...b, ...patch, changed: (!!b.who && !b.who.startsWith('from the ')) || b.changed } : b)));
  const remove = (i) => { setBuilds(builds.filter((_, j) => j !== i)); setEditing(null); };
  const setRoute = (next) => setState({ ...state, route: next });
  const pickMap = (id) => { setState({ ...state, mapId: id, route: [] }); setMust([]); };
  const addSector = () => {
    const free = onMap.filter((s) => !route.includes(s.id));
    // The sector picked, while it's still on this map and not on the route; else the first that is.
    const id = Number(free.some((s) => String(s.id) === String(adding)) ? adding : free[0] && free[0].id);
    if (id && route.length < 5) { setRoute([...route, id]); setAdding(''); }
  };
  // Best order for the route: the fastest the build with the most range can fly (time doesn't depend on the build).
  const bestOrder = () => {
    const most = builds.reduce((m, b, i) => { const r = answer && answer.columns && answer.columns[i] && answer.columns[i].stats ? answer.columns[i].stats.range : -1; return r > m.r ? { r, b } : m; }, { r: -1, b: builds[0] }).b;
    window.api.planSubVoyage({ rank: most.rank, parts: most.parts, route, bestOrder: true }).then((r) => { if (r.success && r.route) setRoute(r.route); });
  };
  const toggleMust = (id) => setMust(must.includes(id) ? must.filter((x) => x !== id) : must.length >= 5 ? must : [...must, id]);

  // Only an answer for these builds in this mode (switching shows nothing old while it's worked out again).
  const cols = answer && answer.columns && answer.mode === mode && answer.columns.length === builds.length ? answer.columns : null;
  const marks = (answer && answer.marks) || {};
  const isBest = (key, i) => (marks[key] || []).includes(i);
  const fc = (base.fcs || []).find((f) => f.fcId === fcShown) || null;
  const why = (c) => (c.partsNeed ? `Its parts can't be fitted until rank ${c.partsNeed}`
    : c.route.length === 0 ? (mode === 'best' ? 'No route fits' : 'No route yet')
    : c.tooHigh.length ? `Rank too low for ${c.tooHigh.map((id) => sectorOf.get(id).letter).join(', ')}`
      : c.short > 0 ? `Out of range: needs ${plannerN(c.short)} more` : null);
  const numberRow = (row) => (
    <tr key={row.key}>
      <th className="cmp-label" title={row.title || ''}>{row.label}</th>
      {builds.map((b, i) => {
        const c = cols && cols[i];
        const v = c ? c.values[row.key] : null;
        return <td key={cmpKey(b)} className={`num${row.gil ? ' gil' : ''}${isBest(row.key, i) ? ' cmp-best' : ''}`}>{v === null || v === undefined ? <span className="dim">—</span> : row.show(v)}</td>;
      })}
    </tr>
  );
  const group = (label) => <tr className="cmp-group"><th colSpan={builds.length + 1}>{label}</th></tr>;
  // Same route: a row per stop. Best route each: the stops differ, so one row with each build's own.
  const stopRows = mode === 'same'
    ? route.map((id) => (
      <tr key={`stop-${id}`}>
        <th className="cmp-label"><RfLetter sector={sectorOf.get(id)} /> {(sectorOf.get(id) || {}).name}</th>
        {builds.map((b, i) => <td key={cmpKey(b)}>{cols && cols[i] ? <CmpStop s={cols[i].sectors.find((s) => s.id === id)} /> : <span className="dim">—</span>}</td>)}
      </tr>
    ))
    : [(
      <tr key="stops">
        <th className="cmp-label">Loot tier per stop</th>
        {builds.map((b, i) => {
          const c = cols && cols[i];
          return <td key={cmpKey(b)}>{c && c.sectors.length ? <RfTiers stops={c.sectors.map((s) => ({ id: s.id, tier: s.result ? s.result.tier : null, tierSure: s.result ? s.result.tierSure : null }))} /> : <span className="dim">—</span>}</td>;
        })}
      </tr>
    )];

  return (
    <div className="finder cmp">
      <section className="finder-band">
        <h2 className="finder-heading">Builds <span className="count">{builds.length} of {CMP_MAX}</span></h2>
        <div className="cmp-add">
          {!full && <PlannerSubPicker subs={base.subs} chosen={null} onChoose={addSub} />}
          <button onClick={addTyped} disabled={full}>Type one in</button>
          <span className="dim">{full ? 'Take one out to add another.' : 'or use Add to compare on the Build Finder or Voyage Planner.'}</span>
          {builds.length > 0 && <button className="link-button" onClick={() => { setBuilds([]); setEditing(null); }}>Remove all builds</button>}
        </div>
      </section>

      <section className="finder-band">
        <h2 className="finder-heading">Route</h2>
        <div className="finder-row">
          <span className="rf-seg">{CMP_MODES.map(([k, label]) => <button key={k} className={mode === k ? 'on' : ''} onClick={() => setMode(k)}>{label}</button>)}</span>
          <span className="dim">{mode === 'same' ? 'Every build flies this route: the numbers compare the builds alone.'
            : 'Each build gets its own best route on the map: the numbers compare build and route together.'}</span>
        </div>
        <div className="finder-row">
          <label className="finder-field">Map
            <select value={mapId ?? ''} onChange={(e) => pickMap(Number(e.target.value))}>
              {base.maps.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          {mode === 'same' && (
            <label className="finder-field">Add a sector
              <span className="planner-add">
                <select value={onMap.some((s) => !route.includes(s.id) && String(s.id) === String(adding)) ? adding : ''} onChange={(e) => setAdding(e.target.value)} disabled={route.length >= 5}>
                  {onMap.filter((s) => !route.includes(s.id)).map((s) => <option key={s.id} value={s.id}>{s.letter}: {s.name} (rank {s.rankReq})</option>)}
                </select>
                <button onClick={addSector} disabled={route.length >= 5}>Add</button>
              </span>
            </label>
          )}
          {mode === 'best' && (
            <React.Fragment>
              <span className="finder-field">Best for
                <span className="rf-seg">{CMP_RANK_BY.map(([k, label]) => <button key={k} className={rankBy === k ? 'on' : ''} onClick={() => setRankBy(k)}>{label}</button>)}</span>
              </span>
              <span className="finder-field">Longest voyage
                <span className="rf-seg">{CMP_HOURS.map(([h, label]) => <button key={label} className={maxHours === h ? 'on' : ''} onClick={() => setMaxHours(h)}>{label}</button>)}</span>
              </span>
            </React.Fragment>
          )}
        </div>
        {mode === 'same' && (
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
            {route.length > 1 && builds.length > 0 && <button onClick={bestOrder} title="Put the sectors in the fastest order the build with the most range can fly">Best order</button>}
            {route.length > 0 && <button className="link-button" onClick={() => setRoute([])}>Clear route</button>}
          </div>
        )}
        {mode === 'best' && (
          <React.Fragment>
            <div className="rf-note">
              <span className="finder-field">Sectors explored by
                <FcPicker fcs={base.fcs} value={fcShown} onChange={setFcId} />
              </span>
              <span className="dim">{fc && fc.readAt ? `read at the workshop ${rfWhen(fc.readAt)}.` : 'Not read yet: every sector is allowed.'}</span>
            </div>
            <div className="cmp-musts">
              <span className="dim">Must go to:</span>
              {onMap.map((s) => (
                <button key={s.id} className="cmp-must" onClick={() => toggleMust(s.id)} title={`${s.letter}: ${s.name}, rank ${s.rankReq}`}>
                  <RfLetter sector={s} must={must.includes(s.id)} />
                </button>
              ))}
              {must.length > 0 && <button className="link-button" onClick={() => setMust([])}>Clear</button>}
            </div>
          </React.Fragment>
        )}
      </section>

      <section className="finder-band">
        <h2 className="finder-heading">Side by side <span className="count">green: the best of these builds</span></h2>
        <Working busy={busy && builds.length > 0}>Working out the comparison…</Working>
        {answer && answer.error && <div className="error">{answer.error}</div>}
        {!builds.length && <div className="status">Add a build to start: one of your subs, one typed in, or Add to compare on the Build Finder or Voyage Planner.</div>}
        {builds.length > 0 && (
          <div className={`cmp-wrap${busy ? ' is-busy' : ''}`}>
            <table className="cmp-table">
              <thead>
                <tr>
                  <th className="cmp-label" />
                  {builds.map((b, i) => (
                    <th key={cmpKey(b)}>
                      <CmpBuildHead build={b} base={base} editing={editing === i} onEdit={() => setEditing(editing === i ? null : i)}
                        onChange={(patch) => change(i, patch)} onRemove={() => remove(i)} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {group('Stats')}
                {CMP_STAT_ROWS.map(numberRow)}
                {group('Route')}
                <tr>
                  <th className="cmp-label">{mode === 'same' ? 'Can it fly it?' : 'Its best route'}</th>
                  {builds.map((b, i) => {
                    const c = cols && cols[i];
                    if (!c) return <td key={cmpKey(b)}><span className="dim">{answer && !busy ? "Not in the game data" : '…'}</span></td>;
                    const problem = !c.stats ? "This rank or a part isn't in the game data" : why(c);
                    return (
                      <td key={cmpKey(b)}>
                        {mode === 'best' && c.route.length > 0 && <span className="rf-route">{c.route.map((id) => <RfLetter key={id} sector={sectorOf.get(id)} must={must.includes(id)} />)}</span>}
                        {problem ? <span className={`cmp-why${c.route.length ? ' bad' : ''}`}>{problem}</span> : mode === 'same' ? <span className="tone-good">Yes</span> : null}
                      </td>
                    );
                  })}
                </tr>
                <tr>
                  <th className="cmp-label" title="Range the route uses, of the build's range">Range used</th>
                  {builds.map((b, i) => {
                    const c = cols && cols[i];
                    if (!c || !c.stats || c.used === null) return <td key={cmpKey(b)} className="num"><span className="dim">—</span></td>;
                    return (
                      <td key={cmpKey(b)} className={`num${isBest('spare', i) ? ' cmp-best' : ''}`}>
                        <span className={c.short > 0 ? 'tone-danger' : ''}>{plannerN(c.used)} / {plannerN(c.stats.range)}</span>
                        {c.short === 0 && <span className="finder-spare">+{plannerN(c.stats.range - c.used)}</span>}
                      </td>
                    );
                  })}
                </tr>
                {group(<>Voyage{answer && answer.pricing && answer.pricing.source === 'market' ? ` · gil at market prices (${answer.pricing.place})` : ' · gil at vendor prices'}<LivePricesNote market={answer && answer.pricing} /></>)}
                {CMP_VOYAGE_ROWS.map(numberRow)}
                {group('Each stop')}
                {stopRows}
                <tr className="cmp-foot">
                  <th className="cmp-label" />
                  {builds.map((b, i) => {
                    const c = cols && cols[i];
                    const rt = c && c.route.length ? c.route : route;
                    return <td key={cmpKey(b)}><button className="finder-open" onClick={() => onOpenPlanner({ rank: b.rank, parts: b.parts, route: rt })}>Open in Voyage Planner</button></td>;
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="planner-foot dim">
        Numbers as the Voyage Planner works them out. Best route each: as the Route Finder ranks them (up to 5 stops), only through sectors the
        Free Company has discovered. A build that can't fly the route shows why instead of numbers.
      </div>
    </div>
  );
}
