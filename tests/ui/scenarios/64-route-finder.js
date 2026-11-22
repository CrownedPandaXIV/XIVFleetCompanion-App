// Sub Calculator → Route Finder: the routes a build can fly on a map (tests/ui/fixtures.sql: Deep-sea Site's sectors
// O and J with XIVStats data, Z without), ranked with bars; a must; an FC's explored sectors (read in the workshop by the
// plugin, database update 18) limiting the routes and shown on the tiles; the Unlocks tab; and Open in Planner.
module.exports = async (t) => {
  const { ev, waitFor, check, nav } = t;
  const rowsSel = `document.querySelectorAll('.rf .finder-table tbody tr')`;
  await nav('Route Finder');
  await waitFor(`document.querySelectorAll('.rf-tile').length > 0 && ${rowsSel}.length > 0`, 'the Route Finder with routes', 30000);
  await t.shot('route-finder');

  const tabs = await ev(`[...document.querySelectorAll('.rf-tabs button')].map((b) => b.innerText)`);
  check(tabs.join('|') === 'Best routes|Unlocks', `two tabs (${tabs.join(', ')})`);
  const tally = await ev(`document.querySelector('.rf .finder-tally').innerText.replace(/\\s+/g, ' ')`);
  check(/[\d,]+ routes? fit in 24h and in range/.test(tally) && /vendor prices/.test(tally), `the counts on one line (${tally})`);
  const first = await ev(`(() => { const tr = ${rowsSel}[0]; return { letters: tr.querySelectorAll('.rf-route .rf-letter').length, bars: tr.querySelectorAll('.rf-bar').length,
    best: !!tr.querySelector('.rf-tag.best'), tiers: tr.querySelectorAll('.rf-tier').length }; })()`);
  check(first.letters > 0 && first.bars >= 3 && first.best && first.tiers === first.letters,
    `each route: its stops as letters, bars for time, experience and gil, a loot tier per stop; the first marked best (${JSON.stringify(first)})`);
  const exp = await ev(`[...${rowsSel}].map((tr) => Number(tr.querySelector('.rf-lead').innerText.replace(/,/g, '')))`);
  check(exp.every((v, i) => i === 0 || exp[i - 1] >= v), `best experience an hour first (${exp.slice(0, 4).join(', ')})`);

  // Dragging a column wider: shown at every mouse move, saved once when let go.
  const drag = await ev(`(() => {
    const handle = document.querySelector('.rf .finder-table thead [title="Drag to resize"]');
    const th = handle.closest('th');
    const before = th.getBoundingClientRect().width;
    const real = Storage.prototype.setItem;
    let saves = 0;
    Storage.prototype.setItem = function (k, v) { if (/width/i.test(k)) saves++; return real.call(this, k, v); };
    const x = handle.getBoundingClientRect().left + 2;
    handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x }));
    for (let i = 1; i <= 20; i++) document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x + i * 3 }));
    const during = saves;
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x + 60 }));
    Storage.prototype.setItem = real;
    return { during, saves, grew: th.getBoundingClientRect().width - before };
  })()`);
  check(drag.during === 0 && drag.saves === 1, `a column drag saves its width once, when let go (${JSON.stringify(drag)})`);

  // A must: click sector O's tile.
  await ev(`[...document.querySelectorAll('.rf-tile')].find((b) => b.querySelector('.rf-letter').innerText === 'O').click()`);
  await waitFor(`[...document.querySelectorAll('.rf-tile')].find((b) => b.querySelector('.rf-letter').innerText === 'O').classList.contains('must')
    && ${rowsSel}.length > 0 && [...${rowsSel}].every((tr) => [...tr.querySelectorAll('.rf-route .rf-letter')].some((l) => l.innerText === 'O'))`, 'routes with O', 20000);
  check(true, 'a clicked sector is a must: every route goes there');
  // Again: left out.
  await ev(`[...document.querySelectorAll('.rf-tile')].find((b) => b.querySelector('.rf-letter').innerText === 'O').click()`);
  await waitFor(`[...document.querySelectorAll('.rf-tile')].find((b) => b.querySelector('.rf-letter').innerText === 'O').classList.contains('out')
    && [...${rowsSel}].every((tr) => ![...tr.querySelectorAll('.rf-route .rf-letter')].some((l) => l.innerText === 'O'))`, 'routes without O', 20000);
  check(true, 'clicked again, it is left out');
  await ev(`[...document.querySelectorAll('.rf-tile')].find((b) => b.querySelector('.rf-letter').innerText === 'O').click()`);

  // Best for gil.
  await ev(`[...document.querySelectorAll('.rf-seg button')].find((b) => b.innerText === 'Gil').click()`);
  await waitFor(`/most gil a day/.test(document.querySelector('.rf').innerText)`, 'ranked by gil', 10000);
  check(true, 'Best for Gil ranks by gil a day');

  // The FC's sectors as the plugin read them: O explored, J discovered but not explored; Z not discovered (it opens
  // from O, so it could open).
  const fc = (await t.query(`SELECT fc_id::text AS fc FROM companion_character_current WHERE fc_id IS NOT NULL AND fc_id <> 0 ORDER BY cid LIMIT 1`))[0].fc;
  await t.query(`DELETE FROM companion_fc_sub_sector`);
  await t.query(`INSERT INTO companion_fc_sub_sector (fc_id, sector_id, unlocked, explored, read_at, cid) VALUES
    (${fc}, 1, true, true, now(), 1), (${fc}, 2, true, false, now(), 1), (${fc}, 3, false, false, now(), 1)`);
  await ev(`[...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Refresh').click()`);
  await waitFor(`[...document.querySelectorAll('.rf-note select option')].some((o) => o.value === '${fc}')`, 'the FC in the list', 20000);
  await ev(`(() => { const s = document.querySelector('.rf-note select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, '${fc}');
    s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await waitFor(`/read at the workshop/.test(document.querySelector('.rf-note').innerText)
    && [...document.querySelectorAll('.rf-tile')].some((b) => b.classList.contains('discovered'))`, 'the read sectors', 20000);
  const tiles = await ev(`Object.fromEntries([...document.querySelectorAll('.rf-tile')].map((b) => [b.querySelector('.rf-letter').innerText, b.querySelector('.st').innerText]))`);
  check(tiles.O === 'explored' && tiles.J === 'explore next' && /^opens from O$|needs rank/.test(tiles.Z), `the tiles say what the FC has done (${JSON.stringify(tiles)})`);
  const strip = await ev(`document.querySelector('.rf-strip') ? document.querySelector('.rf-strip').innerText.replace(/\\s+/g, ' ') : ''`);
  check(/J can be explored next/.test(strip) && !/opens from/.test(strip), `the strip says only what's sure next; the tiles say what opens from where (${strip})`);
  await waitFor(`${rowsSel}.length > 0 && [...${rowsSel}].some((tr) => /explores J/.test(tr.innerText))`, 'a route exploring J', 20000);
  const routeLetters = await ev(`[...${rowsSel}].map((tr) => [...tr.querySelectorAll('.rf-route .rf-letter')].map((l) => l.innerText).join(''))`);
  check(routeLetters.every((r) => !r.includes('Z')), `only through sectors the FC has discovered (${routeLetters.join(', ')})`);
  const chanceTip = await ev(`(() => { const tag = [...document.querySelectorAll('.rf .finder-table .rf-tag.chance')].find((x) => /1 chance at new sectors/.test(x.innerText)); return tag ? tag.title : ''; })()`);
  check(/^Z opens from O: each voyage there is about a 20–30% chance/.test(chanceTip), `a route through O has a chance at Z, and says so on hover (${chanceTip})`);
  await t.shot('route-finder-fc');

  // The Unlocks tab.
  await ev(`[...document.querySelectorAll('.rf-tabs button')].find((b) => b.innerText === 'Unlocks').click()`);
  await waitFor(`document.querySelectorAll('.rf-card').length === 3`, 'the Unlocks tab', 15000);
  await t.shot('route-finder-unlocks');
  const cards = await ev(`[...document.querySelectorAll('.rf-card')].map((c) => c.innerText.replace(/\\s+/g, ' '))`);
  check(/SURE NEXT 1 sector/i.test(cards[0]) && /Deep-sea Site 1/.test(cards[0]), `Sure next: J (${cards[0].slice(0, 90)})`);
  check(/COULD OPEN 1 sector/i.test(cards[1]) && /opens from O/.test(cards[1]), `Could open: Z, from O (${cards[1].slice(0, 90)})`);
  const map = await ev(`document.querySelector('.rf-map').innerText.replace(/\\s+/g, ' ')`);
  check(/Deep-sea Site/.test(map) && /1 of 3 explored · 1 to explore/.test(map), `each map's progress (${map.slice(0, 80)})`);
  // Find a route through J: back on Best routes, J a must.
  await ev(`[...document.querySelectorAll('.rf-card.sure button')].find((b) => b.innerText === 'Find a route').click()`);
  await waitFor(`document.querySelector('.rf-tabs button.on').innerText === 'Best routes'
    && [...document.querySelectorAll('.rf-tile.must')].some((b) => b.querySelector('.rf-letter').innerText === 'J')`, 'J a must', 15000);
  check(true, 'Find a route opens Best routes with that sector a must');

  // Open in Planner.
  await waitFor(`${rowsSel}.length > 0`, 'routes', 20000);
  const stops = await ev(`${rowsSel}[0].querySelectorAll('.rf-route .rf-letter').length`);
  await ev(`[...document.querySelectorAll('.rf .finder-table tbody button')].find((b) => b.innerText === 'Open in Planner').click()`);
  await waitFor(`document.querySelectorAll('.planner-chip').length === ${stops} && document.querySelectorAll('.planner-stat').length === 5`, 'the Planner with that route', 15000);
  check(true, `Open in Planner loads the build and its ${stops} stop(s)`);

  // Fight Club players: a rank 90 sub's FC with O and J discovered but not Z. Its Fight Club target (O-J-Z, the most gil)
  // needs Z: marked on Route Optimization and Subs, with the best route it can run now (O-J).
  const sub = (await t.query(`SELECT c.fc_id::text AS fc, s.sub_name FROM companion_submarine_snapshot s JOIN companion_character_current c ON c.cid = s.cid
    WHERE s.level >= 85 ORDER BY s.level DESC, s.cid LIMIT 1`))[0];
  await t.query(`DELETE FROM companion_fc_sub_sector`);
  await t.query(`INSERT INTO companion_fc_sub_sector (fc_id, sector_id, unlocked, explored, read_at, cid) VALUES
    (${sub.fc}, 1, true, true, now(), 1), (${sub.fc}, 2, true, true, now(), 1), (${sub.fc}, 3, false, false, now(), 1)`);
  await nav('Route Optimization');
  await waitFor(`[...document.querySelectorAll('.fc-blocked-tag')].length > 0`, 'a marked Fight Club route', 20000);
  const mark = await ev(`(() => { const tag = document.querySelector('.fc-blocked-tag'); return { text: tag.innerText, title: tag.title,
    alt: tag.nextElementSibling && tag.nextElementSibling.classList.contains('fc-blocked-alt') ? tag.nextElementSibling.innerText : '' }; })()`);
  check(mark.text === 'needs Z' && /Z isn't discovered yet \(it opens from O, by chance\)/.test(mark.title) && /^now: O-J · [\d.]+[kM]?\/day$/.test(mark.alt),
    `Route Optimization marks a Fight Club route the FC can't run yet, with the best it can (${JSON.stringify(mark)})`);
  await t.shot('route-optimization-blocked');
  await nav('Subs');
  await waitFor(`[...document.querySelectorAll('.fc-blocked-tag')].length > 0`, 'the mark on Subs', 20000);
  check(true, 'and on the Subs page');
  await t.query(`DELETE FROM companion_fc_sub_sector`);
};
