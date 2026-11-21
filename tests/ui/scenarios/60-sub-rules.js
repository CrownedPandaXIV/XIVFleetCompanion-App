// Sub Rules on the Parts page: Delete asks first (Delete it / Keep), and saving one new rule keeps the other new rows
// that aren't saved yet, with what was typed in them.
module.exports = async (t) => {
  const { ev, waitFor, check, nav, sleep } = t;
  const rows = `[...document.querySelectorAll('.sub-rules tbody tr')]`;
  const ranks = () => ev(`${rows}.map((r) => r.querySelector('input[type=number]').value)`);
  const typeRank = (i, value) => ev(`(() => { const box = ${rows}[${i}].querySelector('input[type=number]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(box, ${JSON.stringify(value)});
    box.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  const press = (i, text) => ev(`(() => { const b = [...${rows}[${i}].querySelectorAll('button')].find((x) => x.innerText.trim() === ${JSON.stringify(text)});
    if (!b) throw new Error('no ' + ${JSON.stringify(text)}); b.click(); return true; })()`);
  const buttons = (i) => ev(`[...${rows}[${i}].querySelectorAll('button')].map((b) => b.innerText.trim())`);

  await ev(`localStorage.setItem('partsRulesPanelVisible', 'true')`);
  await nav('Summary');
  await nav('Parts');
  await waitFor(`document.querySelectorAll('.sub-rules tbody tr').length > 0`, 'the Sub Rules', 20000);
  const saved = (await ranks()).length;

  await ev(`[...document.querySelectorAll('.sub-rules button')].find((b) => b.innerText === 'Add Rule').click()`);
  await ev(`[...document.querySelectorAll('.sub-rules button')].find((b) => b.innerText === 'Add Rule').click()`);
  await waitFor(`document.querySelectorAll('.sub-rules tbody tr').length === ${saved + 2}`, 'two new rows');
  await typeRank(saved, '57');
  await typeRank(saved + 1, '63');
  await press(saved, 'Save');
  // Saved, it moves among the saved rules (by rank), and says so above the table.
  await waitFor(`${rows}.findIndex((r) => r.querySelector('input[type=number]').value === '57') < ${saved}`, 'the first new rule saved', 15000);
  check(await ev(`document.querySelector('.sub-rules .controls').innerText.includes('Rank 57 rule saved.')`), 'it says the rule was saved');
  const after = await ranks();
  check(after.includes('57') && after[after.length - 1] === '63', `the other new row keeps what was typed (${after.join(', ')})`);

  // Delete asks first; Keep leaves it.
  const at57 = after.indexOf('57');
  await press(at57, 'Delete');
  const asked = await buttons(at57);
  check(asked.includes('Delete it') && asked.includes('Keep') && (await ranks()).length === saved + 2, 'Delete asks first');
  await press(at57, 'Keep');
  check((await buttons(at57)).includes('Delete') && (await ranks()).length === saved + 2, 'Keep leaves the rule');

  // Tidy up: the saved one deleted, the unsaved one taken off.
  await press(at57, 'Delete');
  await press(at57, 'Delete it');
  await waitFor(`${rows}.length === ${saved + 1}`, 'the rule deleted', 15000);
  const last = saved;
  await press(last, 'Delete');
  await press(last, 'Delete it');
  await sleep(300);
  check((await ranks()).length === saved && !(await ranks()).includes('57'), 'deleted, and the unsaved row taken off');
};
