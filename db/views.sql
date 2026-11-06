-- The views plugin 2.0 reads (and, later in 2.x, the app too): ready-made views of the fleet, so the plugin can show
-- the Summary, Subs and Supplies in the game without the app running. Each does its working out inside the database
-- and returns only the rows a window shows, with the same numbers as the app's tabs (tests/db/verify-fleet-views.js).
--
-- Written with plugin-only use in mind (a one-file SQLite version later in 2.x): views added from 2.x's "rest of the
-- tabs" stage keep to plain SQL where it gives the same answer, so they translate easily. Each has a SQLite twin in
-- db/sqlite/views.sql: change both together (tests/db/verify-sqlite-views.js checks they match row for row). And no view here reads the
-- game data tables (ffxiv_*): a new database has none until the app fills them, and a view that needed them couldn't
-- be made. Names of jobs, ventures and items come from the game's own files in the plugin instead.
--
-- Unlike db/updates/, this file is applied again whenever it changes: after the numbered updates, the app compares
-- its checksum with the one recorded in companion_views and, when they differ, replaces every view here in one
-- transaction (db/apply-updates.js ensureViews). So edit this file freely; a newer app's views are never replaced by
-- an older app's. Views and functions only, never tables or data: nothing is stored here, and nothing else depends
-- on these views, so they are dropped and made again.

DROP VIEW IF EXISTS fleet_pcs_view, fleet_retainer_gear_view, fleet_retainers_view, fleet_roster_view,
  fleet_alerts_view, fleet_summary_view, fleet_not_synced_view, fleet_subs_view, fleet_supplies_view CASCADE;

-- A sub part's class letter, from its item number (as subs/submarine-builds.js SUB_PART_CLASS; the test checks
-- they match). Anything else shows as its number.
CREATE OR REPLACE FUNCTION fleet_part_letter(item int) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN item BETWEEN 21792 AND 21795 THEN 'S'
    WHEN item BETWEEN 21796 AND 21799 THEN 'U'
    WHEN item BETWEEN 22526 AND 22529 THEN 'W'
    WHEN item BETWEEN 23903 AND 23906 THEN 'C'
    WHEN item BETWEEN 24344 AND 24347 THEN 'Y'
    WHEN item BETWEEN 24348 AND 24351 THEN 'S+'
    WHEN item BETWEEN 24352 AND 24355 THEN 'U+'
    WHEN item BETWEEN 24356 AND 24359 THEN 'W+'
    WHEN item BETWEEN 24360 AND 24363 THEN 'C+'
    WHEN item BETWEEN 24364 AND 24367 THEN 'Y+'
    ELSE coalesce(item::text, 'null')
  END
$$;

-- Every character with subs: ceruleum and repair kits held, used per day, days left and how many to buy (as the
-- Supplies tab, with its window and restock days from Settings).
--
-- Use per day is worked out as subs/supply-runway.js usageRate does: every drop in the recorded values
-- (companion_metric_history) from the window start to the character's last sync counts as use, a rise is a restock
-- and is ignored, divided by the days from the window start (or its first value, when later) to that sync. The last
-- value recorded at or before the window start is the starting point; for what's in the bags, the value at the last
-- sync counts too. It comes from what's held in bags and retainers together (item_qty:...) when that covers a day,
-- otherwise from the bags. Each character's history is read along its index, so nothing has to be sorted.
--
-- per_day NULL: not enough history yet; per_day 0: none used, so days_left is NULL (they never run out).
CREATE OR REPLACE VIEW fleet_supplies_view AS
WITH settings AS (
  SELECT window_days, target_days, now() - make_interval(days => window_days) AS window_start
  FROM (SELECT
    coalesce((SELECT setting_value::int FROM fleet_economics_settings
              WHERE setting_key = 'supply_window_days' AND setting_value IN (3, 7, 14, 30)), 14) AS window_days,
    coalesce((SELECT round(setting_value)::int FROM fleet_economics_settings
              WHERE setting_key = 'restock_target_days' AND setting_value BETWEEN 1 AND 90), 14) AS target_days) chosen
),
characters AS (
  SELECT c.cid, c.name, c.world, c.account_label, c.fc_id, so.sort_index, c.last_synced_at AS as_of,
         coalesce(c.ceruleum, 0) AS ceruleum, coalesce(c.repair_kits, 0) AS repair_kits
  FROM companion_character_current c
  LEFT JOIN character_sort_order so ON so.cid = c.cid
  WHERE EXISTS (SELECT 1 FROM companion_submarine_snapshot s WHERE s.cid = c.cid AND s.level > 0)
),
series AS (
  SELECT row_number() OVER ()::int AS id, ch.cid, ch.as_of, m.supply, m.metric, m.held,
         CASE WHEN NOT m.held THEN CASE m.supply WHEN 'ceruleum' THEN ch.ceruleum ELSE ch.repair_kits END END AS now_value
  FROM characters ch
  CROSS JOIN (VALUES ('ceruleum', 'item_qty:10155', true), ('ceruleum', 'ceruleum', false),
                     ('repair_kits', 'item_qty:10373', true), ('repair_kits', 'repair_kits', false)) m(supply, metric, held)
),
-- Each series in one pass along its index (newest first, so nothing is sorted): the drops between the values
-- recorded in the window, plus the drop from the starting point to the oldest of them and from the newest of them
-- (or the starting point) to the bags' value at the last sync.
used AS (
  SELECT se.id, base.at AS base_at, base.value AS base_value, w.drops, w.oldest_at, w.oldest_value, w.newest_value,
         se.now_value, se.as_of, st.window_start
  FROM series se CROSS JOIN settings st
  -- the starting point: the last value at or before the window start (and the last sync)
  LEFT JOIN LATERAL (
    SELECT h.recorded_at AS at, h.value FROM companion_metric_history h
    WHERE h.subject_type = 'character' AND h.subject_id = se.cid AND h.metric = se.metric
      AND h.recorded_at <= least(st.window_start, se.as_of)
    ORDER BY h.recorded_at DESC LIMIT 1) base ON true
  -- everything recorded in the window, up to the last sync
  CROSS JOIN LATERAL (
    SELECT coalesce(sum(greatest(older - value, 0)), 0) AS drops,
           min(at) AS oldest_at,
           max(value) FILTER (WHERE older IS NULL) AS oldest_value,  -- the last one read has nothing older
           max(value) FILTER (WHERE newest) AS newest_value          -- the first one read
    FROM (
      SELECT h.recorded_at AS at, h.value,
             lead(h.value) OVER newest_first AS older,
             row_number() OVER newest_first = 1 AS newest
      FROM companion_metric_history h
      WHERE h.subject_type = 'character' AND h.subject_id = se.cid AND h.metric = se.metric
        AND h.recorded_at > st.window_start AND h.recorded_at <= se.as_of
      WINDOW newest_first AS (ORDER BY h.recorded_at DESC)) inside) w
),
totals AS (
  SELECT id, as_of, window_start,
         coalesce(base_at, oldest_at, CASE WHEN now_value IS NOT NULL THEN as_of END) AS first_at,
         drops
         + CASE WHEN base_value IS NOT NULL AND oldest_value IS NOT NULL THEN greatest(base_value - oldest_value, 0) ELSE 0 END
         + CASE WHEN now_value IS NOT NULL AND as_of > window_start AND coalesce(newest_value, base_value) IS NOT NULL
                THEN greatest(coalesce(newest_value, base_value) - now_value, 0) ELSE 0 END AS used
  FROM used
),
rates AS (
  SELECT se.cid, se.supply, se.held,
         CASE WHEN t.first_at IS NOT NULL  -- no values at all: not enough history
                   AND extract(epoch FROM (t.as_of - greatest(t.window_start, t.first_at))) / 86400 >= 1
              THEN t.used::double precision / (extract(epoch FROM (t.as_of - greatest(t.window_start, t.first_at))) / 86400) END AS per_day
  FROM series se JOIN totals t ON t.id = se.id
),
per_day AS (
  SELECT ch.*,
         coalesce((SELECT per_day FROM rates r WHERE r.cid = ch.cid AND r.supply = 'ceruleum' AND r.held),
                  (SELECT per_day FROM rates r WHERE r.cid = ch.cid AND r.supply = 'ceruleum' AND NOT r.held)) AS ceruleum_per_day,
         coalesce((SELECT per_day FROM rates r WHERE r.cid = ch.cid AND r.supply = 'repair_kits' AND r.held),
                  (SELECT per_day FROM rates r WHERE r.cid = ch.cid AND r.supply = 'repair_kits' AND NOT r.held)) AS repair_kits_per_day
  FROM characters ch
)
SELECT p.cid, p.name, p.world, p.account_label, p.fc_id, p.sort_index, p.as_of AS last_synced_at,
       p.ceruleum, p.ceruleum_per_day,
       CASE WHEN p.ceruleum_per_day > 0 THEN greatest(p.ceruleum, 0) / p.ceruleum_per_day END AS ceruleum_days_left,
       CASE WHEN p.ceruleum_per_day > 0 THEN greatest(0, ceil(p.ceruleum_per_day * st.target_days - p.ceruleum))::int ELSE 0 END AS ceruleum_restock,
       p.repair_kits, p.repair_kits_per_day,
       CASE WHEN p.repair_kits_per_day > 0 THEN greatest(p.repair_kits, 0) / p.repair_kits_per_day END AS repair_kits_days_left,
       CASE WHEN p.repair_kits_per_day > 0 THEN greatest(0, ceil(p.repair_kits_per_day * st.target_days - p.repair_kits))::int ELSE 0 END AS repair_kits_restock,
       st.window_days, st.target_days
FROM per_day p CROSS JOIN settings st;

-- Every built sub, with its character, rank, parts (as the Subs tab's Current Setup, for example "S-S-U-C") and
-- where it is: 'in_port' (no voyage), 'returned' (back, waiting to be collected) or 'out' (back at return_time,
-- Unix seconds).
CREATE OR REPLACE VIEW fleet_subs_view AS
SELECT s.cid, c.name AS character_name, c.world, c.account_label, c.fc_id, so.sort_index,
       s.sub_name, coalesce(s.slot, substring(s.sub_name FROM '^Submersible-([1-4])$')::int) AS slot,
       s.level AS rank,
       fleet_part_letter(s.part1) || '-' || fleet_part_letter(s.part2) || '-' || fleet_part_letter(s.part3) || '-' || fleet_part_letter(s.part4) AS build,
       s.return_time,
       CASE WHEN coalesce(s.return_time, 0) <= 0 THEN 'in_port'
            WHEN s.return_time <= extract(epoch FROM now()) THEN 'returned'
            ELSE 'out' END AS status,
       s.current_exp, s.next_level_exp, s.updated_at
FROM companion_submarine_snapshot s
LEFT JOIN companion_character_current c ON c.cid = s.cid
LEFT JOIN character_sort_order so ON so.cid = s.cid
WHERE s.level > 0;

-- Characters the plugin no longer syncs: unticked or gone from AutoRetainer, so their last data stays and falls behind
-- the rest of their account (as characters/not-synced.js). Behind by at least Settings → General → Warnings' "not
-- synced" minutes (10 to 1440, 30 by default). Their supplies are left out of the low-supply warnings, as in the app.
CREATE OR REPLACE VIEW fleet_not_synced_view AS
WITH setting AS (
  SELECT coalesce((SELECT setting_value::int FROM fleet_economics_settings
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
WHERE a.newest - c.last_synced_at >= make_interval(mins => st.minutes);

-- The fleet at a glance, one row: subs back and out and when the next one is back, retainers on and off ventures,
-- characters below the low-supply warnings (Settings → General → Warnings; 0 turns one off; characters no longer
-- synced are left out, as in the app) and the soonest a character runs out of either.
CREATE OR REPLACE VIEW fleet_summary_view AS
WITH thresholds AS (
  SELECT
    coalesce((SELECT setting_value FROM fleet_economics_settings WHERE setting_key = 'low_ceruleum_threshold'), 0) AS ceruleum,
    coalesce((SELECT setting_value FROM fleet_economics_settings WHERE setting_key = 'low_repair_kit_threshold'), 0) AS repair_kits
),
subs AS (
  SELECT count(*)::int AS subs,
         (count(*) FILTER (WHERE status = 'returned'))::int AS subs_returned,
         (count(*) FILTER (WHERE status = 'in_port'))::int AS subs_in_port,
         (count(*) FILTER (WHERE status = 'out'))::int AS subs_out,
         min(return_time) FILTER (WHERE status = 'out') AS next_return_time
  FROM fleet_subs_view
),
retainers AS (
  SELECT count(*)::int AS retainers,
         (count(*) FILTER (WHERE has_venture AND venture_ends_at <= extract(epoch FROM now())))::int AS ventures_done,
         (count(*) FILTER (WHERE NOT coalesce(has_venture, false)))::int AS retainers_idle
  FROM companion_retainer_lookup WHERE coalesce(job, 0) > 0
),
supplies AS (
  SELECT (count(*) FILTER (WHERE t.ceruleum > 0 AND f.ceruleum < t.ceruleum))::int AS low_ceruleum,
         (count(*) FILTER (WHERE t.repair_kits > 0 AND f.repair_kits < t.repair_kits))::int AS low_repair_kits,
         min(least(f.ceruleum_days_left, f.repair_kits_days_left)) AS soonest_runs_out_days
  FROM fleet_supplies_view f CROSS JOIN thresholds t
  WHERE f.cid NOT IN (SELECT cid FROM fleet_not_synced_view)
)
SELECT subs.*, retainers.*, supplies.* FROM subs, retainers, supplies;

-- What needs attention, one row each, worst first (as the app's Summary warnings): level 'danger' or 'warn', kind,
-- who (subject) and what (detail).
--   house          an FC house nobody has entered for the house warning's days (Settings → General → Warnings, 1 to
--                  44, 7 by default) or more, or with no date yet; 'danger' from 30 days (the game demolishes at 45)
--   low_ceruleum   a character with subs below the low-ceruleum warning (left out when no longer synced)
--   low_repair_kits  the same for repair kits
--   not_synced     a character the plugin no longer syncs (fleet_not_synced_view)
--   autoretainer   a setup of the plugin that synced in the last day but found AutoRetainer not running
-- Subs back and waiting are counted live by the plugin from fleet_subs_view, so they're not here.
CREATE OR REPLACE VIEW fleet_alerts_view AS
WITH settings AS (
  SELECT
    coalesce((SELECT setting_value FROM fleet_economics_settings WHERE setting_key = 'low_ceruleum_threshold'), 0) AS ceruleum,
    coalesce((SELECT setting_value FROM fleet_economics_settings WHERE setting_key = 'low_repair_kit_threshold'), 0) AS repair_kits,
    coalesce((SELECT setting_value::int FROM fleet_economics_settings
              WHERE setting_key = 'house_warn_days' AND setting_value = round(setting_value) AND setting_value BETWEEN 1 AND 44), 7) AS house_days
),
houses AS (
  SELECT DISTINCT ON (fc_id) fc_id, fc_name, has_house
  FROM companion_character_housing WHERE fc_id IS NOT NULL
  ORDER BY fc_id, updated_at DESC
),
visited AS (
  SELECT fc_id, max(house_last_visited) AS last_visited
  FROM companion_character_housing WHERE fc_id IS NOT NULL GROUP BY fc_id
),
house_ages AS (
  SELECT h.fc_id, coalesce(h.fc_name, 'FC ' || h.fc_id) AS fc_name, v.last_visited,
         CASE WHEN v.last_visited IS NOT NULL
              THEN greatest(0, floor(extract(epoch FROM (now() - v.last_visited)) / 86400))::int END AS days
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
SELECT 'warn', 'low_ceruleum', s.who, s.ceruleum || ' ceruleum (warning below ' || st.ceruleum::int || ')', 0
FROM supplies s, settings st WHERE st.ceruleum > 0 AND s.ceruleum < st.ceruleum
UNION ALL
SELECT 'warn', 'low_repair_kits', s.who, s.repair_kits || ' repair kits (warning below ' || st.repair_kits::int || ')', 0
FROM supplies s, settings st WHERE st.repair_kits > 0 AND s.repair_kits < st.repair_kits
UNION ALL
SELECT 'warn', 'not_synced', name || ' (' || world || ')',
       'no longer synced (' || floor(extract(epoch FROM behind) / 3600)::int || ' h behind its account): unticked in the plugin, or its AutoRetainer no longer has it', 0
FROM fleet_not_synced_view
UNION ALL
SELECT 'warn', 'autoretainer', pc_name || CASE WHEN account_label <> '' THEN ' (' || account_label || ')' ELSE '' END,
       'AutoRetainer was not running at its last sync, so nothing syncs from there', 0
FROM companion_pc_status WHERE autoretainer_ready = false AND last_sync_at > now() - interval '1 day'
ORDER BY 1, 2, 5 DESC, 3;


-- 2.x, the rest of the tabs.

-- Every character, as the Roster tab: its Free Company and house, gil, supplies, retainers and subs, when it last
-- synced and on which setup it last logged in (only that one syncs it). behind_minutes: how far it is behind its
-- account when the plugin no longer syncs it (fleet_not_synced_view), else NULL. low_ceruleum / low_repair_kits:
-- below the low-supply warnings, for characters with a built sub that are still synced (as ipc/roster.js, through
-- characters/roster-warnings.js).
CREATE OR REPLACE VIEW fleet_roster_view AS
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
       CAST(coalesce(b.subs_built, 0) AS int) AS subs_built,
       CAST(floor(extract(epoch FROM ns.behind) / 60) AS int) AS behind_minutes,
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

-- Every retainer, as the Retainers tab: its owner, class (job, a ClassJob number) and level, gil, venture (venture_id,
-- a RetainerTask number; venture_ends_at in Unix seconds), gear target, and whether Allagan Tools has seen its items
-- (they're stored, or it was seen holding nothing). The plugin names the class and venture from the game's files.
CREATE OR REPLACE VIEW fleet_retainers_view AS
SELECT rl.retainer_id, rl.owner_cid, c.name AS owner_name, c.world, c.account_label, so.sort_index,
       rl.name AS retainer_name, rl.job, rl.level, rl.gil, rl.has_venture, rl.venture_id, rl.venture_ends_at, rl.hire_order_index,
       t.target_mode, t.target_value, coalesce(t.only_crafted, false) AS only_crafted,
       (rl.items_seen_at IS NOT NULL OR EXISTS (SELECT 1 FROM companion_inventory_snapshot inv
                                                WHERE inv.owner_cid = rl.owner_cid AND inv.retainer_id = rl.retainer_id)) AS items_seen
FROM companion_retainer_lookup rl
LEFT JOIN companion_character_current c ON c.cid = rl.owner_cid
LEFT JOIN retainer_gear_targets t ON t.retainer_id = rl.retainer_id
LEFT JOIN character_sort_order so ON so.cid = rl.owner_cid;

-- What each retainer wears (its equipped items, container 11000), one row per item, for its average item level. The
-- plugin looks up each item's level in the game's files, leaving out any it doesn't know, as the app does.
CREATE OR REPLACE VIEW fleet_retainer_gear_view AS
SELECT retainer_id, item_id FROM companion_inventory_snapshot WHERE sorted_container = 11000 AND item_id IS NOT NULL;

-- Every setup of the plugin (PC and account label), as the PCs tab: its version, when it last synced, which plugins it
-- found, its characters, what it couldn't see (problems, one per line) and its last "Check what I can see".
CREATE OR REPLACE VIEW fleet_pcs_view AS
SELECT pc_name, account_label, plugin_version, last_sync_at, autoretainer_ready, allagantools_ready, fctracker_found,
       submarinetracker_found, venture_stats_found, characters_synced, characters_left_out, characters_elsewhere,
       array_to_string(problems, E'\n') AS problems, check_text, check_to_fix, check_at
FROM companion_pc_status;
