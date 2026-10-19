// Trend charts and the extra table columns: what can be charted or added, and their values.
const { ipcMain } = require('electron');
const { createPgClient, loadPostgresConfig, withClient, snapshotFragments } = require('../db');
const metricSeries = require('../db/metric-series');
const columnCatalog = require('../shared/column-catalog');
const { SALVAGE_PRICES } = require('./inventory');

// ---- Trend charts (see metric-series.js) ----

// What can be charted, with how many subjects have each metric and when it was first/last recorded.
ipcMain.handle('get-metric-catalog', async () => {
  return withClient(async (client) => {
    const result = await client.query(metricSeries.CATALOG_SQL);
    return {
      success: true,
      salvagePrices: SALVAGE_PRICES,
      rows: result.rows.map((r) => ({
        metric: r.metric,
        subjectType: r.subject_type,
        subjects: r.subjects,
        firstRecorded: r.first_recorded,
        lastRecorded: r.last_recorded,
      })),
    };
  }, (err) => {
    return { success: false, error: err.message };
  });
});

// ---- Extra table columns (see column-catalog.js) ----
// The master list of columns a table can offer, and the values of the ones a table has actually added.
ipcMain.handle('get-column-catalog', () => ({ success: true, catalog: columnCatalog.catalogForInterface() }));

ipcMain.handle('get-column-extras', async (event, request) => {
  const checked = columnCatalog.validateExtrasRequest(request);
  if (!checked.ok) return { success: false, error: checked.error };
  if (checked.ids.length === 0) return { success: true, values: {} };
  return withClient(async (client) => {
    const { latestCharacter } = await snapshotFragments(client);
    const { sql, params } = columnCatalog.buildExtrasQuery(checked, latestCharacter);
    const result = await client.query(sql, params);
    return columnCatalog.shapeExtrasResult(result.rows, checked);
  }, (err) => ({ success: false, error: err.message }));
});

// The characters and Free Companies a chart can be scoped to, with display names.
ipcMain.handle('get-metric-subjects', async () => {
  return withClient(async (client) => {
    const { latestCharacter } = await snapshotFragments(client);

    const characters = await client.query(`
      SELECT c.cid, c.name, c.world, c.account_label, so.sort_index
      FROM ${latestCharacter} c
      LEFT JOIN character_sort_order so ON so.cid = c.cid
      ORDER BY so.sort_index NULLS LAST, c.name
    `);
    const fcs = await client.query(`
      SELECT DISTINCT ON (h.fc_id) h.fc_id, h.fc_name, h.fc_master
      FROM companion_character_housing h
      WHERE h.fc_id IS NOT NULL
      ORDER BY h.fc_id, h.updated_at DESC
    `);
    return {
      success: true,
      characters: characters.rows.map((r) => ({
        id: String(r.cid),
        name: r.name,
        world: r.world,
        accountLabel: r.account_label,
        sortIndex: r.sort_index,
      })),
      fcs: fcs.rows.map((r) => ({ id: String(r.fc_id), name: r.fc_name, leader: r.fc_master })),
    };
  }, (err) => {
    return { success: false, error: err.message };
  });
});

// One chart's data: values at evenly spaced instants over a time range, carried forward from the
// last recorded change. See validateSeriesRequest for the request shape. Heavy requests run as
// parallel slices (metricSeries.runSeries), and a result is remembered for a minute, so opening
// the same chart again does not redo the work. The range is rounded to whole minutes (for spans of
// half an hour or more; the end rounded up, so a value recorded this minute is included) so repeated
// requests share one entry, and a remembered result is used only while nothing newer has been
// recorded, so a refresh right after a sync shows it.
const SERIES_CACHE_MS = 60 * 1000;
const SERIES_CACHE_MAX = 100;
const seriesCache = new Map();

// When the newest value was recorded (any metric): a remembered result older than that is not used.
async function newestRecorded(config) {
  const client = createPgClient(config);
  try {
    await client.connect();
    const { rows } = await client.query('SELECT max(recorded_at) AS at FROM companion_metric_latest');
    return rows[0].at ? new Date(rows[0].at).getTime() : 0;
  } catch {
    return null;
  } finally {
    await client.end().catch(() => {});
  }
}

ipcMain.handle('get-metric-series', async (event, request) => {
  const checked = metricSeries.validateSeriesRequest(request);
  if (!checked.ok) return { success: false, error: checked.error };
  const params = checked.params;

  if (params.to - params.from >= 30 * 60 * 1000) {
    params.from = new Date(Math.floor(params.from.getTime() / 60000) * 60000);
    params.to = new Date(Math.ceil(params.to.getTime() / 60000) * 60000);
  }

  const config = loadPostgresConfig();
  const key = JSON.stringify([params.from, params.to, params.points, params.metrics, params.subjectTypes, params.weights, params.subjectIds]);
  const newest = await newestRecorded(config);
  const hit = seriesCache.get(key);
  if (hit && newest !== null && Date.now() - hit.at < SERIES_CACHE_MS && newest <= hit.newest) return hit.value;

  try {
    const value = await metricSeries.runSeries(async () => {
      const client = createPgClient(config);
      await client.connect();
      return client;
    }, params);
    if (newest !== null) seriesCache.set(key, { at: Date.now(), newest, value });
    if (seriesCache.size > SERIES_CACHE_MAX) seriesCache.delete(seriesCache.keys().next().value);
    return value;
  } catch (err) {
    return { success: false, error: err.message };
  }
});
