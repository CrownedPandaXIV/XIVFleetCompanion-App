// Parts tab → Shopping List: the sub parts to craft, what to craft on the way, and the raw materials and
// crystals to gather or buy, less what is held across the fleet (worked out in ipc/shopping.js).

// "Bex Kitteh (Maduin): Retainer Amy (8), Bags (2)"
function shoppingPlacesText(places) {
  const byWho = new Map();
  for (const p of places) {
    if (!byWho.has(p.who)) byWho.set(p.who, []);
    byWho.get(p.who).push(`${p.where} (${p.qty})`);
  }
  return [...byWho].map(([who, list]) => `${who}: ${list.join(', ')}`);
}

function ShoppingPlaces({ places }) {
  const [open, setOpen] = useState(false);
  if (!places.length) return null;
  const lines = shoppingPlacesText(places);
  if (lines.length === 1) return <span className="shopping-places">{lines[0]}</span>;
  return (
    <span className="shopping-places">
      <button className="link-button" onClick={() => setOpen((v) => !v)}>
        {open ? 'Hide' : `${lines.length} places`}
      </button>
      {open && lines.map((line) => <div key={line}>{line}</div>)}
    </span>
  );
}

const shoppingGil = (n) => `${Number(n).toLocaleString()} gil`;

// Columns for the Craft first, Gather or buy and Crystals sections: kind 'craft' has Make and Crafter,
// 'gather' has Short. A vendor's price shows for items a vendor sells.
function shoppingItemDefs(kind) {
  const missing = (r) => (kind === 'craft' ? r.make : r.short);
  return [
    { key: 'item', label: 'Item', locked: true, cell: (r) => r.name, sort: (r) => r.name },
    { key: 'need', label: 'Need', cell: (r) => r.need, sort: (r) => r.need },
    { key: 'have', label: 'Have', cell: (r) => r.have, sort: (r) => r.have },
    {
      key: 'missing', label: kind === 'craft' ? 'Make' : 'Short',
      cell: (r) => <><strong>{missing(r)}</strong>{kind === 'craft' && r.yield > 1 && r.crafts > 0 && <span className="shopping-note"> ({r.crafts} crafts of {r.yield})</span>}</>,
      sort: (r) => missing(r),
    },
    ...(kind === 'craft' ? [{ key: 'crafter', label: 'Crafter', cell: (r) => r.job || '?', sort: (r) => r.job }] : []),
    { key: 'vendor', label: 'Vendor', cell: (r) => (r.vendorPrice ? shoppingGil(r.vendorPrice) : ''), sort: (r) => r.vendorPrice },
    { key: 'held', label: 'Held in', cell: (r) => <ShoppingPlaces places={r.places} />, sortable: false },
  ];
}
const SHOPPING_CRAFT_DEFS = shoppingItemDefs('craft');
const SHOPPING_GATHER_DEFS = shoppingItemDefs('gather');

// Live Market Prices on: the cheapest market board listing, with its world when prices are from a data
// center or region ("45,000 gil (Halicarnassus)"), or "none listed". When fewer are listed than needed, "only
// 3 of 5 listed"; hover says what buying all those needed costs, going up the listings.
function ShoppingMarketPrice({ listed, buying, kind }) {
  if (!listed) return <span className="shopping-note" title="Nobody is selling it there right now.">none listed</span>;
  const short = buying && buying.got < buying.wanted;
  const title = buying
    ? `Buying ${buying.wanted === 1 ? 'it' : `all ${buying.wanted}`}: ${shoppingGil(buying.gil)}, going up the listings from the cheapest` +
      (short ? `. Only ${buying.got} of ${buying.wanted} are listed there; that price is for those.` : '.')
    : undefined;
  return (
    <span title={title}>
      {shoppingGil(listed.price)}{kind !== 'world' && listed.world ? <span className="shopping-note"> ({listed.world})</span> : null}
      {short && <span className="shopping-note shopping-too-few"> · only {buying.got} of {buying.wanted} listed</span>}
    </span>
  );
}
const SHOPPING_MARKET_DEF = {
  key: 'market', label: 'Market board', cell: (r, ctx) => <ShoppingMarketPrice listed={r.market} buying={r.buying} kind={ctx && ctx.marketKind} />,
  sort: (r) => (r.market ? r.market.price : Infinity),
};
const SHOPPING_CRAFT_MARKET_DEFS = [...SHOPPING_CRAFT_DEFS.slice(0, -1), SHOPPING_MARKET_DEF, SHOPPING_CRAFT_DEFS[SHOPPING_CRAFT_DEFS.length - 1]];
const SHOPPING_GATHER_MARKET_DEFS = [...SHOPPING_GATHER_DEFS.slice(0, -1), SHOPPING_MARKET_DEF, SHOPPING_GATHER_DEFS[SHOPPING_GATHER_DEFS.length - 1]];

// One section (tableKey keeps each section's columns apart).
function ShoppingTable({ title, note, rows, kind, showHeld, className, tableKey, market }) {
  const missing = (r) => (kind === 'craft' ? r.make : r.short);
  const sort = useColumnSort();
  const priced = !!(market && market.scope && !market.error);
  const defs = kind === 'craft' ? (priced ? SHOPPING_CRAFT_MARKET_DEFS : SHOPPING_CRAFT_DEFS) : (priced ? SHOPPING_GATHER_MARKET_DEFS : SHOPPING_GATHER_DEFS);
  const cols = useTableColumns({ tableKey, ownDefs: defs, rows: null, idOf: () => null });
  const visible = showHeld ? rows : rows.filter((r) => missing(r) > 0);
  const hidden = rows.length - visible.length;
  return (
    <div className={`shopping-section ${className}`}>
      <h3>{title} <ColumnPicker cols={cols} /></h3>
      {note && <div className="shopping-note">{note}</div>}
      {visible.length === 0 ? (
        <div className="status">{rows.length ? 'Everything here is already held.' : 'Nothing.'}</div>
      ) : (
        <ColumnTable cols={cols} sort={sort} rows={visible} rowKey={(r) => r.itemId} ctx={{ marketKind: market && market.kind }}
          rowClassName={(r) => (missing(r) > 0 ? '' : 'shopping-done')} />
      )}
      {hidden > 0 && <div className="shopping-note">{hidden} more already held in full.</div>}
    </div>
  );
}

const SHOPPING_BUY_DEFS = [
  { key: 'item', label: 'Item', locked: true, cell: (r) => r.name, sort: (r) => r.name },
  { key: 'need', label: 'Need', cell: (r) => r.need, sort: (r) => r.need },
  { key: 'have', label: 'Have', cell: (r) => r.have, sort: (r) => r.have },
  { key: 'buy', label: 'Buy', cell: (r) => <strong>{r.short}</strong>, sort: (r) => r.short },
  { key: 'price', label: 'Price', cell: (r) => shoppingGil(r.vendorPrice), sort: (r) => r.vendorPrice },
  { key: 'cost', label: 'Cost', cell: (r) => shoppingGil(r.cost), sort: (r) => r.cost },
  { key: 'held', label: 'Held in', cell: (r) => <ShoppingPlaces places={r.places} />, sortable: false },
];

// Bought from vendors: how many, at what price, and the cost.
function ShoppingBuyTable({ rows, total, showHeld }) {
  const sort = useColumnSort();
  const cols = useTableColumns({ tableKey: 'shoppingBuy', ownDefs: SHOPPING_BUY_DEFS, rows: null, idOf: () => null });
  const visible = showHeld ? rows : rows.filter((r) => r.short > 0);
  const hidden = rows.length - visible.length;
  return (
    <div className="shopping-section shopping-buy">
      <h3>Buy from vendors <span className="shopping-total">{shoppingGil(total)}</span> <ColumnPicker cols={cols} /></h3>
      <div className="shopping-note">Sold by NPC vendors for gil, so these are not crafted and their materials are not needed.</div>
      {visible.length === 0 ? (
        <div className="status">{rows.length ? 'Everything here is already held.' : 'Nothing on this list is sold by a vendor.'}</div>
      ) : (
        <ColumnTable cols={cols} sort={sort} rows={visible} rowKey={(r) => r.itemId} rowClassName={(r) => (r.short > 0 ? '' : 'shopping-done')} />
      )}
      {hidden > 0 && <div className="shopping-note">{hidden} more already held in full.</div>}
    </div>
  );
}

// The list as plain text, for pasting somewhere.
function shoppingListText(list) {
  const lines = ['Sub parts to craft:'];
  for (const p of list.parts) lines.push(`  ${p.crafts}x ${p.name}${p.job ? ` (${p.job})` : ''}${p.made ? `, ${p.made} made` : ''}`);
  const bought = list.buy.filter((r) => r.short > 0);
  if (bought.length) {
    lines.push('', `Buy from vendors (${shoppingGil(list.buyCost)}):`);
    for (const r of bought) lines.push(`  ${r.short}x ${r.name} (${shoppingGil(r.cost)})`);
  }
  const craft = list.craft.filter((r) => r.make > 0);
  if (craft.length) {
    lines.push('', 'Craft first:');
    for (const r of craft) lines.push(`  ${r.make}x ${r.name}${r.job ? ` (${r.job})` : ''}`);
  }
  for (const [title, rows] of [['Gather or buy:', list.gather], ['Crystals:', list.crystals]]) {
    const short = rows.filter((r) => r.short > 0);
    if (!short.length) continue;
    lines.push('', title);
    for (const r of short) lines.push(`  ${r.short}x ${r.name}`);
  }
  return lines.join('\n');
}

// How many of a part have been crafted: a number box plus "all made", saved for every PC.
function ShoppingMadeCell({ part, onSave }) {
  const [value, setValue] = useState(String(part.made || 0));
  useEffect(() => setValue(String(part.made || 0)), [part.made]);
  const save = (n) => {
    const made = Math.max(0, Math.min(part.crafts, Math.round(Number(n) || 0)));
    setValue(String(made));
    if (made !== (part.made || 0)) onSave(part, made);
  };
  return (
    <td className="shopping-made">
      <input type="number" min={0} max={part.crafts} value={value} style={{ width: '50px' }}
        onChange={(e) => setValue(e.target.value)} onBlur={(e) => save(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }} />
      {' '}of {part.crafts}{' '}
      <label><input type="checkbox" checked={(part.made || 0) >= part.crafts} onChange={(e) => save(e.target.checked ? part.crafts : 0)} /> all made</label>
    </td>
  );
}

// The sub parts to craft; ctx.onSave saves how many are made.
const SHOPPING_PART_DEFS = [
  { key: 'part', label: 'Part', locked: true, cell: (p) => p.name, sort: (p) => p.name },
  { key: 'craft', label: 'Craft', cell: (p) => <strong>{p.crafts}</strong>, sort: (p) => p.crafts },
  { key: 'crafter', label: 'Crafter', cell: (p) => p.job || '?', sort: (p) => p.job },
  { key: 'made', label: 'Made', td: (p, ctx) => <ShoppingMadeCell part={p} onSave={ctx.onSave} />, sort: (p) => p.made || 0 },
];
// Live Market Prices on: what one costs on the market board, what it costs to make, and which is cheaper.
const SHOPPING_MAKE_COST_TITLE = 'One part made from its materials, each at its cheapest: a vendor, the market board, or making it. ' +
  'What you already hold is not taken off.';
const SHOPPING_PART_MARKET_DEFS = [
  ...SHOPPING_PART_DEFS.slice(0, 3),
  SHOPPING_MARKET_DEF,
  {
    key: 'makeCost', label: 'To make',
    cell: (p) => (p.makeCost !== null && p.makeCost !== undefined
      ? <span title={SHOPPING_MAKE_COST_TITLE}>{shoppingGil(p.makeCost)}</span>
      : <span className="shopping-note" title="Some of its materials have no price: not sold by a vendor or listed there.">—</span>),
    sort: (p) => (p.makeCost === null || p.makeCost === undefined ? Infinity : p.makeCost),
  },
  { key: 'cheaper', label: 'Cheaper', cell: (p) => (p.cheaper === 'buy' ? 'Buy' : p.cheaper === 'make' ? 'Make' : ''), sort: (p) => p.cheaper || '' },
  SHOPPING_PART_DEFS[3],
];

// "Prices from": each world the characters are on, their data centers and regions.
function ShoppingPriceScope({ market, onChange }) {
  const groups = [['world', 'World'], ['dc', 'Data center'], ['region', 'Region']];
  return (
    <label style={{ marginLeft: '16px', whiteSpace: 'nowrap' }}
      title="Where the market board prices come from: one world, a data center, or a whole region. For a data center or region, each price says which world it is on.">
      Prices from{' '}
      <select value={market.scope || ''} onChange={(e) => onChange(e.target.value)}>
        {groups.map(([kind, label]) => {
          const these = market.choices.filter((c) => c.kind === kind);
          return these.length ? (
            <optgroup key={kind} label={label}>
              {these.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </optgroup>
          ) : null;
        })}
      </select>
    </label>
  );
}

// Where the prices are from, the totals for buying instead, and anything that went wrong.
function ShoppingMarketNote({ market, totals }) {
  if (market.error) return <div className="error">Market board prices are not shown: {market.error}</div>;
  // " (2 not listed, 1 with too few listed)"
  const missing = (none, few) => {
    const bits = [none && `${none} not listed`, few && `${few} with too few listed`].filter(Boolean);
    return bits.length ? ` (${bits.join(', ')})` : '';
  };
  return (
    <div className="shopping-note">
      Market board prices from {market.label}: the cheapest listing of each, leaving out your own retainers'. Totals go up
      the listings from the cheapest, as buying them would.
      {totals && <> Buying the parts not made yet: <strong>{shoppingGil(totals.parts)}</strong>{missing(totals.partsUnlisted, totals.partsTooFew)}.
        Buying every material still short: <strong>{shoppingGil(totals.materials)}</strong>{missing(totals.materialsUnlisted, totals.materialsTooFew)}.</>}
      {market.stale && <span> Universalis did not answer ({market.stale.problem}), so some prices are from {new Date(market.stale.since).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.</span>}
    </div>
  );
}

function ShoppingListView({ refreshKey, aheadDays = 0 }) {
  const partSort = useColumnSort();
  const [priceScope, setPriceScope] = useState(() => {
    try { return localStorage.getItem('shoppingPriceScope') || null; } catch { return null; }
  });
  const [list, setList] = useState(null);
  const priced = !!(list && list.market && list.market.scope && !list.market.error);
  const partCols = useTableColumns({ tableKey: 'shoppingParts', ownDefs: priced ? SHOPPING_PART_MARKET_DEFS : SHOPPING_PART_DEFS, rows: null, idOf: () => null });
  const [error, setError] = useState(null);
  const [showHeld, setShowHeld] = useState(false);
  const [copied, setCopied] = useState(false);
  const [progressError, setProgressError] = useState(null);
  // While a new list is worked out, the last one stays on screen (so the page keeps its scroll position).
  const [updating, setUpdating] = useState(false);
  const [buyFromVendors, setBuyFromVendors] = useState(() => {
    try { return localStorage.getItem('shoppingBuyFromVendors') === 'true'; } catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem('shoppingBuyFromVendors', String(buyFromVendors)); } catch { /* only a convenience */ }
    setUpdating(true);
    let current = true;
    window.api.getShoppingList({ buyFromVendors, aheadDays, priceScope }).then((result) => {
      if (!current) return;
      setUpdating(false);
      if (result.success) { setList(result); setError(null); } else setError(result.error);
    });
    return () => { current = false; };
  }, [refreshKey, buyFromVendors, aheadDays, priceScope]);

  function choosePriceScope(value) {
    setPriceScope(value);
    try { localStorage.setItem('shoppingPriceScope', value); } catch { /* only a convenience */ }
  }

  if (error && list === null) return <div className="error">Failed to load the shopping list: {error}</div>;
  if (list === null) return <div className="status">Working out the shopping list...</div>;
  if (list.empty) {
    return <div className="status">Nothing needs crafting - every need is either met, covered by a spare, or covered by a reused old part{aheadDays ? ', with no new build due in that time' : ''}.</div>;
  }

  function copy() {
    navigator.clipboard.writeText(shoppingListText(list)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function saveMade(part, made) {
    setList((l) => ({ ...l, parts: l.parts.map((p) => (p.itemId === part.itemId ? { ...p, made } : p)) }));
    const result = await window.api.saveShoppingProgress({ itemId: part.itemId, made, crafts: part.crafts, aheadDays });
    setProgressError(result.success ? null : result.error);
  }

  const noRecipe = list.parts.filter((p) => p.noRecipe);
  return (
    <div className="shopping-list">
      <div className="controls">
        <label title={list.vendorsLoaded ? '' : 'Needs the vendor list from the game data: check for game data updates in Settings → Data and apply them.'}>
          <input type="checkbox" checked={buyFromVendors && list.vendorsLoaded} disabled={!list.vendorsLoaded}
            onChange={(e) => setBuyFromVendors(e.target.checked)} />
          {' '}Buy from vendors where they sell it
        </label>
        <label style={{ marginLeft: '16px' }}>
          <input type="checkbox" checked={showHeld} onChange={(e) => setShowHeld(e.target.checked)} />
          {' '}Show items already held in full
        </label>
        {list.market && list.market.enabled && list.market.choices && list.market.choices.length > 0 && (
          <ShoppingPriceScope market={list.market} onChange={choosePriceScope} />
        )}
        <button style={{ marginLeft: '16px' }} onClick={copy}>{copied ? 'Copied' : 'Copy as Text'}</button>
        {updating && <span className="shopping-note shopping-updating" style={{ marginLeft: '16px' }}>Updating...</span>}
      </div>
      {error && <div className="error">Could not update the shopping list: {error}. Showing the last one.</div>}
      {list.market && list.market.enabled && <ShoppingMarketNote market={list.market} totals={list.marketTotals} />}
      <div className="shopping-note">
        Held counts every character's bags, saddlebags and crystals, their retainers, and the Free Company
        chests, as of each character's last sync.
      </div>
      {noRecipe.length > 0 && (
        <div className="error">No recipe found for {noRecipe.map((p) => p.name).join(', ')}. Is the game data up to date (Settings → Data)?</div>
      )}
      <div className="shopping-section shopping-parts">
        <h3>Sub parts to craft <ColumnPicker cols={partCols} /></h3>
        <div className="shopping-note">
          Tick parts off as you craft them; every PC sees it. Once the plugin sees a crafted part in bags, a retainer or the FC chest,
          it leaves the list by itself. The materials below are for every part on the list, made or not.
        </div>
        {progressError && <div className="error">Could not save: {progressError}</div>}
        <ColumnTable cols={partCols} sort={partSort} rows={list.parts} rowKey={(p) => p.itemId} ctx={{ onSave: saveMade, marketKind: list.market && list.market.kind }}
          rowClassName={(p) => ((p.made || 0) >= p.crafts ? 'shopping-done' : '')} />
      </div>
      {!list.vendorsLoaded && (
        <div className="shopping-note">Vendor prices need the vendor list from the game data: check for game data updates in Settings → Data and apply them.</div>
      )}
      {list.buyFromVendors && <ShoppingBuyTable rows={list.buy} total={list.buyCost} showHeld={showHeld} />}
      <ShoppingTable title="Craft first" note="In-between items, in the order to make them." rows={list.craft} kind="craft" showHeld={showHeld} className="shopping-craft" tableKey="shoppingCraft" market={list.market} />
      <ShoppingTable title="Gather or buy" rows={list.gather} kind="gather" showHeld={showHeld} className="shopping-gather" tableKey="shoppingGather" market={list.market} />
      <ShoppingTable title="Crystals" rows={list.crystals} kind="gather" showHeld={showHeld} className="shopping-crystals" tableKey="shoppingCrystals" market={list.market} />
    </div>
  );
}
