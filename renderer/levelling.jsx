// Sub Calculator → Levelling Plan: a sub's way from its rank to a target rank (ipc/calculator.js plan-sub-levelling,
// subs/levelling.js). Stages: the route best for experience an hour at each rank, as the Route Finder ranks them, only
// through sectors the Free Company has discovered, with how many voyages and days each takes. Two choices: one sub in
// detail, or every sub in a Free Company one line each; keep the build, or suggest part swaps on the way (Standard
// parts only if wanted). The plugin's Levelling Plan page is the same.

const LV_HOURS = [[12, '12h'], [24, '24h'], [36, '36h'], [48, '48h'], [null, 'Any']];
const LV_STAGE_CLASSES = ['c1', 'c2', 'c3', 'c4'];
const lvDays = (hours) => {
  const d = hours / 24;
  return d < 1 ? `${Math.max(1, Math.round(hours))}h` : d < 10 ? `${(Math.round(d * 2) / 2).toLocaleString()} days` : `${Math.round(d)} days`;
};
const lvDate = (ms) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const lvSlot = ['Hull', 'Stern', 'Bow', 'Bridge'];

// When a sub's first voyage of the plan leaves: now, or when it's back if it's out.
const lvStart = (sub) => Math.max(Date.now(), sub && sub.returnTime ? sub.returnTime * 1000 : 0);

// The stages table (the shared table: columns to size, move, sort and choose, remembered). Each row a stage: its ranks,
// time, route (with the sectors its rank opened), parts, voyage figures, and what a sector not discovered yet would add.
const LV_STAGE_COLUMN_DEFS = [
  { key: 'ranks', label: 'Ranks', locked: true, td: (r) => <td className="lv-ranks">{r.fromRank} → {r.toRank}</td>, sort: (r) => r.fromRank },
  { key: 'days', label: 'Time', td: (r) => <td className="num">{lvDays(r.hours)}</td>, sort: (r) => r.hours },
  { key: 'voyages', label: 'Voyages', td: (r) => <td className="num">{plannerN(r.voyages)}</td>, sort: (r) => r.voyages },
  { key: 'route', label: 'Route', td: (r, ctx) => (
    <td><span className="rf-route">{r.route.map((id) => <RfLetter key={id} sector={ctx.sectorOf.get(id)} />)}</span>
      {r.opened.map((id) => <span key={id} className="rf-tag chance">{ctx.sectorOf.get(id).letter} from rank {ctx.sectorOf.get(id).rankReq}</span>)}</td>),
  sort: (r) => r.routeLetters },
  { key: 'parts', label: 'Parts', td: (r) => <td><span className="lv-parts">{r.parts.map((p, j) => <span key={j} className="finder-part lv-part" title={partNameOf(p)}>{p}</span>)}</span></td>,
    sort: (r) => r.parts.join('') },
  { key: 'voyage', label: 'Voyage', td: (r) => <td className="num">{plannerHours(r.hours / r.voyages)}</td>, sort: (r) => r.hours / r.voyages },
  { key: 'expVoyage', label: 'Exp a voyage', td: (r) => <td className="num">{plannerN(r.expPerVoyage)}</td>, sort: (r) => r.expPerVoyage },
  { key: 'expHour', label: 'Exp an hour', td: (r) => <td className="num">{plannerN(r.expPerHour)}</td>, sort: (r) => r.expPerHour },
  { key: 'tanks', label: 'Ceruleum', default: false, td: (r) => <td className="num">{plannerN(r.tanks)}</td>, sort: (r) => r.tanks },
  { key: 'kits', label: 'Repair kits', default: false, td: (r) => <td className="num">{plannerN(r.kits)}</td>, sort: (r) => r.kits },
  { key: 'better', label: 'Not discovered yet', sortable: false, td: (r, ctx) => <td>{r.better ? (
    <span className="lv-better">{r.better.missing.map((id) => ctx.sectorOf.get(id).letter).join(', ')} {r.better.missing.length === 1 ? "isn't" : "aren't"} discovered yet:
      with {r.better.missing.length === 1 ? 'it' : 'them'}, {r.better.route.map((id) => ctx.sectorOf.get(id).letter).join('-')} gives {plannerN((r.better.expPerHour / r.expPerHour - 1) * 100)}% more an hour.</span>
  ) : <span className="dim">—</span>}</td> },
  { key: 'planner', label: 'Voyage Planner', sortable: false, cell: (r, ctx) => (
    <button className="finder-open" onClick={() => ctx.onOpenPlanner({ rank: r.fromRank, parts: r.parts, route: r.route })}>Open in Voyage Planner</button>) },
];

// One plan's stages, with each part swap as a full-width row before the first stage that uses it (in plan order; a
// column sort lists the stages alone).
function LvStages({ plan, sectorOf, onOpenPlanner }) {
  const swapsAt = plan.swapsByStage || plan.stages.map(() => []);
  const rows = plan.stages.map((st, i) => {
    const before = plan.stages[i - 1];
    // Sectors this stage adds that its rank opened (they need more than the stage before started at).
    const opened = before ? st.route.filter((id) => !before.route.includes(id) && (sectorOf.get(id) || {}).rankReq > before.fromRank) : [];
    return { ...st, i, opened, routeLetters: st.route.map((id) => (sectorOf.get(id) || {}).letter || '').join('') };
  });
  const sort = useColumnSort();
  const cols = useTableColumns({ tableKey: 'levellingStages', ownDefs: LV_STAGE_COLUMN_DEFS, rows, idOf: () => null });
  const ctx = { sectorOf, onOpenPlanner };
  const sorted = sort.sortColumn ? applyColumnSort(rows, sort.sortColumn, sort.sortDirection, cols.accessors) : rows;
  const span = cols.visibleDefs.length;
  return (
    <React.Fragment>
      <div className="controls finder-columns"><ColumnPicker cols={cols} /></div>
      <div className="finder-table lv-table">
        <table>
          <thead><tr><ColumnHeadCells cols={cols} sortColumn={sort.sortColumn} sortDirection={sort.sortDirection} onSortClick={(k) => sort.handleSortClick(k)} /></tr></thead>
          <tbody>
            {sorted.map((r) => (
              <React.Fragment key={`${r.fromRank}-${r.i}`}>
                {!sort.sortColumn && swapsAt[r.i].map((s) => (
                  <tr key={`swap-${s.atRank}-${s.slot}`} className="lv-swap"><td colSpan={span}>
                    <b>At rank {s.showRank}: {lvSlot[s.slot]} → {partNameOf(s.to)}</b>
                    <span>{s.owned ? ' (you have one)' : ' (to get)'}</span>
                    <span className="dim"> → </span>
                    <span>{plannerN(s.gain * 100)}% more experience an hour, {lvDays(s.savedHours)} sooner in all</span>
                  </td></tr>
                ))}
                <tr className={`lv-stage ${LV_STAGE_CLASSES[r.i % 4]}`}><ColumnBodyCells cols={cols} row={r} ctx={ctx} /></tr>
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {sort.sortColumn && plan.swaps.length > 0 && (
        <div className="dim">The part swaps show between the stages in plan order. <button className="link-button" onClick={() => sort.resetSort()}>Back to plan order</button></div>
      )}
    </React.Fragment>
  );
}

// Every sub in a Free Company (the shared table): each sub's target, the route it starts on, voyages and when it gets
// there, and Stages to see its plan.
const lvReaches = (r) => (r.plan && r.plan.stages && r.plan.reached ? r.plan.hours : null);
const LV_FLEET_COLUMN_DEFS = [
  { key: 'sub', label: 'Sub', locked: true, td: (r) => <td><b>{r.subName}</b> <span className="dim">{r.character}</span></td>, sort: (r) => r.subName },
  { key: 'target', label: 'Level to', td: (r, ctx) => <td>{r.top ? <span className="dim">top rank</span> : (
    <span>{r.rank} → <select value={r.target} onChange={(e) => ctx.setTarget(r, Number(e.target.value))}>
      {Array.from({ length: ctx.maxRank - r.rank }, (_, i) => r.rank + 1 + i).map((x) => <option key={x} value={x}>{x}</option>)}
    </select></span>)}</td>, sort: (r) => r.target },
  { key: 'route', label: 'Route now', td: (r, ctx) => <td>{r.plan && r.plan.stages && r.plan.stages[0]
    ? <span className="rf-route">{r.plan.stages[0].route.map((id) => <RfLetter key={id} sector={ctx.sectorOf.get(id)} />)}</span> : <span className="dim">—</span>}</td>, sortable: false },
  { key: 'voyages', label: 'Voyages', td: (r) => <td className="num">{r.plan && r.plan.stages ? plannerN(r.plan.voyages) : '—'}</td>, sort: (r) => (r.plan && r.plan.stages ? r.plan.voyages : null) },
  { key: 'reaches', label: 'Reaches it', td: (r) => <td className="num">{!r.plan || !r.plan.stages ? '—' : r.plan.reached
    ? `about ${lvDays(r.plan.hours)} · ${lvDate(lvStart(r) + r.plan.hours * 3600000)}` : <span className="tone-warn">stops at rank {r.plan.stuckAt}</span>}</td>, sort: lvReaches },
  { key: 'stages', label: 'Stages', sortable: false, cell: (r, ctx) => (!r.top ? <button className="link-button" onClick={() => ctx.open(r)}>Stages</button> : null) },
];

function LvFleet({ rows, ctx }) {
  const sort = useColumnSort();
  const cols = useTableColumns({ tableKey: 'levellingFleet', ownDefs: LV_FLEET_COLUMN_DEFS, rows, idOf: () => null });
  return (
    <React.Fragment>
      <div className="controls finder-columns"><ColumnPicker cols={cols} /></div>
      <div className="finder-table">
        <ColumnTable cols={cols} sort={sort} rows={rows} rowKey={(r) => r.key} className="lv-fleet" ctx={ctx} />
      </div>
    </React.Fragment>
  );
}

// The four boxes and the strip of stages.
function LvSummary({ plan, start }) {
  const days = plan.hours / 24;
  const strip = plan.stages.map((st, i) => ({ i, st, grow: Math.max(st.hours, 1) }));
  let at = 0;
  const marks = [0];
  for (const st of plan.stages) { at += st.hours; marks.push(at); }
  return (
    <React.Fragment>
      <div className="lv-sums">
        <div className="lv-sum"><span className="k">Ranks</span><span className="v">{plan.rank} → {plan.target}</span><span className="n">{plannerN(plan.target - plan.rank)} rank{plan.target - plan.rank === 1 ? '' : 's'}, {plannerN(plan.expNeeded)} experience</span></div>
        <div className="lv-sum"><span className="k">Voyages</span><span className="v">{plannerN(plan.voyages)}</span><span className="n">{plan.stages.length} stage{plan.stages.length === 1 ? '' : 's'}{plan.swaps.length ? `, ${plan.swaps.length} part swap${plan.swaps.length === 1 ? '' : 's'}` : ''}</span></div>
        <div className="lv-sum"><span className="k">Time</span><span className="v">about {lvDays(plan.hours)}</span><span className="n">rank {plan.target} around {lvDate(start + plan.hours * 3600000)}{plan.swaps.length ? `; ${lvDays(plan.keepHours - plan.hours)} sooner than keeping the build` : ''}</span></div>
        <div className="lv-sum"><span className="k">Ceruleum · kits</span><span className="v">{plannerN(plan.tanks)} · {plannerN(plan.kits)}</span><span className="n">tanks · repair kits on the way</span></div>
      </div>
      {plan.stages.length > 0 && days > 0 && (
        <div>
          <div className="lv-strip">{strip.map(({ i, st, grow }) => <span key={i} className={LV_STAGE_CLASSES[i % 4]} style={{ flex: grow }} title={`Ranks ${st.fromRank}–${st.toRank}: ${lvDays(st.hours)}`}>{st.fromRank}–{st.toRank}</span>)}</div>
          <div className="lv-scale">{marks.map((h, i) => <span key={i}>{i === 0 ? 'start' : `day ${Math.round(h / 24)}`}</span>)}</div>
        </div>
      )}
    </React.Fragment>
  );
}

function LevellingView({ refreshKey, onOpenPlanner }) {
  const [base, setBase] = useState(null);
  const [error, setError] = useState(null);
  const [nextBuilds, setNextBuilds] = useState(new Map());
  const [mode, setMode] = useState('one');
  const [chosen, setChosen] = useState(null);
  const [rank, setRank] = useState(1);
  const [exp, setExp] = useState(0);
  const [parts, setParts] = useState(['S', 'S', 'S', 'S']);
  const [editBuild, setEditBuild] = useState(false);
  const [target, setTarget] = useState(null);
  const [targets, setTargets] = useState({}); // every-sub mode: a sub's own target, by key
  const [maxHours, setMaxHours] = useState(24);
  const [suggest, setSuggest] = useState(false);
  const [standardOnly, setStandardOnly] = useState(false);
  const [fcId, setFcId] = useState(null);
  const [everySector, setEverySector] = useState(false);
  const [answer, setAnswer] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    window.api.getSubCalculator().then((r) => {
      if (!r.success) { setError(r.error); return; }
      setError(null);
      setBase(r);
      setFcId((f) => f ?? ((r.fcs || []).find((x) => x.readAt) || (r.fcs || [])[0] || {}).fcId ?? null);
    });
    // Each sub's next build (Subs page): the rank to level to by default.
    window.api.getSubNextBuilds().then((r) => {
      if (r && r.success) setNextBuilds(new Map(r.rows.map((s) => [`${s.cid}|${s.subName}`, s.rank])));
    }).catch(() => {});
  }, [refreshKey]);

  const keyOf = (s) => `${s.cid}|${s.subName}`;
  const defaultTarget = (s, r) => Math.min(base ? base.maxRank : r, Math.max(r + 1, nextBuilds.get(keyOf(s)) || (base ? base.maxRank : r)));
  const fcSubs = base ? base.subs.filter((s) => fcId && s.fcId === fcId) : [];
  const goal = target ?? (chosen ? defaultTarget(chosen, rank) : base ? base.maxRank : rank);

  const latest = useRef(0);
  useEffect(() => {
    if (!base || base.missingGameData) return undefined;
    const subs = mode === 'one'
      ? [{ key: 'one', rank, exp, target: goal, parts, cid: chosen ? chosen.cid : null }]
      : fcSubs.filter((s) => s.rank < base.maxRank).map((s) => ({ key: keyOf(s), rank: s.rank, exp: s.exp, target: targets[keyOf(s)] || defaultTarget(s, s.rank), parts: s.parts, cid: s.cid }));
    if (!subs.length) { setAnswer(null); return undefined; }
    const call = ++latest.current;
    setBusy(true);
    const timer = setTimeout(() => {
      window.api.planSubLevelling({ subs, fcId, everySector, maxHours, suggest, standardOnly }).then((r) => {
        if (call !== latest.current) return;
        setBusy(false);
        setAnswer(r.success ? { ...r, mode } : { error: r.error });
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [base, mode, rank, exp, goal, parts, chosen, fcId, everySector, maxHours, suggest, standardOnly, targets, nextBuilds, refreshKey]);

  if (error && !base) return <div className="error">Failed to load: {error}</div>;
  if (!base) return <div className="status">Loading...</div>;
  if (base.missingGameData) return <div className="status">The Levelling Plan needs the game data's sub tables. Update them in Settings → Data → Game Data.</div>;

  const sectorOf = new Map(base.sectors.map((s) => [s.id, s]));
  const fc = (base.fcs || []).find((f) => f.fcId === fcId) || null;
  const loadSub = (s) => {
    if (!s) return;
    setChosen(s);
    setRank(s.rank);
    setExp(s.exp || 0);
    setParts(s.parts);
    setTarget(null);
    if (s.fcId) setFcId(s.fcId);
  };
  const plans = answer && !answer.error && answer.mode === mode ? answer.plans : null;
  const one = plans && plans[0];
  const nextRank = chosen ? nextBuilds.get(keyOf(chosen)) : null;
  const fcSelect = <FcPicker fcs={base.fcs} value={fcId} onChange={setFcId} />;
  const everyBox = <label className="finder-check" title="Plan as if every sector were discovered: how long it takes once the Free Company has found them"><input type="checkbox" checked={everySector} onChange={(e) => setEverySector(e.target.checked)} /> Use every sector</label>;
  const fcNote = <span className="dim">{everySector ? 'Every sector, as if all were discovered.' : fc && fc.readAt ? `Only sectors ${fc.name} has discovered (read at the workshop ${rfWhen(fc.readAt)}).` : 'Not read yet: every sector is allowed.'}</span>;
  const choices = (
    <div className="finder-row">
      <span className="finder-field">Longest voyage
        <span className="rf-seg">{LV_HOURS.map(([h, label]) => <button key={label} className={maxHours === h ? 'on' : ''} onClick={() => setMaxHours(h)}>{label}</button>)}</span>
      </span>
      <span className="finder-field">Parts
        <span className="rf-seg"><button className={!suggest ? 'on' : ''} onClick={() => setSuggest(false)}>Keep this build</button><button className={suggest ? 'on' : ''} onClick={() => setSuggest(true)}>Suggest changes on the way</button></span>
      </span>
      {suggest && <label className="finder-check"><input type="checkbox" checked={standardOnly} onChange={(e) => setStandardOnly(e.target.checked)} /> Standard parts only</label>}
    </div>
  );

  return (
    <div className="finder lv">
      <div className="finder-row">
        <span className="finder-field">Plan for
          <span className="rf-seg"><button className={mode === 'one' ? 'on' : ''} onClick={() => setMode('one')}>One sub</button><button className={mode === 'fc' ? 'on' : ''} onClick={() => setMode('fc')}>Every sub in a Free Company</button></span>
        </span>
      </div>

      {mode === 'one' && (
        <React.Fragment>
          <section className="finder-band">
            <h2 className="finder-heading">Your sub</h2>
            <div className="rf-sub">
              <PlannerSubPicker subs={base.subs} chosen={chosen} onChoose={loadSub} />
              {chosen && <button className="link-button" onClick={() => { setChosen(null); setTarget(null); }} title="Stop starting from this sub; the build stays as it is">Clear sub</button>}
              {chosen && <span className="rf-subname">{chosen.subName}</span>}
              {chosen && <span className="dim">{[chosen.character, chosen.world, chosen.fc].filter(Boolean).join(' · ')}</span>}
              <span className="rf-pill">Rank {rank}</span>
              <span className="finder-parts">{parts.map((p, i) => <span key={i} className="finder-part">{p}</span>)}</span>
              <button className="link-button" onClick={() => setEditBuild(!editBuild)}>{editBuild ? 'Done' : 'Change parts or rank'}</button>
            </div>
            {editBuild && (
              <div className="finder-row">
                <label className="finder-field">Rank<input type="number" min="1" max={base.maxRank} value={rank}
                  onChange={(e) => { setRank(Math.max(1, Math.min(base.maxRank, Number(e.target.value) || 1))); setExp(0); }} /></label>
                {PLANNER_SLOTS.map((slot, i) => (
                  <label key={slot} className="finder-field">{slot}
                    <select value={parts[i]} onChange={(e) => setParts(parts.map((p, j) => (j === i ? e.target.value : p)))}>
                      {base.partLetters.map((p) => <option key={p.letter} value={p.letter}>{p.name}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            )}
            <div className="finder-row">
              <label className="finder-field">Level to
                <select value={goal} onChange={(e) => setTarget(Number(e.target.value))}>
                  {Array.from({ length: Math.max(0, base.maxRank - rank) }, (_, i) => rank + 1 + i).map((r) => (
                    <option key={r} value={r}>Rank {r}{r === nextRank ? ' (its next build)' : r === base.maxRank ? ' (the top rank)' : ''}</option>
                  ))}
                </select>
              </label>
              {target !== null && <button className="link-button" onClick={() => setTarget(null)}>Reset target</button>}
              <span className="finder-field">Sectors explored by {fcSelect}</span>
              {everyBox}
            </div>
            {fcNote}
          </section>

          <section className="finder-band">
            <h2 className="finder-heading">The plan <span className="count">best experience at each rank, sent out again as soon as it's back</span></h2>
            {choices}
            <Working busy={busy}>Working out the plan…</Working>
            {answer && answer.error && <div className="error">{answer.error}</div>}
            {rank >= base.maxRank && <div className="status">This sub is at the top rank.</div>}
            {one && one.error && <div className="error">{one.error}</div>}
            {one && !one.error && (
              <div className={busy ? 'is-busy' : ''}>
                <LvSummary plan={one} start={lvStart(chosen)} />
                {!one.reached && <div className="tone-warn">{one.stuckAt ? `From rank ${one.stuckAt}, no route fits this sub's range${maxHours ? ` in ${maxHours}h` : ''}. Try a longer voyage or other parts.` : 'The plan stops here.'}</div>}
                {suggest && one.swaps.length === 0 && <div className="dim">No part swap{standardOnly ? ' to a Standard part' : ''} makes this plan shorter.</div>}
                <LvStages plan={one} sectorOf={sectorOf} onOpenPlanner={onOpenPlanner} />
              </div>
            )}
          </section>
        </React.Fragment>
      )}

      {mode === 'fc' && (
        <section className="finder-band">
          <h2 className="finder-heading">Every sub in {fcSelect} <span className="count">each to its next build's rank (else the top rank)</span></h2>
          <div className="finder-row">{everyBox}{fcNote}
            {Object.keys(targets).length > 0 && <button className="link-button" onClick={() => setTargets({})}>Reset targets</button>}</div>
          {choices}
          <Working busy={busy}>Working out the plans…</Working>
          {answer && answer.error && <div className="error">{answer.error}</div>}
          {!fcSubs.length && <div className="status">No subs in this Free Company.</div>}
          {fcSubs.length > 0 && (
            <div className={busy ? 'is-busy' : ''}>
              <LvFleet rows={fcSubs.map((s) => ({ ...s, key: keyOf(s), plan: plans ? plans.find((x) => x.key === keyOf(s)) || null : null, top: s.rank >= base.maxRank,
                target: targets[keyOf(s)] || defaultTarget(s, s.rank) }))}
                ctx={{ sectorOf, maxRank: base.maxRank, setTarget: (s, r) => setTargets({ ...targets, [s.key]: r }),
                  open: (s) => { loadSub(s); setTarget(targets[s.key] || null); setMode('one'); } }} />
            </div>
          )}
        </section>
      )}

      <div className="planner-foot dim">
        Experience with the bonus each sub is sure of (Pepper's guide); routes as the Route Finder ranks them for experience (up to 5 stops, any map);
        rank-up experience from the game data. A sub out now starts when it's back. Part swaps are tried at the start of each stage, one part at a time.
      </div>
    </div>
  );
}
