// Supplies tab: days until each character runs out of ceruleum and repair kits, from how fast it used
// them over the last few days (the history Trends charts), and how many to buy so they last a chosen
// number of days. The working out is in supply-runway.js.
const { ipcMain } = require('electron');
const { withClient, snapshotFragments } = require('../db');
const { metricWindow } = require('../db/metric-window');
const { loadFcDirectory } = require('../characters/fc-directory');
const { DEFAULT_TANK_COST, MAX_TANK_COST, creditPlan } = require('../subs/fc-credits');
const {
  DEFAULT_WINDOW_DAYS, DEFAULT_TARGET_DAYS, WINDOW_CHOICES, DAY, usageRate, runway, restockAmount, clampDays,
} = require('../subs/supply-runway');

const METRICS = ['ceruleum', 'repair_kits'];
// The same supplies held in bags and retainers (plugin 0.9.1), so supplies moved to a retainer are not
// counted as used: the use per day comes from these once they cover a day, otherwise from the bags.
const TOTAL_METRIC = { ceruleum: 'item_qty:10155', repair_kits: 'item_qty:10373' };
const CERULEUM_TANK = 10155;
const WINDOW_KEY = 'supply_window_days';
const TARGET_KEY = 'restock_target_days';
const MAX_TARGET_DAYS = 90;
const TANK_COST_KEY = 'fc_credit_tank_cost';

async function readSettings(client) {
  const { rows } = await client.query(
    'SELECT setting_key, setting_value FROM fleet_economics_settings WHERE setting_key = ANY($1)',
    [[WINDOW_KEY, TARGET_KEY, TANK_COST_KEY, 'repair_kit_cost']]);
  const byKey = Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value]));
  const windowDays = WINDOW_CHOICES.includes(Number(byKey[WINDOW_KEY])) ? Number(byKey[WINDOW_KEY]) : DEFAULT_WINDOW_DAYS;
  return {
    windowDays,
    targetDays: clampDays(byKey[TARGET_KEY], DEFAULT_TARGET_DAYS, MAX_TARGET_DAYS),
    repairKitCost: Number(byKey.repair_kit_cost) || 0,
    tankCost: clampDays(byKey[TANK_COST_KEY], DEFAULT_TANK_COST, MAX_TANK_COST),
  };
}

// Every character with subs: what it holds, its use per day and days left; fleet totals; and the
// ceruleum its Free Companies' credits can buy (fc-credits.js). Also used by the Discord summary.
async function loadSupplies(client) {
  const settings = await readSettings(client);
  const { latestCharacter } = await snapshotFragments(client);
  const characters = (await client.query(`
    SELECT c.cid::text AS cid, c.name, c.world, c.account_label, c.snapshot_at, c.ceruleum, c.repair_kits, so.sort_index,
           c.fc_id::text AS fc_id,
           (SELECT COUNT(*) FROM companion_submarine_snapshot s WHERE s.cid = c.cid AND s.level > 0)::int AS subs_built
    FROM ${latestCharacter} c
    LEFT JOIN character_sort_order so ON so.cid = c.cid`)).rows;
  const withSubs = characters.filter((c) => c.subs_built > 0);

  // Each character's history in the window, plus the last value at or before its start.
  const now = Date.now();
  const windowStart = new Date(now - settings.windowDays * DAY);
  const points = await metricWindow(client, 'character', [...METRICS, ...Object.values(TOTAL_METRIC)], windowStart, withSubs.map((c) => c.cid));

  const rows = withSubs.map((c) => {
    const asOf = c.snapshot_at ? new Date(c.snapshot_at).getTime() : now;
    const entry = {
      cid: c.cid, name: c.name, world: c.world, account_label: c.account_label, sort_index: c.sort_index,
      fc_id: c.fc_id, last_synced_at: c.snapshot_at,
    };
    for (const metric of METRICS) {
      const have = Number(c[metric]) || 0;
      // The current value counts as a point too (it can be newer than the last recorded change).
      const series = [...(points.get(`${c.cid}|${metric}`) || []), { at: asOf, value: have }];
      const totalRate = usageRate(points.get(`${c.cid}|${TOTAL_METRIC[metric]}`) || [], windowStart.getTime(), asOf);
      const rate = totalRate.perDay !== null ? totalRate : usageRate(series, windowStart.getTime(), asOf);
      const left = runway(have, rate.perDay, asOf);
      entry[metric] = {
        have,
        perDay: rate.perDay,
        days: left.days === Infinity ? 'never' : left.days,
        runsOutAt: left.runsOutAt,
        restock: restockAmount(have, rate.perDay, settings.targetDays),
      };
    }
    return entry;
  });

  const fcChest = await client.query(
    'SELECT COALESCE(SUM(quantity), 0)::bigint AS n FROM companion_fc_inventory_snapshot WHERE item_id = $1', [CERULEUM_TANK]);
  const sum = (metric, field) => rows.reduce((total, r) => total + (Number(r[metric][field]) || 0), 0);

  // Ceruleum from FC credits: per Free Company, per account and for the fleet.
  const { rows: fcs } = await loadFcDirectory(client);
  const chestRows = await client.query(
    'SELECT fc_id::text AS fc_id, SUM(quantity)::bigint AS n FROM companion_fc_inventory_snapshot WHERE item_id = $1 GROUP BY fc_id', [CERULEUM_TANK]);
  const credits = creditPlan({
    fcs,
    characters: rows.map((r) => ({ fc_id: r.fc_id, account_label: r.account_label, perDay: r.ceruleum.perDay, have: r.ceruleum.have })),
    chests: new Map(chestRows.rows.map((r) => [r.fc_id, Number(r.n)])),
    tankCost: settings.tankCost,
  });
  return {
    success: true,
    ...settings,
    windowChoices: WINDOW_CHOICES,
    maxTargetDays: MAX_TARGET_DAYS,
    rows,
    withoutSubs: characters.length - withSubs.length,
    totals: {
      ceruleumPerDay: sum('ceruleum', 'perDay'),
      repairKitsPerDay: sum('repair_kits', 'perDay'),
      ceruleumRestock: sum('ceruleum', 'restock'),
      repairKitsRestock: sum('repair_kits', 'restock'),
      fcChestCeruleum: Number(fcChest.rows[0].n),
    },
    credits,
    maxTankCost: MAX_TANK_COST,
  };
}

ipcMain.handle('get-supplies', async () => {
  return withClient(loadSupplies, (err) => {
    return { success: false, error: err.message };
  });
});

// { windowDays, targetDays, tankCost }: shared by every PC (fleet_economics_settings).
ipcMain.handle('save-supply-settings', async (event, input = {}) => {
  const windowDays = Number(input.windowDays);
  const targetDays = Number(input.targetDays);
  const tankCost = input.tankCost === undefined ? null : Number(input.tankCost);
  if (tankCost !== null && (!Number.isInteger(tankCost) || tankCost < 1 || tankCost > MAX_TANK_COST)) {
    return { success: false, error: `Company credits per tank: 1 to ${MAX_TANK_COST.toLocaleString()}.` };
  }
  if (!WINDOW_CHOICES.includes(windowDays)) return { success: false, error: `Choose ${WINDOW_CHOICES.join(', ')} days.` };
  if (!Number.isInteger(targetDays) || targetDays < 1 || targetDays > MAX_TARGET_DAYS) {
    return { success: false, error: `Restock for 1 to ${MAX_TARGET_DAYS} days.` };
  }
  return withClient(async (client) => {
    const values = [[WINDOW_KEY, windowDays], [TARGET_KEY, targetDays], ...(tankCost !== null ? [[TANK_COST_KEY, tankCost]] : [])];
    for (const [key, value] of values) {
      await client.query(
        `INSERT INTO fleet_economics_settings (setting_key, setting_value, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now()`,
        [key, value]);
    }
    return { success: true };
  }, (err) => {
    return { success: false, error: err.message };
  });
});

module.exports = { loadSupplies };
