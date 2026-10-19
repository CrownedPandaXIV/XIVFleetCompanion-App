-- Builds a year of synthetic metric history (about 12 million rows, 80 characters, 80 Free
-- Companies) in an EMPTY scratch database, to test the trend chart queries at realistic size.
-- Never run this against your real database.
--
-- Size: a year of history by default. For a small, quick dataset (used by the automatic tests) pass
-- a number of days:   psql -d scratch -v days=30 -f tests/db/generate-metric-history.sql
--   createdb scratch && psql -d scratch -f tests/db/generate-metric-history.sql
-- Takes a few minutes and about 2 GB.

\if :{?days}
\else
  \set days 365
\endif

CREATE TABLE IF NOT EXISTS companion_metric_history (
    recorded_at timestamptz NOT NULL DEFAULT now(), subject_type text NOT NULL,
    subject_id numeric NOT NULL, metric text NOT NULL, value numeric NOT NULL, label text);
CREATE INDEX IF NOT EXISTS companion_metric_history_subject_idx
    ON companion_metric_history (subject_type, subject_id, metric, recorded_at DESC);
CREATE INDEX IF NOT EXISTS companion_metric_history_metric_idx
    ON companion_metric_history (metric, recorded_at DESC);
CREATE TABLE IF NOT EXISTS companion_metric_latest (
    subject_type text NOT NULL, subject_id numeric NOT NULL, metric text NOT NULL,
    value numeric NOT NULL, recorded_at timestamptz NOT NULL, label text,
    PRIMARY KEY (subject_type, subject_id, metric));

-- The value of a series after k changes. Used for BOTH the hourly markers and the change
-- rows, so they agree. Gil rises with wobble, ceruleum and repair kits deplete and refill,
-- salvage counts cycle, FC points rise.
CREATE OR REPLACE FUNCTION metric_value(m text, base numeric, step numeric, k numeric) RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN m = 'gil' THEN base + step * k + step * 3 * (((k * 7919)::bigint % 17) - 8)
    WHEN m = 'ceruleum' THEN base - ((k * 37)::bigint % 4000)
    WHEN m = 'repair_kits' THEN base - (k::bigint % 250)
    WHEN m LIKE 'item_qty:%' THEN base + ((k * 3)::bigint % 40)
    ELSE base + step * k
  END $$;

-- one row per (subject, metric) with how often its value changes (minutes) and by how much
create temp table series as
select 'character'::text st, (18014498578000000 + c)::numeric sid, m.metric, m.period + (c % 5) * 15 as period, m.base * (1 + (c % 9) / 10.0) as base, m.step * (1 + (c % 7) / 4.0) as step
from generate_series(1,80) c,
     (values ('gil',90,1000000,1500),('ceruleum',400,5000,-7),('repair_kits',2880,300,-1),
             ('fc_points',720,500000,900),
             ('item_qty:22500',1440,3,1),('item_qty:22501',1440,2,1),('item_qty:22502',1440,5,1),('item_qty:22503',1440,1,2),
             ('item_qty:22504',1440,4,1),('item_qty:22505',1440,6,1),('item_qty:22506',1440,2,2),('item_qty:22507',1440,7,1)) m(metric,period,base,step)
union all
select 'fc', (9000000 + f)::numeric, m.metric, m.period + (f % 5) * 15, m.base * (1 + (f % 9) / 10.0), m.step * (1 + (f % 7) / 4.0)
from generate_series(1,80) f,
     (values ('fc_points',720,500000,900)) m(metric,period,base,step)
union all
select 'fc', (9000000 + f)::numeric, 'item_qty:'||i, 1440, 10+f%7, 3
from generate_series(1,28) f, generate_series(22500,22507) i;

-- hourly markers (time-major, like the plugin writes): the value after the changes so far
insert into companion_metric_history (recorded_at, subject_type, subject_id, metric, value)
select ts, s.st, s.sid, s.metric, metric_value(s.metric, s.base, s.step, floor((:days * 24 - h) * 60.0 / s.period))
from generate_series(:days * 24 - 1, 0, -1) h
cross join lateral (select now() - h * interval '1 hour' as ts) x
join series s on true;

-- the change rows themselves, at the exact change instants
insert into companion_metric_history (recorded_at, subject_type, subject_id, metric, value)
select now() - (:days * 1440 - k*s.period) * interval '1 minute', s.st, s.sid, s.metric, metric_value(s.metric, s.base, s.step, k)
from series s, lateral generate_series(1, floor(:days * 1440.0 / s.period)::int) k
where :days * 1440 - k*s.period >= 0;

insert into companion_metric_latest (subject_type, subject_id, metric, value, recorded_at)
select distinct on (subject_type, subject_id, metric) subject_type, subject_id, metric, value, recorded_at
from companion_metric_history order by subject_type, subject_id, metric, recorded_at desc;

vacuum analyze companion_metric_history; vacuum analyze companion_metric_latest;
select count(*) as history_rows, pg_size_pretty(pg_total_relation_size('companion_metric_history')) as size_with_indexes from companion_metric_history;
select count(*) as latest_rows from companion_metric_latest;
