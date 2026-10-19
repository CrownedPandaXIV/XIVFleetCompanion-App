// Income tab: each character's real net income from its subs over the last few days (salvage that came
// in, less the repair kits used) against what Fight Club says their routes should earn (the Subs tab's
// Current Gil/Day). The working out is in income.js.
const { ipcMain } = require('electron');
const { withClient, snapshotFragments } = require('../db');
const { WINDOW_CHOICES } = require('../subs/supply-runway');
const { DEFAULT_WINDOW_DAYS, characterIncome, shareClass, chestDrops } = require('../subs/income');
const { SALVAGE_PRICES } = require('./inventory');
const { loadSubmarines } = require('./subs');
const { metricWindow } = require('../db/metric-window');

const WINDOW_KEY = 'income_window_days';
const DAY = 24 * 60 * 60 * 1000;
const SALVAGE_METRICS = Object.keys(SALVAGE_PRICES).map((id) => `item_qty:${id}`);
// inventory_sources and the kits in bags and retainers come from plugin 0.9.1 (see income.js).
const METRICS = [...SALVAGE_METRICS, 'repair_kits', 'item_qty:10373', 'inventory_sources'];

async function loadIncome(client, days = null) {
  const settings = await client.query(
    'SELECT setting_key, setting_value FROM fleet_economics_settings WHERE setting_key = ANY($1)',
    [[WINDOW_KEY, 'repair_kit_cost']]);
  const byKey = Object.fromEntries(settings.rows.map((r) => [r.setting_key, r.setting_value]));
  const windowDays = days || (WINDOW_CHOICES.includes(Number(byKey[WINDOW_KEY])) ? Number(byKey[WINDOW_KEY]) : DEFAULT_WINDOW_DAYS);
  const kitCost = Number(byKey.repair_kit_cost) || 0;

  // The subs' Current Gil/Day, added up per character.
  const subsByCid = new Map();
  for (const sub of await loadSubmarines(client)) {
    const key = String(sub.cid);
    if (!subsByCid.has(key)) subsByCid.set(key, { count: 0, matched: 0, perDay: 0 });
    const s = subsByCid.get(key);
    s.count += 1;
    if (typeof sub.current_gil_day === 'number') {
      s.matched += 1;
      s.perDay += sub.current_gil_day;
    }
  }

  const { latestCharacter } = await snapshotFragments(client);
  const characters = (await client.query(`
    SELECT c.cid::text AS cid, c.name, c.world, c.account_label, c.snapshot_at, c.fc_id::text AS fc_id, so.sort_index
    FROM ${latestCharacter} c
    LEFT JOIN character_sort_order so ON so.cid = c.cid`)).rows;
  const withSubs = characters.filter((c) => subsByCid.has(c.cid));

  // Each character's salvage and repair kit history in the window, plus the last value at or before
  // its start (as on the Supplies tab), and the same for their FC chests' salvage.
  const now = Date.now();
  const windowStart = new Date(now - windowDays * DAY);
  const points = await metricWindow(client, 'character', METRICS, windowStart, withSubs.map((c) => c.cid));
  const latestAt = new Map();
  for (const [key, list] of points) {
    const cid = key.split('|')[0];
    for (const p of list) latestAt.set(cid, Math.max(latestAt.get(cid) || 0, p.at));
  }
  const fcIds = [...new Set(withSubs.map((c) => c.fc_id).filter(Boolean))];
  const chestPoints = fcIds.length ? await metricWindow(client, 'fc', SALVAGE_METRICS, windowStart, fcIds) : new Map();
  const dropsByFc = new Map(fcIds.map((fc) => [fc, chestDrops(new Map(Object.keys(SALVAGE_PRICES)
    .map((id) => [id, chestPoints.get(`${fc}|item_qty:${id}`) || []])))]));

  const rows = withSubs.map((c) => {
    const subs = subsByCid.get(c.cid);
    // Up to the character's last sync (or its newest recorded value, if that is later).
    const end = Math.max(c.snapshot_at ? new Date(c.snapshot_at).getTime() : 0, latestAt.get(c.cid) || 0) || now;
    const salvage = new Map(Object.keys(SALVAGE_PRICES).map((id) => [id, points.get(`${c.cid}|item_qty:${id}`) || []]));
    const income = characterIncome({
      salvage,
      kits: points.get(`${c.cid}|repair_kits`) || [],
      prices: SALVAGE_PRICES,
      kitCost,
      expectedPerDay: subs.matched > 0 ? subs.perDay : null,
      windowStart: windowStart.getTime(),
      end,
      drops: c.fc_id ? dropsByFc.get(c.fc_id) : null,
      sources: points.get(`${c.cid}|inventory_sources`),
      kitsTotal: points.get(`${c.cid}|item_qty:10373`),
    });
    return {
      cid: c.cid, name: c.name, world: c.world, account_label: c.account_label, sort_index: c.sort_index,
      last_synced_at: c.snapshot_at,
      subs: subs.count,
      subs_unmatched: subs.count - subs.matched,
      ...income,
      status: income.enough ? shareClass(income.share) : '',
    };
  });

  const counted = rows.filter((r) => r.enough);
  const sum = (field) => counted.reduce((total, r) => total + (Number(r[field]) || 0), 0);
  const compared = counted.filter((r) => r.expectedPerDay !== null);
  const realCompared = compared.reduce((total, r) => total + r.perDay, 0);
  const expectedCompared = compared.reduce((total, r) => total + r.expectedPerDay, 0);
  return {
    success: true,
    windowDays,
    windowChoices: WINDOW_CHOICES,
    kitCost,
    rows,
    withoutSubs: characters.length - withSubs.length,
    totals: {
      perDay: sum('perDay'),
      salvagePerDay: sum('salvagePerDay'),
      kitPerDay: sum('kitPerDay'),
      net: sum('net'),
      comparedPerDay: realCompared,
      expectedPerDay: expectedCompared,
      share: expectedCompared > 0 ? realCompared / expectedCompared : null,
      compared: compared.length,
      notEnough: rows.length - counted.length,
    },
  };
}

ipcMain.handle('get-income', async () => {
  return withClient((client) => loadIncome(client), (err) => {
    return { success: false, error: err.message };
  });
});

ipcMain.handle('save-income-settings', async (event, input = {}) => {
  const windowDays = Number(input.windowDays);
  if (!WINDOW_CHOICES.includes(windowDays)) return { success: false, error: `Choose ${WINDOW_CHOICES.join(', ')} days.` };
  return withClient(async (client) => {
    await client.query(
      `INSERT INTO fleet_economics_settings (setting_key, setting_value, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now()`,
      [WINDOW_KEY, windowDays]);
    return { success: true };
  }, (err) => {
    return { success: false, error: err.message };
  });
});

module.exports = { loadIncome };
