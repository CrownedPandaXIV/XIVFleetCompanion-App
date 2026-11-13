// No connection saved (a first start where the setup screen was skipped, or a saved connection Windows can't read):
// every page says so instead of staying on "Loading..." for good, and nothing fails unhandled.
const fs = require('fs');
const path = require('path');

module.exports = async (t) => {
  const { ev, waitFor, check } = t;
  const saved = path.join(t.profile, 'pg-credentials.enc');
  const keep = fs.readFileSync(saved);
  fs.unlinkSync(saved);
  try {
    await ev('location.reload()');
    await waitFor(`!!document.querySelector('.setup-wizard')`, 'the setup screen on a first start', 20000);
    await ev(`[...document.querySelectorAll('.setup-wizard button')].find((b) => b.innerText.startsWith('Skip')).click()`);
    await waitFor(`!document.querySelector('.setup-wizard')`, 'the setup screen to close', 10000);
    await ev(`(() => { const b = [...document.querySelectorAll('.modal-actions button')].find((x) => x.innerText === 'Close'); if (b) b.click(); return true; })()`);
    t.errors.length = 0;

    const pages = await ev(`[...document.querySelectorAll('.sidebar-button')].map((b) => b.innerText.trim())`);
    const stuck = [];
    for (const page of pages) {
      await ev(`[...document.querySelectorAll('.sidebar-button')].find((b) => b.innerText.trim() === ${JSON.stringify(page)}).click()`);
      // Give every load time to answer: with no connection saved, each answers at once.
      await new Promise((r) => setTimeout(r, 2500));
      const main = await ev(`(document.querySelector('main') || document.querySelector('.main-content') || document.body).innerText`);
      if (/Loading\.\.\./.test(main)) stuck.push(page);
    }
    await ev(`[...document.querySelectorAll('.sidebar-button')].find((b) => b.innerText.trim() === 'Subs').click()`);
    await waitFor(`/No database connection saved on this PC yet/.test(document.body.innerText)`, 'the Subs page to say why', 10000);
    check(true, 'a page says plainly that no connection is saved, and where to enter one');
    check(pages.length > 5, `went through every page (${pages.join(', ')})`);
    check(stuck.length === 0, `no page stays on "Loading..." with no connection saved${stuck.length ? `: ${stuck.join(', ')}` : ''}`);
    check(t.errors.length === 0, `nothing fails unhandled with no connection saved${t.errors.length ? `: ${t.errors.slice(0, 3).join(' | ')}` : ''}`);
  } finally {
    fs.writeFileSync(saved, keep);
    t.errors.length = 0;
  }
};
