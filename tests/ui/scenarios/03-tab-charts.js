module.exports = async (t) => {
  const { call, ev, sleep, waitFor, shot, check, nav } = t;
  const cardsReady = (n) => waitFor(`document.querySelectorAll('.trend-card canvas').length>=${n} && [...document.querySelectorAll('.trend-chart-wrap')].every(w=>w.style.opacity==='1')`, `${n} chart cards`);
  await ev(`window.localStorage.clear()`); await call('Page.reload');
  await waitFor(`document.querySelectorAll('.sidebar-button').length>0`, 'app');

  // ---- Roster: chart on top, icon per name, existing behavior intact
  await nav('Character Roster');
  await waitFor(`document.querySelectorAll('tbody tr[data-cid]').length>0`, 'roster rows'); await cardsReady(1);
  const rosterRows = await ev(`document.querySelectorAll('tbody tr[data-cid]').length`);
  check(rosterRows === 80, `roster still lists all its rows (${rosterRows}) with drag handles: ${await ev(`document.querySelectorAll('tbody tr[data-cid] .drag-handle').length`)}`);
  check(await ev(`document.querySelector('.trend-card-title').innerText`) === 'Gil, whole fleet', 'a "Gil, whole fleet" chart sits above the roster');
  check(await ev(`document.querySelectorAll('tbody tr[data-cid] .trend-link').length`) === 80, 'every roster row has a chart icon beside the name');
  await shot('13-roster-with-chart');

  // ---- collapse remembered across a reload
  await ev(`[...document.querySelectorAll('.trend-card-actions button')].find(b=>b.innerText==='Hide').click()`); await sleep(300);
  check(await ev(`document.querySelectorAll('.trend-card canvas').length`) === 0, 'Hide collapses the chart');
  await call('Page.reload'); await waitFor(`document.querySelectorAll('.sidebar-button').length>0`, 'app'); await nav('Character Roster');
  await waitFor(`document.querySelectorAll('tbody tr[data-cid]').length>0`, 'roster rows'); await sleep(500);
  check(await ev(`document.querySelectorAll('.trend-card canvas').length`) === 0 && await ev(`!![...document.querySelectorAll('.trend-card-actions button')].find(b=>b.innerText==='Show chart')`), 'the chart stays hidden after reload (choice remembered)');
  await ev(`[...document.querySelectorAll('.trend-card-actions button')].find(b=>b.innerText==='Show chart').click()`); await cardsReady(1);
  check(true, 'Show chart brings it back');

  // ---- character detail panel
  const first = await ev(`document.querySelector('tbody tr[data-cid]').children[1].innerText.trim()`);
  await ev(`document.querySelector('tbody tr[data-cid] .trend-link').click()`);
  await waitFor(`!!document.querySelector('.trend-detail')`, 'detail panel'); await cardsReady(6);
  const head = await ev(`document.querySelector('.trend-detail h2').innerText`);
  check(head === first, `the panel is titled with the character: "${head}"`);
  check(await ev(`document.querySelectorAll('.trend-detail .trend-card').length`) === 5, 'the character panel has five charts');
  check((await ev(`[...document.querySelectorAll('.trend-detail .trend-card-value strong')].map(x=>x.innerText)`)).every((v) => /\d/.test(v)), 'every chart shows a current value');
  await shot('14-character-detail');
  await ev(`[...document.querySelectorAll('.trend-detail .trend-segmented button')].find(b=>b.innerText==='1 year').click()`); await sleep(500); await cardsReady(6);
  check(await ev(`document.querySelector('.trend-detail .trend-segmented button.active').innerText`) === '1 year', 'the span buttons change all charts (1 year)');
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(300);
  check(await ev(`!document.querySelector('.trend-detail')`), 'Escape closes the panel');

  // ---- panel -> Open in Trends
  await ev(`document.querySelector('tbody tr[data-cid] .trend-link').click()`); await waitFor(`!!document.querySelector('.trend-detail')`, 'panel'); await cardsReady(6);
  await ev(`[...document.querySelectorAll('.trend-detail .trend-card-actions button')].find(b=>b.innerText==='Open in Trends').click()`);
  await waitFor(`document.querySelector('h1')?.innerText==='Trends' && !!document.querySelector('.trend-chart-wrap canvas')`, 'trends tab');
  const st = await ev(`JSON.stringify({metric:document.querySelector('.trend-field select').value, scope:document.querySelectorAll('.trend-field select')[1].value, chip:document.querySelector('.trend-chip span:not(.trend-key)')?.innerText, range:document.querySelector('.trend-segmented button.active').innerText})`);
  const sj = JSON.parse(st);
  check(sj.metric === 'gil' && sj.scope === 'characters' && sj.chip && sj.chip.startsWith(first), 'Open in Trends shows that character gil in the Trends tab: ' + st);
  await shot('15-opened-in-trends');

  // ---- Salvage tab
  await nav('Salvage'); await waitFor(`document.querySelectorAll('tbody tr').length>0`, 'salvage rows'); await cardsReady(1);
  check(await ev(`document.querySelector('.trend-card-title').innerText`) === 'Salvage value, whole fleet (gil)', 'the Salvage tab has its salvage-value chart');
  check(await ev(`document.querySelectorAll('tbody .trend-link').length`) > 0, 'Salvage rows have the chart icon');
  await ev(`document.querySelector('tbody .trend-link').click()`); await waitFor(`!!document.querySelector('.trend-detail')`, 'panel'); await cardsReady(2);
  await shot('16-salvage-tab-panel');
  await ev(`[...document.querySelectorAll('.trend-detail button')].find(b=>b.innerText==='Close').click()`); await sleep(300);

  // ---- Free Companies tab
  await nav('Free Companies'); await waitFor(`document.querySelectorAll('tbody tr').length>0`, 'fc rows'); await cardsReady(1);
  check(await ev(`document.querySelector('.trend-card-title').innerText`) === 'FC points, all Free Companies (total)', 'the Free Companies tab has its FC-points chart');
  await ev(`document.querySelector('tbody .trend-link').click()`); await waitFor(`!!document.querySelector('.trend-detail')`, 'fc panel'); await cardsReady(3);
  check(await ev(`document.querySelectorAll('.trend-detail .trend-card').length`) === 3, 'the Free Company panel has three charts');
  await shot('17-fc-tab-panel');
  // clicking outside closes it
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: 5, y: 5, button: 'left', clickCount: 1 }); await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 5, y: 5, button: 'left', clickCount: 1 }); await sleep(300);
  check(await ev(`!document.querySelector('.trend-detail')`), 'clicking outside the panel closes it');

};
