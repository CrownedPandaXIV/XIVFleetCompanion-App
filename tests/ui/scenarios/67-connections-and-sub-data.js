// Settings → Database → Connections in Use: how many of the database's slots are taken, whose, and from which PC.
// Settings → Data → Sub Calculator Data: which copy is in use, and Check now.
module.exports = async (t) => {
  const { ev, waitFor, check } = t;
  const box = `document.querySelector('.connections-section')`;
  const tab = async (name) => ev(`[...document.querySelectorAll('.settings-tab')].find((b) => b.innerText === '${name}').click()`);

  await waitFor(`document.querySelectorAll('.sidebar-button').length>0`, 'the app to load', 60000);
  await ev(`document.querySelector('.gear-button').click()`);
  await waitFor(`!!document.querySelector('.settings-tab')`, 'Settings');
  await tab('Database');
  await waitFor(`!!${box} && !!${box}.querySelector('.connections-total')`, 'the connection count', 20000);
  const total = await ev(`${box}.querySelector('.connections-total').innerText`);
  check(/^\d+ of \d+ in use \(\d+ app/.test(total), `the count and the limit: ${total}`);
  const rows = await ev(`[...${box}.querySelectorAll('.connections-pcs tbody tr')].map((tr) => [...tr.cells].map((c) => c.innerText))`);
  check(rows.length >= 1 && /^This PC/.test(rows[0][0]) && rows.every((r) => r.slice(1).every((n) => /^\d+$/.test(n))), `by PC, this PC first: ${JSON.stringify(rows)}`);
  const sum = rows.reduce((n, r) => n + Number(r[4]), 0);
  check(sum === Number(total.split(' ')[0]), `the PCs add up to the count (${sum})`);
  await ev(`${box}.querySelector('.connections-refresh').click()`);
  await waitFor(`${box}.querySelector('.connections-refresh').innerText === 'Check again'`, 'the count again', 20000);
  check(!(await ev(`!!${box}.querySelector('.setup-problem')`)), 'no error');

  const data = `document.querySelector('.sub-data-section')`;
  await tab('Data');
  await waitFor(`!!${data} && !!${data}.querySelector('.sub-data-made')`, 'the Sub Calculator data line', 15000);
  const made = await ev(`${data}.querySelector('.sub-data-made').innerText`);
  check(/^From .+ \((shipped with this version|downloaded)\)\./.test(made), `which copy is in use: ${made}`);
  check(await ev(`!!${data}.querySelector('.sub-data-check')`), 'Check now is there');
};
