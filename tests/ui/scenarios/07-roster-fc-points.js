// The Character Roster has an FC Points column that shows the Free Company's points and sorts.
module.exports = async (t) => {
  const { ev, sleep, waitFor, shot, check, nav } = t;
  await nav('Character Roster');
  await waitFor(`document.querySelectorAll('tbody tr[data-cid]').length>0`, 'roster rows');
  const headers = await ev(`[...document.querySelector('thead').querySelectorAll('th')].map(th=>th.innerText.trim().toLowerCase())`);
  const col = headers.indexOf('fc points');
  check(col > 0 && headers[col - 1] === 'fc', 'the roster has an FC Points column next to FC: ' + JSON.stringify(headers));
  const cells = await ev(`[...document.querySelectorAll('tbody tr[data-cid]')].map(tr=>tr.children[${col}].innerText.trim())`);
  check(cells.length === 80 && cells.every((v) => /^\d{1,3}(,\d{3})+$/.test(v)), 'every row shows its points with thousands separators: ' + cells.slice(0, 3).join(' | '));
  // Sorting turns off the split into one table per account, so the whole roster is sorted together.
  const header = () => ev(`[...document.querySelectorAll('thead th')].find(th=>th.innerText.trim().toLowerCase().startsWith('fc points')).querySelector('span').click()`);
  const tables = async () => (await ev(`[...document.querySelectorAll('tbody')].map(tb=>[...tb.querySelectorAll('tr[data-cid]')].map(tr=>tr.children[${col}].innerText.trim()))`))
    .map((t) => t.map((v) => Number(v.replace(/,/g, ''))));
  const direction = (list) => {
    if (list.every((v, i) => i === 0 || v >= list[i - 1])) return 'asc';
    if (list.every((v, i) => i === 0 || v <= list[i - 1])) return 'desc';
    return 'none';
  };
  await header(); await sleep(300);
  const first = (await tables()).map(direction);
  check(first.length === 1 && first[0] === 'asc' && (await tables())[0].length === 80, 'clicking the header sorts the whole roster by points, low to high: ' + first.join(','));
  await header(); await sleep(300);
  const second = (await tables()).map(direction);
  const top = (await tables())[0];
  check(second.length === 1 && second[0] === 'desc' && top[0] > top[top.length - 1], 'clicking again reverses it, high to low: ' + second.join(','));
  await shot('roster-fc-points');
};
