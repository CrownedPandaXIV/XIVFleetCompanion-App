// Trends: charts of values recorded over time (gil, ceruleum, repair kits, FC points, salvage).
// Data comes from the plugin's metric history via the get-metric-* calls (see metric-series.js).
// Loaded after tables.js and before app.js; TrendsView is used by App.

const TREND_SURFACE = '#12141a';
const TREND_TEXT = '#e6e6e6';
const TREND_MUTED = '#8a8f9a';
const TREND_GRID = 'rgba(138, 143, 154, 0.16)';

// Categorical colors in fixed slot order (validated for the dark surface: lightness band,
// chroma, adjacent color-blind separation and contrast). A series keeps the slot it was given
// when others are removed, so colors follow the entity, never its position.
const TREND_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
const TREND_MAX_SERIES = TREND_COLORS.length;

const TREND_DAY = 86400000;
const TREND_RANGES = [
  { key: '24h', label: '24 hours', ms: TREND_DAY, points: 144 },
  { key: '7d', label: '7 days', ms: 7 * TREND_DAY, points: 168 },
  { key: '30d', label: '30 days', ms: 30 * TREND_DAY, points: 150 },
  { key: '90d', label: '90 days', ms: 90 * TREND_DAY, points: 150 },
  { key: '1y', label: '1 year', ms: 365 * TREND_DAY, points: 150 },
  { key: 'all', label: 'All time', ms: null, points: 150 },
];

// What can be charted. `parts` say which recorded values make up the chart for a character or a
// Free Company; `fleetTypes` say which of those are added together for the whole-fleet total.
function buildTrendMetrics(prices) {
  const ids = Object.keys(prices || {});
  const items = (weightOf) => ids.map((id) => ({ metric: `item_qty:${id}`, weight: weightOf(id) }));
  return [
    { key: 'gil', label: 'Gil', parts: { character: [{ metric: 'gil' }] }, fleetTypes: ['character'] },
    { key: 'ceruleum', label: 'Ceruleum', parts: { character: [{ metric: 'ceruleum' }] }, fleetTypes: ['character'] },
    { key: 'repair_kits', label: 'Repair kits', parts: { character: [{ metric: 'repair_kits' }] }, fleetTypes: ['character'] },
    { key: 'retainer_count', label: 'Retainers', parts: { character: [{ metric: 'retainer_count' }] }, fleetTypes: ['character'] },
    { key: 'submarine_count', label: 'Submarines', parts: { character: [{ metric: 'submarine_count' }] }, fleetTypes: ['character'] },
    { key: 'num_sub_slots', label: 'Sub slots', parts: { character: [{ metric: 'num_sub_slots' }] }, fleetTypes: ['character'] },
    {
      key: 'fc_points',
      label: 'FC points',
      parts: { character: [{ metric: 'fc_points' }], fc: [{ metric: 'fc_points' }] },
      fleetTypes: ['fc'],
    },
    {
      key: 'salvage_value',
      label: 'Salvage value (gil)',
      parts: { character: items((id) => prices[id]), fc: items((id) => prices[id]) },
      fleetTypes: ['character', 'fc'],
    },
    {
      key: 'salvage_items',
      label: 'Salvage items (count)',
      parts: { character: items(() => 1), fc: items(() => 1) },
      fleetTypes: ['character', 'fc'],
    },
  ];
}

const trendFullNumber = (n) => (n === null || n === undefined ? '—' : Math.round(n).toLocaleString('en-US'));

function trendCompactNumber(n) {
  if (n === null || n === undefined) return '';
  const abs = Math.abs(n);
  const trim = (x) => String(Math.round(x * 100) / 100);
  if (abs >= 1e9) return `${trim(n / 1e9)}B`;
  if (abs >= 1e6) return `${trim(n / 1e6)}M`;
  if (abs >= 1e3) return `${trim(n / 1e3)}K`;
  return trim(n);
}

function trendFormatTime(ms) {
  return new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function trendHexToRgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// The chart itself (uPlot, drawn on a canvas). Values are steps: a recorded value holds until the
// next recorded change. Dragging across the chart zooms into that time span at full resolution.
function TrendChart({ timestamps, series, dimmed, onZoom, height = 360 }) {
  const { useRef, useEffect } = React;
  const wrapRef = useRef(null);
  const hostRef = useRef(null);
  const tipRef = useRef(null);
  const zoomRef = useRef(onZoom);
  zoomRef.current = onZoom;

  useEffect(() => {
    const host = hostRef.current;
    const tip = tipRef.current;
    const wrap = wrapRef.current;
    if (!host) return undefined;

    const data = [timestamps.map((t) => t / 1000), ...series.map((s) => s.values)];
    const single = series.length === 1;

    const axisBase = {
      stroke: TREND_MUTED,
      font: '12px -apple-system, Segoe UI, Roboto, sans-serif',
      grid: { stroke: TREND_GRID, width: 1 },
      ticks: { show: false },
    };

    const opts = {
      width: Math.max(240, host.clientWidth),
      height,
      legend: { show: false },
      padding: [12, 16, 0, 0],
      scales: {
        x: { time: true },
        y: {
          range: (u, min, max) => {
            if (min === null || max === null) return [0, 1];
            if (min === max) return [min - 1, max + 1];
            const pad = (max - min) * 0.08;
            return [min - pad, max + pad];
          },
        },
      },
      axes: [
        { ...axisBase, size: 40 },
        { ...axisBase, size: 64, values: (u, ticks) => ticks.map(trendCompactNumber) },
      ],
      cursor: {
        x: true,
        y: false,
        drag: { x: true, y: false, setScale: false },
        points: { size: 8, width: 2, stroke: () => TREND_SURFACE, fill: (u, i) => series[i - 1].color },
      },
      select: { show: true, left: 0, top: 0, width: 0, height: 0 },
      series: [
        {},
        ...series.map((s) => ({
          label: s.name,
          stroke: s.color,
          width: 2,
          spanGaps: false,
          points: { show: false },
          paths: uPlot.paths.stepped({ align: 1 }),
          fill: single ? trendHexToRgba(s.color, 0.1) : undefined,
        })),
      ],
      hooks: {
        setSelect: [
          (u) => {
            if (u.select.width < 8) return;
            const from = u.posToVal(u.select.left, 'x') * 1000;
            const to = u.posToVal(u.select.left + u.select.width, 'x') * 1000;
            u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
            if (zoomRef.current && to - from >= 10 * 60 * 1000) zoomRef.current(Math.round(from), Math.round(to));
          },
        ],
        setCursor: [
          (u) => {
            const idx = u.cursor.idx;
            if (idx === null || idx === undefined || u.cursor.left < 0) {
              tip.style.display = 'none';
              return;
            }
            const rows = [];
            const head = document.createElement('div');
            head.className = 'trend-tip-time';
            head.textContent = trendFormatTime(data[0][idx] * 1000);
            rows.push(head);
            series.forEach((s, i) => {
              const row = document.createElement('div');
              row.className = 'trend-tip-row';
              const key = document.createElement('span');
              key.className = 'trend-key';
              key.style.background = s.color;
              const value = document.createElement('strong');
              value.textContent = trendFullNumber(data[i + 1][idx]);
              const name = document.createElement('span');
              name.className = 'trend-tip-name';
              name.textContent = s.name;
              row.append(key, value, name);
              rows.push(row);
            });
            tip.replaceChildren(...rows);
            tip.style.display = 'block';
            const wrapWidth = wrap.clientWidth;
            const tipWidth = tip.offsetWidth;
            let left = u.cursor.left + u.over.offsetLeft + 14;
            if (left + tipWidth > wrapWidth - 8) left = u.cursor.left + u.over.offsetLeft - tipWidth - 14;
            tip.style.left = `${Math.max(8, left)}px`;
            tip.style.top = '12px';
          },
        ],
      },
    };

    const plot = new uPlot(opts, data, host);
    const observer = new ResizeObserver(() => plot.setSize({ width: Math.max(240, host.clientWidth), height }));
    observer.observe(host);
    return () => {
      observer.disconnect();
      plot.destroy();
    };
  }, [timestamps, series, height]);

  return (
    <div ref={wrapRef} className="trend-chart-wrap" style={{ opacity: dimmed ? 0.55 : 1 }}>
      <div ref={hostRef} />
      <div ref={tipRef} className="trend-tip" style={{ display: 'none' }} />
    </div>
  );
}

// Search-and-add picker for characters or Free Companies. Each pick gets a color slot that it keeps.
function TrendSubjectPicker({ items, selection, onAdd, onRemove, noun, latest }) {
  const { useState } = React;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const chosen = new Set(selection.map((s) => s.id));
  const matches = items.filter((it) => !chosen.has(it.id) && it.label.toLowerCase().includes(query.toLowerCase())).slice(0, 60);
  const full = selection.length >= TREND_MAX_SERIES;

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '6px' }}>
        {selection.map((s) => {
          const item = items.find((it) => it.id === s.id);
          return (
            <span key={s.id} className="trend-chip">
              <span className="trend-key" style={{ background: TREND_COLORS[s.slot] }} />
              <span>{item ? item.label : s.id}</span>
              {latest && latest[s.id] !== undefined && <strong>{trendFullNumber(latest[s.id])}</strong>}
              <button onClick={() => onRemove(s.id)} title="Remove" style={{ fontSize: '0.8em', padding: '0 4px', marginLeft: '6px' }}>x</button>
            </span>
          );
        })}
      </div>
      {full ? (
        <div className="trend-note">Up to {TREND_MAX_SERIES} at a time. Remove one to add another.</div>
      ) : (
        <div style={{ position: 'relative', width: '340px' }}>
          <input
            type="text"
            value={query}
            placeholder={`Add a ${noun}...`}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            style={{ width: '100%' }}
          />
          {open && matches.length > 0 && (
            <div className="trend-menu">
              {matches.map((it) => (
                <div key={it.id} className="trend-menu-item" onMouseDown={() => { onAdd(it.id); setQuery(''); setOpen(false); }}>
                  {it.label}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// The table view's scrolling box. Its bottom-right corner can be dragged to change the height, and
// the height you choose is remembered.
const TREND_TABLE_HEIGHT_KEY = 'trendTableHeight';
function TrendTableBox({ dimmed, children }) {
  const { useRef, useEffect } = React;
  const boxRef = useRef(null);
  let initial = 420;
  try {
    const saved = Number(window.localStorage.getItem(TREND_TABLE_HEIGHT_KEY));
    if (Number.isFinite(saved) && saved >= 160) initial = Math.min(saved, 4000);
  } catch (e) { /* default height */ }

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return undefined;
    let timer = null;
    let first = true;
    const observer = new ResizeObserver(() => {
      if (first) { first = false; return; }
      clearTimeout(timer);
      timer = setTimeout(() => {
        try { window.localStorage.setItem(TREND_TABLE_HEIGHT_KEY, String(Math.round(box.getBoundingClientRect().height))); } catch (e) { /* not saved */ }
      }, 300);
    });
    observer.observe(box);
    return () => { clearTimeout(timer); observer.disconnect(); };
  }, []);

  return (
    <div ref={boxRef} className="trend-table-box" style={{ height: initial, opacity: dimmed ? 0.55 : 1 }}>
      {children}
    </div>
  );
}

function TrendsView({ refreshKey, preset }) {
  const { useState, useEffect, useRef, useMemo } = React;
  const [meta, setMeta] = useState(null);
  const [metaError, setMetaError] = useState(null);
  const [metricKey, setMetricKey] = useState('gil');
  const [scope, setScope] = useState('fleet'); // fleet | characters | fcs
  const [selection, setSelection] = useState([]); // [{ id, slot }]
  const [rangeKey, setRangeKey] = useState('30d');
  const [zoom, setZoom] = useState(null); // { from, to } in ms, replaces the preset range
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState('chart'); // chart | table
  const requestId = useRef(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([window.api.getMetricCatalog(), window.api.getMetricSubjects()])
      .then(([catalog, subjects]) => {
        if (cancelled) return;
        if (!catalog.success) return setMetaError(catalog.error);
        if (!subjects.success) return setMetaError(subjects.error);
        setMeta({ catalog: catalog.rows, prices: catalog.salvagePrices, characters: subjects.characters, fcs: subjects.fcs });
        setMetaError(null);
      })
      .catch((err) => !cancelled && setMetaError(String(err.message || err)));
    return () => { cancelled = true; };
  }, [refreshKey]);

  // Opened from a Summary tile: show that value for the whole fleet over the last 30 days.
  useEffect(() => {
    if (!preset) return;
    setMetricKey(preset.metric);
    if ((preset.scope === 'characters' || preset.scope === 'fcs') && preset.subjectId) {
      setScope(preset.scope);
      setSelection([{ id: String(preset.subjectId), slot: 0 }]);
    } else {
      setScope('fleet');
      setSelection([]);
    }
    setRangeKey(preset.rangeKey || '30d');
    setZoom(null);
  }, [preset]);

  const metrics = useMemo(() => (meta ? buildTrendMetrics(meta.prices) : []), [meta]);
  const metric = metrics.find((m) => m.key === metricKey) || metrics[0];

  const characterItems = useMemo(
    () => (meta ? meta.characters.map((c) => ({ id: c.id, label: `${c.name} (${c.world})` })) : []),
    [meta]
  );
  const fcItems = useMemo(
    () => (meta ? meta.fcs.map((f) => ({ id: f.id, label: f.leader ? `${f.name} — ${f.leader}` : f.name })) : []),
    [meta]
  );
  const itemsForScope = scope === 'characters' ? characterItems : fcItems;

  function pickScope(next) {
    setScope(next);
    const list = next === 'characters' ? characterItems : next === 'fcs' ? fcItems : [];
    setSelection(list.length > 0 ? [{ id: list[0].id, slot: 0 }] : []);
    setZoom(null);
  }

  function pickMetric(key) {
    setMetricKey(key);
    const next = metrics.find((m) => m.key === key);
    const subjectType = scope === 'characters' ? 'character' : scope === 'fcs' ? 'fc' : null;
    if (subjectType && next && !next.parts[subjectType]) pickScope('fleet');
  }

  function addSubject(id) {
    setSelection((prev) => {
      if (prev.length >= TREND_MAX_SERIES) return prev;
      const used = new Set(prev.map((s) => s.slot));
      let slot = 0;
      while (used.has(slot)) slot++;
      return [...prev, { id, slot }];
    });
  }

  const firstRecorded = useMemo(() => {
    if (!meta || !metric) return null;
    const names = new Set(Object.values(metric.parts).flat().map((p) => p.metric));
    const times = meta.catalog.filter((r) => names.has(r.metric) && r.firstRecorded).map((r) => new Date(r.firstRecorded).getTime());
    return times.length > 0 ? Math.min(...times) : null;
  }, [meta, metric]);

  const request = useMemo(() => {
    if (!meta || !metric) return null;
    let parts;
    let subjectIds;
    if (scope === 'fleet') {
      parts = metric.fleetTypes.flatMap((t) => metric.parts[t].map((p) => ({ ...p, subjectType: t })));
    } else {
      const subjectType = scope === 'characters' ? 'character' : 'fc';
      if (!metric.parts[subjectType] || selection.length === 0) return null;
      parts = metric.parts[subjectType].map((p) => ({ ...p, subjectType }));
      subjectIds = selection.map((s) => s.id);
    }
    const range = TREND_RANGES.find((r) => r.key === rangeKey);
    const now = Date.now();
    let from;
    let to;
    if (zoom) {
      ({ from, to } = zoom);
    } else if (range.ms) {
      from = now - range.ms;
      to = now;
    } else {
      from = firstRecorded ? firstRecorded : now - 30 * TREND_DAY;
      to = now;
    }
    return { from: new Date(from).toISOString(), to: new Date(to).toISOString(), points: zoom ? 150 : range.points, parts, subjectIds };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta, metric, scope, selection, rangeKey, zoom, firstRecorded, refreshKey]);

  useEffect(() => {
    if (!request) {
      setResult(null);
      return;
    }
    const id = ++requestId.current;
    setLoading(true);
    window.api.getMetricSeries(request)
      .then((res) => {
        if (id !== requestId.current) return;
        if (res.success) { setResult(res); setError(null); } else { setError(res.error); }
      })
      .catch((err) => id === requestId.current && setError(String(err.message || err)))
      .finally(() => id === requestId.current && setLoading(false));
  }, [request]);

  const chartSeries = useMemo(() => {
    if (!result) return [];
    if (scope === 'fleet') return [{ name: 'Whole fleet', color: TREND_COLORS[0], values: result.series[0].values }];
    return selection.map((s) => {
      const item = itemsForScope.find((it) => it.id === s.id);
      const found = result.series.find((r) => r.subjectId === s.id);
      return { name: item ? item.label : s.id, color: TREND_COLORS[s.slot], values: found ? found.values : result.timestamps.map(() => null) };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, scope, selection, meta]);

  if (metaError) return <div className="status">Could not load trend data: {metaError}</div>;
  if (!meta) return <div className="status">Loading...</div>;

  const hasData = chartSeries.some((s) => s.values.some((v) => v !== null));
  const latest = (values) => { for (let i = values.length - 1; i >= 0; i--) if (values[i] !== null) return values[i]; return null; };
  const firstValue = (values) => { for (let i = 0; i < values.length; i++) if (values[i] !== null) return values[i]; return null; };
  const latestById = {};
  if (scope !== 'fleet') selection.forEach((sel, i) => { if (chartSeries[i]) latestById[sel.id] = latest(chartSeries[i].values); });
  const scopeHint = scope === 'characters' && metric && metric.key.startsWith('salvage')
    ? 'Character totals cover bags and retainers. Free Company chests are counted under Free Companies.'
    : null;

  return (
    <div className="trends-root">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 20px', alignItems: 'flex-end', marginBottom: '12px' }}>
        <label className="trend-field">
          <span>Value</span>
          <select value={metric.key} onChange={(e) => pickMetric(e.target.value)}>
            {metrics.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
        </label>
        <label className="trend-field">
          <span>Show</span>
          <select value={scope} onChange={(e) => pickScope(e.target.value)}>
            <option value="fleet">Whole fleet (total)</option>
            {metric.parts.character && <option value="characters">Characters (compare)</option>}
            {metric.parts.fc && <option value="fcs">Free Companies (compare)</option>}
          </select>
        </label>
        <div className="trend-field">
          <span>Time span</span>
          <div className="trend-segmented">
            {TREND_RANGES.map((r) => (
              <button key={r.key} className={!zoom && rangeKey === r.key ? 'active' : ''} onClick={() => { setRangeKey(r.key); setZoom(null); }}>
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <div className="trend-field">
          <span>View</span>
          <div className="trend-segmented">
            <button className={mode === 'chart' ? 'active' : ''} onClick={() => setMode('chart')}>Chart</button>
            <button className={mode === 'table' ? 'active' : ''} onClick={() => setMode('table')}>Table</button>
          </div>
        </div>
      </div>

      {scope !== 'fleet' && (
        <div style={{ marginBottom: '12px' }}>
          <TrendSubjectPicker
            items={itemsForScope}
            selection={selection}
            onAdd={addSubject}
            onRemove={(id) => setSelection((prev) => prev.filter((s) => s.id !== id))}
            noun={scope === 'characters' ? 'character' : 'Free Company'}
            latest={result ? latestById : undefined}
          />
        </div>
      )}
      {scopeHint && <div className="trend-note">{scopeHint}</div>}

      {zoom && (
        <div className="trend-note">
          Showing {trendFormatTime(zoom.from)} to {trendFormatTime(zoom.to)}{' '}
          <button onClick={() => setZoom(null)} style={{ marginLeft: '8px' }}>Reset zoom</button>
        </div>
      )}

      {error && <div className="trend-note">Could not load this chart: {error}</div>}

      {!request && scope !== 'fleet' && <div className="trend-note">Pick at least one to chart.</div>}

      {request && !result && loading && <div className="status">Loading...</div>}

      {result && (
        <div>
          {chartSeries.length === 1 && hasData && (() => {
            const now = latest(chartSeries[0].values);
            const start = firstValue(chartSeries[0].values);
            const change = now !== null && start !== null ? now - start : null;
            return (
              <div className="trend-summary">
                <div>
                  <div className="trend-summary-label">Current</div>
                  <div className="trend-summary-value">{trendFullNumber(now)}</div>
                </div>
                <div>
                  <div className="trend-summary-label">Change over this span</div>
                  <div className="trend-summary-value">
                    {change === null ? '—' : `${change > 0 ? '+' : ''}${trendFullNumber(change)}`}
                    {change !== null && start !== 0 && (
                      <span className="trend-summary-sub"> ({change > 0 ? '+' : ''}{((change / Math.abs(start)) * 100).toFixed(1)}%)</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {!hasData ? (
            <div className="trend-note" style={{ marginTop: '12px' }}>
              No history recorded for this yet in this time span.
              {firstRecorded ? ` Recording of this value began ${trendFormatTime(firstRecorded)}.` : ''}
            </div>
          ) : mode === 'chart' ? (
            <TrendChart
              timestamps={result.timestamps}
              series={chartSeries}
              dimmed={loading}
              onZoom={(from, to) => setZoom({ from, to })}
            />
          ) : (
            <TrendTableBox dimmed={loading}>
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    {chartSeries.map((s, i) => <th key={i}>{s.name}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {result.timestamps.map((t, i) => (
                    <tr key={t}>
                      <td>{trendFormatTime(t)}</td>
                      {chartSeries.map((s, j) => <td key={j}>{trendFullNumber(s.values[i])}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TrendTableBox>
          )}
          {mode === 'table' && hasData && <div className="trend-note" style={{ marginTop: '4px' }}>Drag the bottom-right corner of the table to make it taller or shorter.</div>}
          {hasData && mode === 'chart' && <div className="trend-note" style={{ marginTop: '6px' }}>Drag across the chart to zoom into that span.</div>}
        </div>
      )}
    </div>
  );
}

// ---- Summary tiles: a small trend line per fleet-wide value, for the Summary tab ----

const TREND_TILE_KEYS = ['gil', 'ceruleum', 'repair_kits', 'fc_points', 'salvage_value'];
const TREND_TILE_DAYS = 30;
const TREND_TILE_POINTS = 30;

// A tiny step line with no axes: a 2px line, and an 8px end dot with a 2px surface ring. The line
// stretches with the tile; the dot is a separate element so stretching never distorts it.
function TrendSparkline({ values, height = 44 }) {
  const width = 200;
  const known = values.map((v, i) => [i, v]).filter(([, v]) => v !== null);
  if (known.length < 2) return <div style={{ height }} />;
  const min = Math.min(...known.map(([, v]) => v));
  const max = Math.max(...known.map(([, v]) => v));
  const padX = 6;
  const padY = 8;
  const x = (i) => padX + (i * (width - 2 * padX)) / (values.length - 1);
  const y = (v) => (max === min ? height / 2 : height - padY - ((v - min) * (height - 2 * padY)) / (max - min));
  let path = '';
  known.forEach(([i, v], k) => {
    if (k === 0) path += `M ${x(i)} ${y(v)}`;
    else path += ` H ${x(i)} V ${y(v)}`;
  });
  const [lastI, lastV] = known[known.length - 1];
  return (
    <div style={{ position: 'relative', height }} aria-hidden="true">
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: 'block' }}>
        <path d={path} fill="none" stroke="#3987e5" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <span
        style={{
          position: 'absolute',
          left: `${(x(lastI) / width) * 100}%`,
          top: y(lastV),
          width: 8,
          height: 8,
          marginLeft: -4,
          marginTop: -4,
          borderRadius: '50%',
          background: '#3987e5',
          boxShadow: `0 0 0 2px ${TREND_SURFACE}`,
        }}
      />
    </div>
  );
}

// Tiles for subs only (ceruleum, repair kits, salvage) are left out when the player does not run subs.
const TREND_TILE_SUB_KEYS = ['ceruleum', 'repair_kits', 'salvage_value'];

function SummaryTrendTiles({ refreshKey, onOpenTrend, uses = { subs: true, retainers: true } }) {
  const { useState, useEffect } = React;
  const [tiles, setTiles] = useState(null); // [{ key, label, values }] once loaded
  const [note, setNote] = useState(null);

  useEffect(() => {
    let cancelled = false;
    window.api.getMetricCatalog()
      .then(async (catalog) => {
        if (!catalog.success) throw new Error(catalog.error);
        const metrics = buildTrendMetrics(catalog.salvagePrices)
          .filter((m) => TREND_TILE_KEYS.includes(m.key) && (uses.subs || !TREND_TILE_SUB_KEYS.includes(m.key)));
        const now = Date.now();
        const results = await Promise.all(metrics.map((m) => window.api.getMetricSeries({
          from: new Date(now - TREND_TILE_DAYS * TREND_DAY).toISOString(),
          to: new Date(now).toISOString(),
          points: TREND_TILE_POINTS,
          parts: m.fleetTypes.flatMap((t) => m.parts[t].map((p) => ({ ...p, subjectType: t }))),
        })));
        if (cancelled) return;
        setTiles(metrics.map((m, i) => ({
          key: m.key,
          label: m.label,
          values: results[i].success ? results[i].series[0].values : null,
        })));
        setNote(null);
      })
      .catch((err) => !cancelled && setNote(String(err.message || err)));
    return () => { cancelled = true; };
  }, [refreshKey, uses.subs]);

  if (note) return <div className="trend-note" style={{ padding: '0 24px 8px' }}>Trends are unavailable right now: {note}</div>;

  const shells = tiles || TREND_TILE_KEYS.map((key) => ({ key, label: '', values: undefined }));

  return (
    <div>
      <h2 style={{ padding: '8px 24px 0' }}>Trends, last {TREND_TILE_DAYS} days</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '16px', padding: '8px 24px 16px' }}>
        {shells.map((t) => {
          const values = t.values || [];
          const known = values.filter((v) => v !== null);
          const current = known.length > 0 ? known[known.length - 1] : null;
          const start = known.length > 0 ? known[0] : null;
          const change = current !== null && start !== null ? current - start : null;
          const pct = change !== null && start !== 0 ? (change / Math.abs(start)) * 100 : null;
          return (
            <div key={t.key} className="account-group" style={{ padding: '16px', opacity: tiles ? 1 : 0.5 }}>
              <div style={{ color: '#8a8f9a', fontSize: '13px' }}>{t.label || '\u00a0'}</div>
              <div style={{ fontSize: '22px', fontWeight: 600 }}>{trendFullNumber(current)}</div>
              <div style={{ color: '#8a8f9a', fontSize: '12px', minHeight: '16px' }}>
                {change === null ? (tiles ? 'No history yet' : '') : (
                  <span>
                    {change > 0 ? '\u25B2' : change < 0 ? '\u25BC' : '\u25AC'} {pct !== null ? `${Math.abs(pct).toFixed(1)}%` : trendFullNumber(Math.abs(change))}
                  </span>
                )}
              </div>
              <div style={{ margin: '6px 0' }}><TrendSparkline values={values} /></div>
              <button onClick={() => onOpenTrend(t.key)} disabled={!tiles} style={{ marginTop: '2px' }}>View trend</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}


// ---- Charts inside other tabs, and the per-character / per-Free-Company detail panel ----

// One shared, briefly remembered copy of the catalog (it also carries the salvage prices), so a
// page full of cards does not ask for it once each.
let trendCatalogCache = null;
function getTrendCatalog() {
  if (trendCatalogCache && Date.now() - trendCatalogCache.at < 60000) return trendCatalogCache.promise;
  const promise = window.api.getMetricCatalog().then((r) => {
    if (!r.success) throw new Error(r.error);
    return r;
  });
  const entry = { at: Date.now(), promise };
  trendCatalogCache = entry;
  promise.catch(() => { if (trendCatalogCache === entry) trendCatalogCache = null; });
  return promise;
}

// The interface asks App to open things by event, so a table cell needs no props threaded to it.
function openTrendDetail(kind, id, name) {
  window.dispatchEvent(new CustomEvent('open-trend-detail', { detail: { kind, id: String(id), name } }));
}
function openTrendsTab(preset) {
  window.dispatchEvent(new CustomEvent('open-trends', { detail: preset }));
}

// A small chart icon shown beside a character or Free Company name; opens its detail panel.
function TrendDetailLink({ kind, id, name }) {
  return (
    <button
      className="trend-link"
      title={`Show trends for ${name}`}
      aria-label={`Show trends for ${name}`}
      onClick={(e) => { e.stopPropagation(); openTrendDetail(kind, id, name); }}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <path d="M1 11 H4 V7 H7 V9 H10 V3 H13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </button>
  );
}

// A compact chart of one value for the whole fleet, one character or one Free Company. Used at the
// top of some tabs and in the detail panel. `days` sets the span; the parent may change it.
function TrendCard({ title, metricKey, scope = 'fleet', subjectId, days = 30, refreshKey, height = 160, collapsible, storageKey, controls }) {
  const { useState, useEffect, useMemo } = React;
  const [open, setOpen] = useState(() => {
    if (!collapsible) return true;
    try { return window.localStorage.getItem(storageKey) !== 'closed'; } catch (e) { return true; }
  });
  const [range, setRange] = useState(days);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const shownDays = controls ? days : range;

  function toggle() {
    const next = !open;
    setOpen(next);
    if (collapsible) { try { window.localStorage.setItem(storageKey, next ? 'open' : 'closed'); } catch (e) { /* not saved */ } }
  }

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setLoading(true);
    getTrendCatalog()
      .then((catalog) => {
        const metric = buildTrendMetrics(catalog.salvagePrices).find((m) => m.key === metricKey);
        if (!metric) throw new Error('Unknown value');
        const subjectType = scope === 'character' ? 'character' : 'fc';
        const parts = scope === 'fleet'
          ? metric.fleetTypes.flatMap((t) => metric.parts[t].map((pt) => ({ ...pt, subjectType: t })))
          : (metric.parts[subjectType] || []).map((pt) => ({ ...pt, subjectType }));
        if (parts.length === 0) return { success: true, none: true };
        const now = Date.now();
        return window.api.getMetricSeries({
          from: new Date(now - shownDays * TREND_DAY).toISOString(),
          to: new Date(now).toISOString(),
          points: 120,
          parts,
          subjectIds: scope === 'fleet' ? undefined : [String(subjectId)],
        });
      })
      .then((res) => {
        if (cancelled) return;
        if (res.success) { setResult(res); setError(null); } else setError(res.error);
      })
      .catch((err) => !cancelled && setError(String(err.message || err)))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [open, metricKey, scope, subjectId, shownDays, refreshKey]);

  const series = useMemo(() => {
    if (!result || result.none) return null;
    return [{ name: title, color: TREND_COLORS[0], values: result.series[0].values }];
  }, [result, title]);

  const known = series ? series[0].values.filter((v) => v !== null) : [];
  const current = known.length > 0 ? known[known.length - 1] : null;
  const start = known.length > 0 ? known[0] : null;
  const change = current !== null && start !== null ? current - start : null;
  const pct = change !== null && start !== 0 ? (change / Math.abs(start)) * 100 : null;

  return (
    <div className="trend-card">
      <div className="trend-card-head">
        <div>
          <div className="trend-card-title">{title}</div>
          {open && (
            <div className="trend-card-value">
              <strong>{trendFullNumber(current)}</strong>
              {change !== null && (
                <span className="trend-summary-sub"> {change > 0 ? '\u25B2' : change < 0 ? '\u25BC' : '\u25AC'} {pct !== null ? `${Math.abs(pct).toFixed(1)}%` : trendFullNumber(Math.abs(change))}</span>
              )}
            </div>
          )}
        </div>
        <div className="trend-card-actions">
          {open && !controls && (
            <div className="trend-segmented">
              {[7, 30, 90].map((d) => (
                <button key={d} className={range === d ? 'active' : ''} onClick={() => setRange(d)}>{d} d</button>
              ))}
            </div>
          )}
          <button onClick={() => openTrendsTab({ metric: metricKey, scope: scope === 'fleet' ? 'fleet' : scope === 'character' ? 'characters' : 'fcs', subjectId, rangeKey: shownDays >= 365 ? '1y' : shownDays >= 90 ? '90d' : shownDays >= 30 ? '30d' : '7d' })}>Open in Trends</button>
          {collapsible && <button onClick={toggle}>{open ? 'Hide' : 'Show chart'}</button>}
        </div>
      </div>
      {open && error && <div className="trend-note">Could not load this chart: {error}</div>}
      {open && !error && !series && !(result && result.none) && <div className="trend-note">Loading...</div>}
      {open && result && result.none && <div className="trend-note">Not recorded for this.</div>}
      {open && series && known.length === 0 && <div className="trend-note">No history recorded for this yet.</div>}
      {open && series && known.length > 0 && <TrendChart timestamps={result.timestamps} series={series} dimmed={loading} height={height} />}
    </div>
  );
}

// The panel opened from the chart icon beside a character or Free Company name.
function TrendDetailPanel({ kind, id, name, onClose, refreshKey }) {
  const { useState, useEffect } = React;
  const [days, setDays] = useState(90);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const cards = kind === 'character'
    ? [
        { title: 'Gil', metricKey: 'gil' },
        { title: 'Ceruleum', metricKey: 'ceruleum' },
        { title: 'Repair kits', metricKey: 'repair_kits' },
        { title: 'FC points (this character leads the FC)', metricKey: 'fc_points' },
        { title: 'Salvage value, bags and retainers (gil)', metricKey: 'salvage_value' },
      ]
    : [
        { title: 'FC points', metricKey: 'fc_points' },
        { title: 'Salvage value in the FC chest (gil)', metricKey: 'salvage_value' },
        { title: 'Salvage items in the FC chest', metricKey: 'salvage_items' },
      ];

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal trend-detail" role="dialog" aria-label={`Trends for ${name}`}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', marginBottom: '12px' }}>
          <div>
            <h2 style={{ margin: 0 }}>{name}</h2>
            <div className="trend-note" style={{ padding: 0 }}>{kind === 'character' ? 'Character' : 'Free Company'} trends</div>
          </div>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <div className="trend-segmented">
              {[[30, '30 days'], [90, '90 days'], [365, '1 year']].map(([d, label]) => (
                <button key={d} className={days === d ? 'active' : ''} onClick={() => setDays(d)}>{label}</button>
              ))}
            </div>
            <button onClick={onClose}>Close</button>
          </div>
        </div>
        <div className="trend-detail-grid">
          {cards.map((c) => (
            <TrendCard
              key={c.metricKey}
              title={c.title}
              metricKey={c.metricKey}
              scope={kind}
              subjectId={id}
              days={days}
              controls
              height={150}
              refreshKey={refreshKey}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
