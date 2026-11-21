// The window only ever shows the app's own page: something trying to open another page in it (a dropped file, a link)
// is refused, and the app's page reloading itself still works.
module.exports = async (t) => {
  const { ev, sleep, waitFor, check } = t;
  const before = await ev('location.href');
  await ev(`location.href = 'file:///etc/hostname'`);
  await sleep(1500);
  check(await ev('location.href') === before && await ev(`document.querySelectorAll('.sidebar-button').length > 0`), 'another page is not opened in the window');
  await ev('location.reload()');
  await waitFor(`document.querySelectorAll('.sidebar-button').length>0`, 'the app to load again', 60000);
  check(true, 'the app reloading itself still works');
};
