// The Parts tab's Sub Build Rules panel stays within the window: a remembered width wider than the window (or one
// that isn't a number) is brought back, and dragging can't push the parts table off the page.
module.exports = async (t) => {
  const { ev, waitFor, check, nav } = t;
  const panel = `[...document.querySelectorAll('h2')].find((h) => h.innerText === 'Sub Build Rules').parentElement`;
  const widths = () => ev(`({ panel: ${panel}.getBoundingClientRect().width, window: window.innerWidth, table: ${panel}.previousElementSibling.previousElementSibling.getBoundingClientRect().width })`);
  const open = async () => {
    await nav('Summary');
    await nav('Parts');
    await waitFor(`[...document.querySelectorAll('h2')].some((h) => h.innerText === 'Sub Build Rules')`, 'the Sub Build Rules panel', 20000);
  };

  await ev(`localStorage.setItem('partsRulesPanelVisible', 'true'); localStorage.setItem('partsRulesPanelWidth', '5000')`);
  await ev('location.reload()');
  await waitFor(`document.querySelectorAll('.sidebar-button').length>0`, 'the app to load', 30000);
  await open();
  let w = await widths();
  check(w.panel <= w.window - 320 + 1 && w.table >= 300, `a remembered width wider than the window is brought back (panel ${Math.round(w.panel)}px, table ${Math.round(w.table)}px, window ${w.window}px)`);

  await ev(`localStorage.setItem('partsRulesPanelWidth', 'wide')`);
  await ev('location.reload()');
  await waitFor(`document.querySelectorAll('.sidebar-button').length>0`, 'the app to load', 30000);
  await open();
  w = await widths();
  check(w.panel >= 180 && w.panel <= 421, `a remembered width that isn't a number uses the usual one (${Math.round(w.panel)}px)`);

  // Dragging the divider all the way to the left.
  await ev(`(() => {
    const divider = ${panel}.previousElementSibling;
    divider.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 0 }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return true;
  })()`);
  await waitFor(`${panel}.getBoundingClientRect().width > 421`, 'the panel to widen', 5000);
  w = await widths();
  check(w.panel <= w.window - 320 + 1 && w.table >= 300, `dragging can't push the parts table off the page (panel ${Math.round(w.panel)}px, table ${Math.round(w.table)}px)`);
  await ev(`localStorage.removeItem('partsRulesPanelWidth')`);
};
