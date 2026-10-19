// Every Free Company with its house, bid eligibility and how long since the house was last entered.
// Used by the Free Companies tab, the Summary's house warning (ipc/inventory.js) and the Discord alerts.
const { snapshotFragments } = require('../db');
const { withHouseAge, warnDaysSetting } = require('./house-warning');

// The house warning setting (days without anyone entering), from the Summary tab.
async function houseWarnDays(client) {
  const result = await client.query(
    `SELECT setting_value FROM fleet_economics_settings WHERE setting_key = 'house_warn_days'`);
  return warnDaysSetting(result.rows.length ? result.rows[0].setting_value : null);
}

async function loadFcDirectory(client) {
  const { latestFcMember } = await snapshotFragments(client);

  const result = await client.query(`
    WITH fc_housing AS (
      SELECT DISTINCT ON (fc_id) fc_id, fc_name, fc_master, fc_points, fc_rank, total_members,
             has_house, house_city, house_ward, house_plot, fc_home_world_id,
             fc_founding_date, fc_eligibility_override
      FROM companion_character_housing
      WHERE fc_id IS NOT NULL
      ORDER BY fc_id, updated_at DESC
    ),
    -- Each member's row carries the date FCTracker saw on that character's PC; the newest one counts.
    fc_visited AS (
      SELECT fc_id, MAX(house_last_visited) AS house_last_visited
      FROM companion_character_housing
      WHERE fc_id IS NOT NULL
      GROUP BY fc_id
    )
    SELECT fh.fc_id, fh.fc_name, fh.fc_master, fh.fc_points, fh.fc_rank, fh.total_members,
           fh.has_house, fh.house_city, fh.house_ward, fh.house_plot,
           fh.fc_founding_date, fh.fc_eligibility_override, fv.house_last_visited,
           k.city_name AS district_name,
           w.name AS fc_world,
           (array_agg(DISTINCT c.account_label))[1] AS account_label,
           MIN(so.sort_index) AS sort_index
    FROM fc_housing fh
    LEFT JOIN fc_visited fv ON fv.fc_id = fh.fc_id
    LEFT JOIN housing_key_city_lookup k ON fh.house_city = k.city_id
    LEFT JOIN ffxiv_world w ON w.id = fh.fc_home_world_id::text
    LEFT JOIN ${latestFcMember} c ON c.fc_id = fh.fc_id
    LEFT JOIN character_sort_order so ON so.cid = c.cid
    GROUP BY fh.fc_id, fh.fc_name, fh.fc_master, fh.fc_points, fh.fc_rank, fh.total_members,
             fh.has_house, fh.house_city, fh.house_ward, fh.house_plot,
             fh.fc_founding_date, fh.fc_eligibility_override, fv.house_last_visited, k.city_name, w.name
    ORDER BY sort_index NULLS LAST, fh.fc_name
  `);

  // Housing bid eligibility - real formula confirmed against FCTracker's
  // own open-source logic (erdelf/ffxiv_FCTracker, Configuration.cs):
  // eligible when 30+ real days have passed since founding (or the rare
  // override date, if FCTracker ever needed to correct it), the FC is
  // Rank 6+, and it doesn't already have a house. Computed here rather
  // than in SQL for readability, matching the computeGearStatus pattern.
  const rows = result.rows.map((fc) => {
    const reference = fc.fc_eligibility_override || fc.fc_founding_date;
    const rank = fc.fc_rank != null ? parseInt(fc.fc_rank, 10) : null;
    let eligibility = null;
    let eligibleAt = null;

    if (!fc.has_house && reference) {
      const referenceMs = new Date(reference).getTime();
      const daysSince = (Date.now() - referenceMs) / 86400000;
      const rankOk = Number.isFinite(rank) && rank >= 6;
      const daysOk = daysSince >= 30;
      eligibleAt = new Date(referenceMs + 30 * 86400000).toISOString();
      if (rankOk && daysOk) {
        eligibility = 'Eligible';
      } else if (!daysOk) {
        const daysLeft = Math.ceil(30 - daysSince);
        eligibility = `Eligible in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
      } else {
        eligibility = `Rank too low (${rank ?? '?'}/6)`;
      }
    }

    return { ...fc, eligibility, eligible_at: eligibleAt };
  });

  const warnDays = await houseWarnDays(client);
  return { rows: rows.map((fc) => withHouseAge(fc, warnDays)), warnDays };
}

module.exports = { loadFcDirectory, houseWarnDays };
