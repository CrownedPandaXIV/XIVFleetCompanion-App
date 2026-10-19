// Settings → Database → Speed check: it measures the connection and the database, loads every tab's data in
// turn, and shows plain-language findings, each tab's time, and results to copy.
module.exports = async (t) => {
  const { ev, waitFor, check } = t;
  const box = `document.querySelector('.speed-check')`;

  await waitFor(`document.querySelectorAll('.sidebar-button').length>0`, 'the app to load', 60000);
  await ev(`document.querySelector('.gear-button').click()`);
  await waitFor(`!!document.querySelector('.settings-tab')`, 'Settings');
  await ev(`[...document.querySelectorAll('.settings-tab')].find((b) => b.innerText === 'Database').click()`);
  await waitFor(`!!${box}`, 'the Speed Check section', 15000);
  check(!(await ev(`!!${box}.querySelector('.speed-findings')`)), 'nothing runs until asked');

  await ev(`[...${box}.querySelectorAll('button')].find((b) => b.innerText === 'Run speed check').click()`);
  await waitFor(`!!${box}.querySelector('.speed-findings')`, 'the results', 120000);
  const findings = await ev(`[...${box}.querySelectorAll('.speed-findings li')].map((li) => li.innerText)`);
  check(findings.some((f) => /^Connecting to the database takes \d+ ms/.test(f)), `the connection time: ${JSON.stringify(findings)}`);
  check(findings.some((f) => /^Characters are read/.test(f)), 'how characters are read');
  const rows = await ev(`[...${box}.querySelectorAll('.speed-tabs tbody tr')].map((tr) => [...tr.cells].map((c) => c.innerText))`);
  check(rows.length === 13 && rows[0][0] === 'Summary' && rows.every((r) => /^\d+\.\d\d s$/.test(r[1])), `every tab loaded and timed: ${JSON.stringify(rows)}`);
  const parts = await ev(`[...${box}.querySelectorAll('.speed-detail > li')].map((li) => li.innerText)`);
  check(parts.length === 3 && parts.every((p) => /: \d+\.\d\d s, \d+ questions to the database/.test(p)), `each part behind Income and Summary is timed: ${JSON.stringify(parts)}`);
  check(await ev(`!![...${box}.querySelectorAll('button')].find((b) => b.innerText === 'Copy results')`), 'the results can be copied');
  check(!(await ev(`!!${box}.querySelector('.setup-problem')`)), 'no error');
};
