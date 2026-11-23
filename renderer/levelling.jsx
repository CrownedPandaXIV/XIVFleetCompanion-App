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

// One plan's stages, with the part swaps between them and what each stage could gain from a sector not discovered.
function LvStages({ plan, sectorOf, onOpenPlanner }) {
  const swapsAt = (rank) => plan.swaps.filter((s) => s.atRank === rank);
  return (
    <div className="lv-stages">
      {plan.stages.map((st, i) => {
        const before = plan.stages[i - 1];
        // Sectors this stage adds that its rank opened (they need more than the stage before started at).
        const opened = before ? st.route.filter((id) => !before.route.includes(id) && (sectorOf.get(id) || {}).rankReq > before.fromRank) : [];
        return (
          <React.Fragment key={`${st.fromRank}-${i}`}>
            {swapsAt(st.fromRank).map((s) => (
              <div key={`swap-${s.atRank}-${s.slot}`} className="lv-swap">
                <b>At rank {s.atRank}: {lvSlot[s.slot]} → {partNameOf(s.to)}</b>
                <span>{s.owned ? '(you have one)' : '(to get)'}</span>
                <span className="dim">→</span>
                <span>{plannerN(s.gain * 100)}% more experience an hour, {lvDays(s.savedHours)} sooner in all</span>
              </div>
            ))}
            <div className={`lv-stage ${LV_STAGE_CLASSES[i % 4]}`}>
              <div className="lv-ranks">{st.fromRank} → {st.toRank}<small>{lvDays(st.hours)} · {st.voyages} voyage{st.voyages === 1 ? '' : 's'}</small></div>
              <div className="lv-mid">
                <span>
                  <span className="rf-route">{st.route.map((id) => <RfLetter key={id} sector={sectorOf.get(id)} />)}</span>
                  {opened.map((id) => <span key={id} className="rf-tag chance">{sectorOf.get(id).letter} from rank {sectorOf.get(id).rankReq}</span>)}
                  {plan.swaps.length > 0 && <span className="lv-parts"><span className="lv-parts-label">Parts</span>{st.parts.map((p, j) => <span key={j} className="finder-part lv-part" title={partNameOf(p)}>{p}</span>)}</span>}
                </span>
                <span className="lv-facts">
                  <span><b>{plannerHours(st.hours / st.voyages)}</b> a voyage</span>
                  <span><b>{plannerN(st.expPerVoyage)}</b> exp a voyage</span>
                  <span><b>{plannerN(st.expPerHour)}</b> exp an hour</span>
                </span>
                {st.better && (
                  <span className="lv-better">{st.better.missing.map((id) => sectorOf.get(id).letter).join(', ')} {st.better.missing.length === 1 ? "isn't" : "aren't"} discovered yet:
                    with {st.better.missing.length === 1 ? 'it' : 'them'}, {st.better.route.map((id) => sectorOf.get(id).letter).join('-')} gives {plannerN((st.better.expPerHour / st.expPerHour - 1) * 100)}% more an hour.</span>
                )}
              </div>
              <button className="finder-open" onClick={() => onOpenPlanner({ rank: st.fromRank, parts: st.parts, route: st.route })}>Open in Voyage Planner</button>
            </div>
          </React.Fragment>
        );
      })}
    </div>
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
          <div className="finder-row">{everyBox}{fcNote}</div>
          {choices}
          <Working busy={busy}>Working out the plans…</Working>
          {answer && answer.error && <div className="error">{answer.error}</div>}
          {!fcSubs.length && <div className="status">No subs in this Free Company.</div>}
          {fcSubs.length > 0 && (
            <div className={`finder-table${busy ? ' is-busy' : ''}`}>
              <table className="lv-fleet">
                <thead><tr><th>Sub</th><th>Level to</th><th>Route now</th><th className="num">Voyages</th><th className="num">Reaches it</th><th /></tr></thead>
                <tbody>
                  {fcSubs.map((s) => {
                    const p = plans ? plans.find((x) => x.key === keyOf(s)) : null;
                    const top = s.rank >= base.maxRank;
                    return (
                      <tr key={keyOf(s)}>
                        <td><b>{s.subName}</b> <span className="dim">{s.character}</span></td>
                        <td>{top ? <span className="dim">top rank</span> : (
                          <span>{s.rank} → <select value={targets[keyOf(s)] || defaultTarget(s, s.rank)} onChange={(e) => setTargets({ ...targets, [keyOf(s)]: Number(e.target.value) })}>
                            {Array.from({ length: base.maxRank - s.rank }, (_, i) => s.rank + 1 + i).map((r) => <option key={r} value={r}>{r}</option>)}
                          </select></span>
                        )}</td>
                        <td>{p && p.stages && p.stages[0] ? <span className="rf-route">{p.stages[0].route.map((id) => <RfLetter key={id} sector={sectorOf.get(id)} />)}</span> : <span className="dim">—</span>}</td>
                        <td className="num">{p && p.stages ? plannerN(p.voyages) : '—'}</td>
                        <td className="num">{!p || !p.stages ? '—' : p.reached ? `about ${lvDays(p.hours)} · ${lvDate(lvStart(s) + p.hours * 3600000)}` : <span className="tone-warn">stops at rank {p.stuckAt}</span>}</td>
                        <td>{!top && <button className="link-button" onClick={() => { loadSub(s); setTarget(targets[keyOf(s)] || null); setMode('one'); }}>Stages</button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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
