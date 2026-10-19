// Parts → Shopping List: a refresh keeps the last list on screen while the new one is worked out ("Updating..."),
// so the page stays where it was scrolled to instead of jumping back to the top.
module.exports = async (t) => {
  const { ev, waitFor, check, nav, clickText, sleep } = t;
  await ev(`window.localStorage.clear()`);
  await nav('Parts');
  await waitFor(`[...document.querySelectorAll('.controls button')].some(b => b.innerText.trim() === 'Shopping List')`, 'the Parts tab', 20000);
  await clickText('.controls button', 'Shopping List');
  await waitFor(`!!document.querySelector('.shopping-gather')`, 'the shopping list', 30000);

  const pane = `document.querySelector('.main-pane')`;
  await ev(`${pane}.scrollTop = ${pane}.scrollHeight`);
  await sleep(300);
  const before = await ev(`${pane}.scrollTop`);
  check(before > 100, `scrolled down: ${before}`);

  // Watch for the list being cleared ("Working out the shopping list...") or the page jumping.
  await ev(`(() => {
    window.__blanked = false; window.__updatingSeen = false;
    window.__watch = new MutationObserver(() => {
      if ([...document.querySelectorAll('.status')].some(e => e.innerText.includes('Working out the shopping list'))) window.__blanked = true;
      if (document.querySelector('.shopping-updating')) window.__updatingSeen = true;
    });
    window.__watch.observe(document.body, { childList: true, subtree: true, characterData: true });
  })()`);
  await clickText('button', 'Refresh');
  await waitFor(`window.__updatingSeen`, '"Updating..." while the new list is worked out', 20000);
  await waitFor(`!document.querySelector('.shopping-updating')`, 'the new list', 30000);
  await ev(`window.__watch.disconnect()`);
  const after = await ev(`${pane}.scrollTop`);
  check(!(await ev(`window.__blanked`)), 'the list was never cleared');
  check(Math.abs(after - before) < 5, `the page stayed where it was: ${before} -> ${after}`);
};
