// Drives the running app through Chrome DevTools Protocol (Electron's remote debugging port).
const fs = require('fs');

async function connect(port, shotDir) {
  let target;
  for (let i = 0; i < 150 && !target; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      target = list.find((x) => x.type === 'page');
    } catch (e) { /* not up yet */ }
    if (!target) await new Promise((r) => setTimeout(r, 200));
  }
  if (!target) throw new Error('the app window did not open');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = {};
  const errors = [];
  ws.onmessage = (e) => {
    const d = JSON.parse(e.data);
    if (d.id && pending[d.id]) pending[d.id](d.result || d.error);
    if (d.method === 'Runtime.exceptionThrown') {
      errors.push('EXC ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text).slice(0, 200));
    }
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') {
      errors.push('ERR ' + d.params.args.map((a) => a.value || a.description).join(' ').slice(0, 200));
    }
  };
  await new Promise((r) => (ws.onopen = r));
  const call = (method, params = {}) => new Promise((r) => { const i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expression) => {
    const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'evaluation failed');
    if (!r.result) throw new Error('the page gave no answer (it was reloading)');
    return r.result.value;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Asks again until true. A page that is reloading can't answer for a moment: that counts as not yet.
  const waitFor = async (expr, label, ms = 30000) => {
    const start = Date.now();
    let last = null;
    while (Date.now() - start < ms) {
      try { if (await ev(expr)) return Date.now() - start; last = null; } catch (e) { last = e; }
      await sleep(150);
    }
    throw new Error('timed out waiting for ' + label + (last ? ` (${last.message})` : ''));
  };
  const shot = async (name) => {
    if (!shotDir) return;
    fs.mkdirSync(shotDir, { recursive: true });
    const r = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${shotDir}/${name}.png`, Buffer.from(r.data, 'base64'));
  };
  let n = 0;
  const failures = [];
  const check = (cond, msg) => {
    console.log(`${cond ? 'PASS' : 'FAIL'} ${++n}. ${msg}`);
    if (!cond) failures.push(msg);
  };
  const clickText = (sel, text) => ev(`(() => { const b=[...document.querySelectorAll(${JSON.stringify(sel)})].find(x=>x.innerText.trim()===${JSON.stringify(text)}); if(!b) throw new Error('no ' + ${JSON.stringify(text)}); b.click(); return true; })()`);
  // Opens a page and waits (up to 15 s) until it has nothing left saying "Loading...", so a check after it doesn't
  // look at a page still loading on a slow machine. A page that stays loading is for the scenario's checks to find.
  const settled = async (ms = 15000) => {
    const start = Date.now();
    await sleep(100);
    while (Date.now() - start < ms && await ev(`[...document.querySelectorAll('.status')].some((e) => /Loading/.test(e.innerText))`)) await sleep(150);
  };
  const nav = async (label) => { await clickText('.sidebar-button', label); await settled(); return true; };
  const setSelect = (label, value) => ev(`(() => { const f=[...document.querySelectorAll('.trend-field')].find(x=>x.innerText.startsWith(${JSON.stringify(label)})); const s=f.querySelector('select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s, ${JSON.stringify(value)}); s.dispatchEvent(new Event('change',{bubbles:true})); return s.value; })()`);
  const chartReady = () => waitFor(`!!document.querySelector('.trend-chart-wrap canvas') && document.querySelector('.trend-chart-wrap').style.opacity==='1'`, 'the chart');

  await call('Runtime.enable');
  await call('Page.enable');
  return { call, ev, sleep, waitFor, settled, shot, check, clickText, nav, setSelect, chartReady, errors, failures, close: () => ws.close() };
}

module.exports = { connect };
