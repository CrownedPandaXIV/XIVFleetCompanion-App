module.exports = async (t) => {
  const { call, ev, sleep, waitFor, shot, check, clickText, nav, setSelect, chartReady } = t;
  const tiles = `[...document.querySelectorAll('.account-group')].filter(x=>[...x.querySelectorAll('button')].some(b=>b.innerText.trim()==='View trend'))`;
  await call('Page.reload'); const t0 = Date.now();
  await waitFor(`${tiles}.length===5 && ${tiles}.every(x=>x.querySelector('button') && !x.querySelector('button').disabled)`, 'five trend tiles');
  const loadMs = Date.now() - t0;
  check(loadMs < 4000, `five trend tiles are ready ${loadMs} ms after page load`);
  const info = await ev(`JSON.stringify(${tiles}.map(x=>({label:x.children[0].innerText, value:x.children[1].innerText, delta:x.children[2].innerText, hasLine:!!x.querySelector('svg path'), dot:!!x.querySelector('span[style*="border-radius"]')})))`);
  const tl = JSON.parse(info); console.log('  tiles:', tl.map((x) => `${x.label}=${x.value} ${x.delta}`).join(' | '));
  check(tl.map((x) => x.label).join(',') === 'Gil,Ceruleum,Repair kits,FC points,Salvage value (gil)', 'tiles are Gil, Ceruleum, Repair kits, FC points, Salvage value');
  check(tl.every((x) => x.hasLine && x.dot && /\d/.test(x.value)), 'every tile has a value, a trend line and an end dot');
  check(tl.every((x) => /^[▲▼▬]/.test(x.delta)), 'every tile shows a direction and change');
  check(await ev(`document.body.innerText.includes('Trends, last 30 days')`), 'section heading is present');
  await shot('10-summary-trend-tiles');

  // click through: Salvage value tile -> Trends tab with that value, whole fleet, 30 days
  await ev(`${tiles}[4].querySelector('button').click()`);
  await waitFor(`!!document.querySelector('.trend-chart-wrap canvas') && document.querySelector('.trend-chart-wrap').style.opacity==='1'`, 'trends chart');
  const sel = await ev(`JSON.stringify({h1:document.querySelector('h1').innerText, value:document.querySelector('.trend-field select').value, scope:document.querySelectorAll('.trend-field select')[1].value, range:document.querySelector('.trend-segmented button.active').innerText})`);
  check(sel === JSON.stringify({ h1: 'Trends', value: 'salvage_value', scope: 'fleet', range: '30 days' }), 'Salvage value tile opens Trends on salvage value, whole fleet, 30 days: ' + sel);
  await shot('11-opened-from-tile');

  // back to Summary, open the FC points tile
  await ev(`[...document.querySelectorAll('.sidebar-button')].find(b=>b.innerText.trim()==='Summary').click()`);
  await waitFor(`${tiles}.length===5 && ${tiles}.every(x=>!x.querySelector('button').disabled)`, 'tiles again');
  await ev(`${tiles}[3].querySelector('button').click()`);
  await waitFor(`!!document.querySelector('.trend-chart-wrap canvas') && document.querySelector('.trend-chart-wrap').style.opacity==='1'`, 'fc points chart');
  check(await ev(`document.querySelector('.trend-field select').value`) === 'fc_points', 'FC points tile opens Trends on FC points');

};
