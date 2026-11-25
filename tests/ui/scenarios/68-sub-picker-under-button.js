// The "Choose one of your subs…" list opens right under its button on every page that has it, also once a sub's results
// fill the page (before 1.13.3 it opened at the bottom of the Levelling Plan and Route Finder).
module.exports = async (t) => {
  const { ev, waitFor, check, nav } = t;
  const button = `document.querySelector('.planner-picker-button')`;
  const where = () => ev(`(() => { const p = document.querySelector('.planner-picker-panel').getBoundingClientRect(); const b = ${button}.getBoundingClientRect();
    return { gap: Math.round(p.top - b.bottom), left: Math.round(p.left - b.left), right: Math.round(window.innerWidth - p.right) }; })()`);
  const open = async () => {
    await ev(`${button}.click()`);
    await waitFor(`!!document.querySelector('.planner-picker-panel')`, 'the list', 5000);
  };
  const close = () => ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);

  await waitFor(`document.querySelectorAll('.sidebar-button').length>0`, 'the app to load', 60000);
  for (const page of ['Voyage Planner', 'Route Finder', 'Levelling Plan', 'Compare Builds', 'Build Finder']) {
    await nav(page);
    await waitFor(`!!${button}`, page, 20000);
    // A sub chosen first where the page has one (its results fill the page below), then the list opened again.
    if (page !== 'Compare Builds' && page !== 'Build Finder') {
      await open();
      await ev(`document.querySelectorAll('.planner-picker-sub')[0].click()`);
      await waitFor(`!document.querySelector('.planner-picker-panel')`, 'the list to close', 5000);
      await new Promise((r) => setTimeout(r, 1500));
    }
    await ev(`${button}.scrollIntoView({ block: 'center' })`);
    await open();
    const w = await where();
    check(w.gap >= 0 && w.gap <= 8 && w.left === 0 && w.right >= 0, `${page}: the list opens right under its button and stays in the window: ${JSON.stringify(w)}`);
    await close();
  }
};
