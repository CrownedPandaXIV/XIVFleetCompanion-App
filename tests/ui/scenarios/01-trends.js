module.exports = async (t) => {
  const { call, ev, sleep, waitFor, shot, check, clickText, nav, setSelect, chartReady } = t;
  await waitFor(`document.querySelectorAll('.sidebar-button').length>0`, 'sidebar');
  check((await ev(`[...document.querySelectorAll('.sidebar-button')].map(b=>b.innerText.trim()).includes('Trends')`)), 'Trends appears in the sidebar');
  await clickText('.sidebar-button', 'Trends');
  await chartReady(); await sleep(400);
  check(await ev(`document.querySelector('h1').innerText`) === 'Trends', 'Trends tab opens');
  check((await ev(`document.querySelector('.trend-summary-value').innerText`)).length > 0, 'summary shows a current value: ' + await ev(`document.querySelector('.trend-summary-value').innerText`));
  await shot('01-default-gil-fleet-30d');

  // hover tooltip
  const box = await ev(`(() => { const r=document.querySelector('.u-over').getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height}; })()`);
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x + box.w * 0.6, y: box.y + box.h * 0.5 }); await sleep(300);
  const tip = await ev(`(() => { const t=document.querySelector('.trend-tip'); return t.style.display!=='none' ? t.innerText : null; })()`);
  check(tip && /Whole fleet/.test(tip), 'hover tooltip shows the value: ' + JSON.stringify(tip));
  await shot('02-tooltip');

  // other values
  await setSelect('Value', 'salvage_value'); await sleep(300); await chartReady(); await sleep(300);
  check((await ev(`document.querySelector('.trend-summary-value').innerText`)).length > 0, 'salvage value (whole fleet) renders');
  await shot('03-salvage-value-fleet');
  await setSelect('Value', 'fc_points'); await sleep(300); await chartReady();
  await clickText('.trend-segmented button', '1 year'); await sleep(300); await chartReady();
  await shot('04-fc-points-1y');

  const valueOptions = await ev(`[...document.querySelectorAll('.trend-field select')[0].options].map(o=>o.textContent)`);
  check(['Retainers', 'Submarines', 'Sub slots'].every((o) => valueOptions.includes(o)), 'retainers, submarines and sub slots can be charted: ' + valueOptions.join(', '));

  // compare characters
  await setSelect('Value', 'gil'); await sleep(200);
  await setSelect('Show', 'characters'); await sleep(500); await chartReady();
  check(await ev(`document.querySelectorAll('.trend-chip').length`) === 1, 'compare mode starts with one character chosen');
  for (let i = 0; i < 3; i++) {
    await ev(`(() => { const inp=document.querySelector('input[placeholder^="Add a"]'); inp.dispatchEvent(new FocusEvent('focusin',{bubbles:true})); })()`);
    await sleep(150);
    await ev(`(() => { const it=document.querySelector('.trend-menu-item'); it.dispatchEvent(new MouseEvent('mousedown',{bubbles:true})); })()`);
    await sleep(300);
  }
  await chartReady(); await sleep(300);
  check(await ev(`document.querySelectorAll('.trend-chip').length`) === 4, 'four characters chosen');
  check(await ev(`document.querySelectorAll('.trend-chip strong').length`) === 4, 'each chosen character shows its current value (the chips are the legend)');
  await shot('05-compare-4-characters');
  // remove the second, add another: colors keep their slots
  const before = await ev(`[...document.querySelectorAll('.trend-chip .trend-key')].map(k=>k.style.background)`);
  await ev(`document.querySelectorAll('.trend-chip button')[1].click()`); await sleep(300);
  const after = await ev(`[...document.querySelectorAll('.trend-chip .trend-key')].map(k=>k.style.background)`);
  check(after.length === 3 && after[0] === before[0] && after[1] === before[2] && after[2] === before[3], 'remaining characters keep their colors when one is removed');

  // table view
  await clickText('.trend-segmented button', 'Table'); await sleep(400);
  check(await ev(`document.querySelectorAll('table tbody tr').length`) > 100, 'table view lists the data points: ' + await ev(`document.querySelectorAll('table tbody tr').length`) + ' rows');
  await shot('06-table-view');
  await clickText('.trend-segmented button', 'Chart'); await sleep(400); await chartReady();

  // drag-zoom (on 30 days: the CI dataset only holds 30 days, so a wider span is mostly empty)
  await clickText('.trend-segmented button', '30 days'); await sleep(300); await chartReady();
  const b2 = await ev(`(() => { const r=document.querySelector('.u-over').getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height}; })()`);
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: b2.x + b2.w * 0.3, y: b2.y + b2.h * 0.5, button: 'left', clickCount: 1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: b2.x + b2.w * 0.5, y: b2.y + b2.h * 0.5, button: 'left' });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b2.x + b2.w * 0.6, y: b2.y + b2.h * 0.5, button: 'left', clickCount: 1 });
  await sleep(500); await chartReady();
  check(await ev(`!![...document.querySelectorAll('button')].find(b=>b.innerText.trim()==='Reset zoom')`), 'dragging across the chart zooms (Reset zoom appears)');
  await shot('07-zoomed');
  await clickText('button', 'Reset zoom'); await sleep(400); await chartReady();
  check(await ev(`![...document.querySelectorAll('button')].find(b=>b.innerText.trim()==='Reset zoom')`), 'Reset zoom returns to the preset span');

  // Free Companies (FC points applies to them; Gil does not, so the option is hidden for Gil)
  check(await ev(`![...document.querySelectorAll('.trend-field select')[1].options].some(o=>o.value==='fcs')`), 'Free Companies option is hidden for Gil (does not apply)');
  await setSelect('Value', 'fc_points'); await sleep(300); await chartReady();
  await setSelect('Show', 'fcs'); await sleep(500); await chartReady();
  check(await ev(`document.querySelectorAll('.trend-chip').length`) === 1, 'Free Company compare starts with one chosen');
  await shot('08-fc-compare');
  // nothing selected
  await ev(`document.querySelector('.trend-chip button').click()`); await sleep(400);
  check(await ev(`document.body.innerText.includes('Pick at least one')`), 'empty selection shows a prompt, not an error');

  // whole fleet, all time
  await setSelect('Show', 'fleet'); await sleep(300); await clickText('.trend-segmented button', 'All time'); await sleep(300); await chartReady();
  await shot('09-fleet-all-time');

};
