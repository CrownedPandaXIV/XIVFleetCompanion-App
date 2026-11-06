-- The fleet views (db/views.sql) in SQLite's words, for the plugin-only one-file version planned near the end of 2.x.
-- Each view has the same name and columns and must give the same answers as its PostgreSQL twin:
-- tests/db/verify-sqlite-views.js fills both with the same data and compares every row. Change both files together.
--
-- What differs from PostgreSQL, and how:
--   times are Unix seconds (db/sqlite/tables.sql), so "now" is NOW_SECONDS below and spans are seconds
--     ((julianday('now') - 2440587.5) * 86400, the same within one statement); fleet_not_synced_view's "behind" is
--     seconds where PostgreSQL gives an interval
--   no functions: the part letters are a list inside fleet_subs_view instead of fleet_part_letter()
--   no LATERAL or DISTINCT ON: window functions and correlated subqueries instead
--   no greatest/least, which skip NULLs: CASE, or max()/min() where nothing can be NULL
--   no ceil/floor (not always built in): CAST to an integer, which cuts towards zero; PostgreSQL's ::int rounds, so
--     round() first where it does
--   booleans are 0 or 1

DROP VIEW IF EXISTS fleet_pcs_view;
DROP VIEW IF EXISTS fleet_retainer_gear_view;
DROP VIEW IF EXISTS fleet_retainers_view;
DROP VIEW IF EXISTS fleet_roster_view;
DROP VIEW IF EXISTS fleet_alerts_view;
DROP VIEW IF EXISTS fleet_summary_view;
DROP VIEW IF EXISTS fleet_not_synced_view;
DROP VIEW IF EXISTS fleet_subs_view;
DROP VIEW IF EXISTS fleet_supplies_view;

-- NOW_SECONDS: ((julianday('now') - 2440587.5) * 86400.0)

CREATE VIEW fleet_supplies_view AS
WITH settings AS (
  SELECT window_days, target_days, ((julianday('now') - 2440587.5) * 86400.0) - window_days * 86400.0 AS window_start
  FROM (SELECT
    coalesce((SELECT CAST(setting_value AS INTEGER) FROM fleet_economics_settings
              WHERE setting_key = 'supply_window_days' AND setting_value IN (3, 7, 14, 30)), 14) AS window_days,
    coalesce((SELECT CAST(round(setting_value) AS INTEGER) FROM fleet_economics_settings
              WHERE setting_key = 'restock_target_days' AND setting_value BETWEEN 1 AND 90), 14) AS target_days)
),
characters AS (
  SELECT c.cid, c.name, c.world, c.account_label, c.fc_id, so.sort_index, c.last_synced_at AS as_of,
         coalesce(c.ceruleum, 0) AS ceruleum, coalesce(c.repair_kits, 0) AS repair_kits
  FROM companion_character_current c
  LEFT JOIN character_sort_order so ON so.cid = c.cid
  WHERE EXISTS (SELECT 1 FROM companion_submarine_snapshot s WHERE s.cid = c.cid AND s.level > 0)
),
series AS (
  SELECT row_number() OVER (ORDER BY ch.cid, m.metric) AS id, ch.cid, ch.as_of, m.supply, m.metric, m.held,
         CASE WHEN NOT m.held THEN CASE m.supply WHEN 'ceruleum' THEN ch.ceruleum ELSE ch.repair_kits END END AS now_value
  FROM characters ch
  CROSS JOIN (SELECT 'ceruleum' AS supply, 'item_qty:10155' AS metric, 1 AS held
              UNION ALL SELECT 'ceruleum', 'ceruleum', 0
              UNION ALL SELECT 'repair_kits', 'item_qty:10373', 1
              UNION ALL SELECT 'repair_kits', 'repair_kits', 0) m
),
-- Everything recorded in the window, up to the last sync, newest first per series.
inside AS (
  SELECT se.id, h.recorded_at AS at, h.value,
         lead(h.value) OVER (PARTITION BY se.id ORDER BY h.recorded_at DESC) AS older,
         row_number() OVER (PARTITION BY se.id ORDER BY h.recorded_at DESC) AS rn
  FROM series se CROSS JOIN settings st
  JOIN companion_metric_history h ON h.subject_type = 'character' AND h.subject_id = se.cid AND h.metric = se.metric
   AND h.recorded_at > st.window_start AND h.recorded_at <= se.as_of
),
w AS (
  SELECT id, sum(CASE WHEN older > value THEN older - value ELSE 0 END) AS drops, min(at) AS oldest_at,
         max(CASE WHEN older IS NULL THEN value END) AS oldest_value,  -- the last one read has nothing older
         max(CASE WHEN rn = 1 THEN value END) AS newest_value          -- the first one read
  FROM inside GROUP BY id
),
used AS (
  SELECT se.id, se.now_value, se.as_of, st.window_start,
         -- the starting point: the last value at or before the window start (and the last sync)
         (SELECT h.recorded_at FROM companion_metric_history h
          WHERE h.subject_type = 'character' AND h.subject_id = se.cid AND h.metric = se.metric
            AND h.recorded_at <= min(st.window_start, se.as_of) ORDER BY h.recorded_at DESC LIMIT 1) AS base_at,
         (SELECT h.value FROM companion_metric_history h
          WHERE h.subject_type = 'character' AND h.subject_id = se.cid AND h.metric = se.metric
            AND h.recorded_at <= min(st.window_start, se.as_of) ORDER BY h.recorded_at DESC LIMIT 1) AS base_value,
         coalesce(w.drops, 0) AS drops, w.oldest_at, w.oldest_value, w.newest_value
  FROM series se CROSS JOIN settings st LEFT JOIN w ON w.id = se.id
),
totals AS (
  SELECT id, as_of, window_start,
         coalesce(base_at, oldest_at, CASE WHEN now_value IS NOT NULL THEN as_of END) AS first_at,
         drops
         + CASE WHEN base_value IS NOT NULL AND oldest_value IS NOT NULL AND base_value > oldest_value THEN base_value - oldest_value ELSE 0 END
         + CASE WHEN now_value IS NOT NULL AND as_of > window_start AND coalesce(newest_value, base_value) > now_value
                THEN coalesce(newest_value, base_value) - now_value ELSE 0 END AS used
  FROM used
),
rates AS (
  SELECT se.cid, se.supply, se.held,
         CASE WHEN t.first_at IS NOT NULL  -- no values at all: not enough history
                   AND (t.as_of - max(t.window_start, t.first_at)) / 86400.0 >= 1
              THEN t.used * 1.0 / ((t.as_of - max(t.window_start, t.first_at)) / 86400.0) END AS per_day
  FROM series se JOIN totals t ON t.id = se.id
),
per_day AS (
  SELECT ch.*,
         coalesce((SELECT per_day FROM rates r WHERE r.cid = ch.cid AND r.supply = 'ceruleum' AND r.held),
                  (SELECT per_day FROM rates r WHERE r.cid = ch.cid AND r.supply = 'ceruleum' AND NOT r.held)) AS ceruleum_per_day,
         coalesce((SELECT per_day FROM rates r WHERE r.cid = ch.cid AND r.supply = 'repair_kits' AND r.held),
                  (SELECT per_day FROM rates r WHERE r.cid = ch.cid AND r.supply = 'repair_kits' AND NOT r.held)) AS repair_kits_per_day
  FROM characters ch
),
-- What to buy for the restock days, before rounding up.
short AS (
  SELECT p.*, st.window_days, st.target_days,
         p.ceruleum_per_day * st.target_days - p.ceruleum AS ceruleum_short,
         p.repair_kits_per_day * st.target_days - p.repair_kits AS repair_kits_short
  FROM per_day p CROSS JOIN settings st
)
SELECT cid, name, world, account_label, fc_id, sort_index, as_of AS last_synced_at,
       ceruleum, ceruleum_per_day,
       CASE WHEN ceruleum_per_day > 0 THEN max(ceruleum, 0) / ceruleum_per_day END AS ceruleum_days_left,
       CASE WHEN ceruleum_per_day > 0 THEN max(0, CAST(ceruleum_short AS INTEGER) + (ceruleum_short > CAST(ceruleum_short AS INTEGER))) ELSE 0 END AS ceruleum_restock,
       repair_kits, repair_kits_per_day,
       CASE WHEN repair_kits_per_day > 0 THEN max(repair_kits, 0) / repair_kits_per_day END AS repair_kits_days_left,
       CASE WHEN repair_kits_per_day > 0 THEN max(0, CAST(repair_kits_short AS INTEGER) + (repair_kits_short > CAST(repair_kits_short AS INTEGER))) ELSE 0 END AS repair_kits_restock,
       window_days, target_days
FROM short;

CREATE VIEW fleet_subs_view AS
WITH letters (lo, hi, letter) AS (
  VALUES (21792, 21795, 'S'), (21796, 21799, 'U'), (22526, 22529, 'W'), (23903, 23906, 'C'), (24344, 24347, 'Y'),
         (24348, 24351, 'S+'), (24352, 24355, 'U+'), (24356, 24359, 'W+'), (24360, 24363, 'C+'), (24364, 24367, 'Y+')
)
SELECT s.cid, c.name AS character_name, c.world, c.account_label, c.fc_id, so.sort_index,
       s.sub_name,
       coalesce(s.slot, CASE WHEN s.sub_name GLOB 'Submersible-[1-4]' THEN CAST(substr(s.sub_name, 13, 1) AS INTEGER) END) AS slot,
       s.level AS rank,
       coalesce((SELECT letter FROM letters WHERE s.part1 BETWEEN lo AND hi), CAST(s.part1 AS TEXT), 'null') || '-' ||
       coalesce((SELECT letter FROM letters WHERE s.part2 BETWEEN lo AND hi), CAST(s.part2 AS TEXT), 'null') || '-' ||
       coalesce((SELECT letter FROM letters WHERE s.part3 BETWEEN lo AND hi), CAST(s.part3 AS TEXT), 'null') || '-' ||
       coalesce((SELECT letter FROM letters WHERE s.part4 BETWEEN lo AND hi), CAST(s.part4 AS TEXT), 'null') AS build,
       s.return_time,
       CASE WHEN coalesce(s.return_time, 0) <= 0 THEN 'in_port'
            WHEN s.return_time <= ((julianday('now') - 2440587.5) * 86400.0) THEN 'returned'
            ELSE 'out' END AS status,
       s.current_exp, s.next_level_exp, s.updated_at
FROM companion_submarine_snapshot s
LEFT JOIN companion_character_current c ON c.cid = s.cid
LEFT JOIN character_sort_order so ON so.cid = s.cid
WHERE s.level > 0;

CREATE VIEW fleet_not_synced_view AS
WITH setting AS (
  SELECT coalesce((SELECT CAST(setting_value AS INTEGER) FROM fleet_economics_settings
                   WHERE setting_key = 'not_synced_after_minutes' AND setting_value = round(setting_value)
                     AND setting_value BETWEEN 10 AND 1440), 30) AS minutes
),
accounts AS (
  SELECT coalesce(nullif(account_label, ''), 'Ungrouped') AS account, max(last_synced_at) AS newest
  FROM companion_character_current GROUP BY 1
)
SELECT c.cid, c.name, c.world, c.account_label, a.newest - c.last_synced_at AS behind
FROM companion_character_current c
JOIN accounts a ON a.account = coalesce(nullif(c.account_label, ''), 'Ungrouped')
CROSS JOIN setting st
WHERE a.newest - c.last_synced_at >= st.minutes * 60;

CREATE VIEW fleet_summary_view AS
WITH thresholds AS (
  SELECT
    coalesce((SELECT setting_value FROM fleet_economics_settings WHERE setting_key = 'low_ceruleum_threshold'), 0) AS ceruleum,
    coalesce((SELECT setting_value FROM fleet_economics_settings WHERE setting_key = 'low_repair_kit_threshold'), 0) AS repair_kits
),
subs AS (
  SELECT count(*) AS subs,
         count(*) FILTER (WHERE status = 'returned') AS subs_returned,
         count(*) FILTER (WHERE status = 'in_port') AS subs_in_port,
         count(*) FILTER (WHERE status = 'out') AS subs_out,
         min(return_time) FILTER (WHERE status = 'out') AS next_return_time
  FROM fleet_subs_view
),
retainers AS (
  SELECT count(*) AS retainers,
         count(*) FILTER (WHERE has_venture AND venture_ends_at <= ((julianday('now') - 2440587.5) * 86400.0)) AS ventures_done,
         count(*) FILTER (WHERE NOT coalesce(has_venture, 0)) AS retainers_idle
  FROM companion_retainer_lookup WHERE coalesce(job, 0) > 0
),
supplies AS (
  SELECT count(*) FILTER (WHERE t.ceruleum > 0 AND f.ceruleum < t.ceruleum) AS low_ceruleum,
         count(*) FILTER (WHERE t.repair_kits > 0 AND f.repair_kits < t.repair_kits) AS low_repair_kits,
         min(CASE WHEN f.ceruleum_days_left IS NULL THEN f.repair_kits_days_left
                  WHEN f.repair_kits_days_left IS NULL THEN f.ceruleum_days_left
                  ELSE min(f.ceruleum_days_left, f.repair_kits_days_left) END) AS soonest_runs_out_days
  FROM fleet_supplies_view f CROSS JOIN thresholds t
  WHERE f.cid NOT IN (SELECT cid FROM fleet_not_synced_view)
)
SELECT subs.*, retainers.*, supplies.* FROM subs, retainers, supplies;

CREATE VIEW fleet_alerts_view AS
WITH settings AS (
  SELECT
    coalesce((SELECT setting_value FROM fleet_economics_settings WHERE setting_key = 'low_ceruleum_threshold'), 0) AS ceruleum,
    coalesce((SELECT setting_value FROM fleet_economics_settings WHERE setting_key = 'low_repair_kit_threshold'), 0) AS repair_kits,
    coalesce((SELECT CAST(setting_value AS INTEGER) FROM fleet_economics_settings
              WHERE setting_key = 'house_warn_days' AND setting_value = round(setting_value) AND setting_value BETWEEN 1 AND 44), 7) AS house_days
),
houses AS (
  SELECT fc_id, fc_name, has_house FROM (
    SELECT fc_id, fc_name, has_house, row_number() OVER (PARTITION BY fc_id ORDER BY updated_at DESC) AS rn
    FROM companion_character_housing WHERE fc_id IS NOT NULL)
  WHERE rn = 1
),
visited AS (
  SELECT fc_id, max(house_last_visited) AS last_visited
  FROM companion_character_housing WHERE fc_id IS NOT NULL GROUP BY fc_id
),
house_ages AS (
  SELECT h.fc_id, coalesce(h.fc_name, 'FC ' || h.fc_id) AS fc_name, v.last_visited,
         CASE WHEN v.last_visited IS NOT NULL
              THEN max(0, CAST((((julianday('now') - 2440587.5) * 86400.0) - v.last_visited) / 86400 AS INTEGER)) END AS days
  FROM houses h LEFT JOIN visited v ON v.fc_id = h.fc_id
  WHERE h.has_house
),
supplies AS (
  SELECT c.cid, c.name || ' (' || c.world || ')' AS who, coalesce(c.ceruleum, 0) AS ceruleum, coalesce(c.repair_kits, 0) AS repair_kits
  FROM companion_character_current c
  WHERE EXISTS (SELECT 1 FROM companion_submarine_snapshot s WHERE s.cid = c.cid AND s.level > 0)
    AND c.cid NOT IN (SELECT cid FROM fleet_not_synced_view)
)
SELECT CASE WHEN days IS NULL OR days < 30 THEN 'warn' ELSE 'danger' END AS level, 'house' AS kind, fc_name AS subject,
       CASE WHEN days IS NULL THEN 'house: no date yet for when it was last entered'
            WHEN days >= 45 THEN 'house not entered for ' || days || ' days: past 45, the game can demolish it any time'
            ELSE 'house not entered for ' || days || ' day' || CASE WHEN days = 1 THEN '' ELSE 's' END
                 || '; demolished after ' || (45 - days) || ' more' END AS detail,
       coalesce(days, 0) AS weight
FROM house_ages, settings st WHERE days IS NULL OR days >= st.house_days
UNION ALL
SELECT 'warn', 'low_ceruleum', s.who, s.ceruleum || ' ceruleum (warning below ' || CAST(round(st.ceruleum) AS INTEGER) || ')', 0
FROM supplies s, settings st WHERE st.ceruleum > 0 AND s.ceruleum < st.ceruleum
UNION ALL
SELECT 'warn', 'low_repair_kits', s.who, s.repair_kits || ' repair kits (warning below ' || CAST(round(st.repair_kits) AS INTEGER) || ')', 0
FROM supplies s, settings st WHERE st.repair_kits > 0 AND s.repair_kits < st.repair_kits
UNION ALL
SELECT 'warn', 'not_synced', name || ' (' || world || ')',
       'no longer synced (' || CAST(behind / 3600 AS INTEGER) || ' h behind its account): unticked in the plugin, or its AutoRetainer no longer has it', 0
FROM fleet_not_synced_view
UNION ALL
SELECT 'warn', 'autoretainer', pc_name || CASE WHEN account_label <> '' THEN ' (' || account_label || ')' ELSE '' END,
       'AutoRetainer was not running at its last sync, so nothing syncs from there', 0
FROM companion_pc_status WHERE autoretainer_ready = 0 AND last_sync_at > ((julianday('now') - 2440587.5) * 86400.0) - 86400
ORDER BY 1, 2, 5 DESC, 3;

CREATE VIEW fleet_roster_view AS
WITH thresholds AS (
  SELECT
    coalesce((SELECT setting_value FROM fleet_economics_settings WHERE setting_key = 'low_ceruleum_threshold'), 0) AS ceruleum,
    coalesce((SELECT setting_value FROM fleet_economics_settings WHERE setting_key = 'low_repair_kit_threshold'), 0) AS repair_kits
),
built AS (
  SELECT cid, count(*) AS subs_built FROM companion_submarine_snapshot WHERE level > 0 GROUP BY cid
)
SELECT c.cid, c.name, c.world, c.account_label, so.sort_index,
       c.gil, c.ceruleum, c.repair_kits, c.retainer_count, c.submarine_count, c.last_synced_at,
       h.fc_name, h.fc_points,
       CASE WHEN h.has_house THEN coalesce(k.city_name, 'City ' || h.house_city) || ' W' || h.house_ward || ' P' || h.house_plot END AS house,
       l.pc_name AS login_pc, l.account_label AS login_label, l.logged_in_at,
       CAST(coalesce(b.subs_built, 0) AS INTEGER) AS subs_built,
       CAST(ns.behind / 60 AS INTEGER) AS behind_minutes,
       (coalesce(b.subs_built, 0) > 0 AND ns.cid IS NULL AND coalesce(c.ceruleum, 0) < t.ceruleum) AS low_ceruleum,
       (coalesce(b.subs_built, 0) > 0 AND ns.cid IS NULL AND coalesce(c.repair_kits, 0) < t.repair_kits) AS low_repair_kits
FROM companion_character_current c
CROSS JOIN thresholds t
LEFT JOIN character_sort_order so ON so.cid = c.cid
LEFT JOIN companion_character_housing h ON h.cid = c.cid
LEFT JOIN housing_key_city_lookup k ON k.city_id = h.house_city
LEFT JOIN companion_character_login l ON l.cid = c.cid
LEFT JOIN built b ON b.cid = c.cid
LEFT JOIN fleet_not_synced_view ns ON ns.cid = c.cid;

CREATE VIEW fleet_retainers_view AS
SELECT rl.retainer_id, rl.owner_cid, c.name AS owner_name, c.world, c.account_label, so.sort_index,
       rl.name AS retainer_name, rl.job, rl.level, rl.gil, rl.has_venture, rl.venture_id, rl.venture_ends_at, rl.hire_order_index,
       t.target_mode, t.target_value, coalesce(t.only_crafted, 0) AS only_crafted,
       (rl.items_seen_at IS NOT NULL OR EXISTS (SELECT 1 FROM companion_inventory_snapshot inv
                                                WHERE inv.owner_cid = rl.owner_cid AND inv.retainer_id = rl.retainer_id)) AS items_seen
FROM companion_retainer_lookup rl
LEFT JOIN companion_character_current c ON c.cid = rl.owner_cid
LEFT JOIN retainer_gear_targets t ON t.retainer_id = rl.retainer_id
LEFT JOIN character_sort_order so ON so.cid = rl.owner_cid;

CREATE VIEW fleet_retainer_gear_view AS
SELECT retainer_id, item_id FROM companion_inventory_snapshot WHERE sorted_container = 11000 AND item_id IS NOT NULL;

CREATE VIEW fleet_pcs_view AS
SELECT pc_name, account_label, plugin_version, last_sync_at, autoretainer_ready, allagantools_ready, fctracker_found,
       submarinetracker_found, venture_stats_found, characters_synced, characters_left_out, characters_elsewhere,
       problems, check_text, check_to_fix, check_at
FROM companion_pc_status;
