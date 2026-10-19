// A chart shows a value recorded just now on the first refresh after it: the chart's data is not kept
// from before it was recorded, and the range ends at the minute it was asked for, not the minute before.
const GIL_ADDED = 1000000;

module.exports = async (t) => {
  const { ev, sleep, waitFor, check, nav, clickText } = t;
  await waitFor(`document.querySelectorAll('.sidebar-button').length>0`, 'the app to load', 60000);
  await nav('Character Roster');
  await waitFor(`!!document.querySelector('.trend-card canvas')`, 'the gil chart', 30000);
  await sleep(500);
  const shown = async () => Number((await ev(`document.querySelector('.trend-card .trend-card-value strong').innerText`)).replace(/[^0-9.-]/g, ''));
  const before = await shown();

  // The plugin records a new value for one character, then the app refreshes once.
  const [row] = await t.query(`SELECT subject_id::text AS id, value FROM companion_metric_latest
    WHERE subject_type = 'character' AND metric = 'gil' ORDER BY subject_id LIMIT 1`);
  t.restore = { id: row.id, value: row.value };
  await t.query(`INSERT INTO companion_metric_history (recorded_at, subject_type, subject_id, metric, value)
    VALUES (now(), 'character', ${row.id}, 'gil', ${Number(row.value) + GIL_ADDED})`);
  await t.query(`UPDATE companion_metric_latest SET value = ${Number(row.value) + GIL_ADDED}, recorded_at = now()
    WHERE subject_type = 'character' AND subject_id = ${row.id} AND metric = 'gil'`);
  await clickText('button', 'Refresh');
  await waitFor(`!document.querySelector('.trend-card .trend-chart-wrap') || document.querySelector('.trend-card .trend-chart-wrap').style.opacity === '1'`, 'the refresh', 20000);
  await sleep(1500);
  const after = await shown();
  check(after - before === GIL_ADDED, `the chart shows the new value after one refresh: ${before} -> ${after}`);

  await t.query(`DELETE FROM companion_metric_history WHERE subject_type = 'character' AND subject_id = ${row.id} AND metric = 'gil'
    AND recorded_at > now() - interval '10 minutes' AND value = ${Number(row.value) + GIL_ADDED}`);
  await t.query(`UPDATE companion_metric_latest SET value = ${row.value} WHERE subject_type = 'character' AND subject_id = ${row.id} AND metric = 'gil'`);
};
