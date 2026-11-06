-- A first draft of the tables the plugin-only one-file version (SQLite) will need, for now only those the fleet views
-- read, so the views can be checked on SQLite as well as PostgreSQL (tests/db/verify-sqlite-views.js). Nothing uses
-- this file yet; the one-file version itself comes near the end of 2.x.
--
-- How PostgreSQL's types are kept here:
--   numeric ids (characters, FCs, retainers)  INTEGER (they fit in 64 bits)
--   timestamptz / timestamp                    REAL, Unix seconds (fractions allowed), so times can be subtracted
--   boolean                                    INTEGER, 0 or 1
--   text[] (a setup's problems)                TEXT, one per line
--   numeric values and settings                REAL

CREATE TABLE companion_character_current (
    cid             INTEGER PRIMARY KEY,
    name            TEXT,
    world           TEXT,
    account_label   TEXT,
    gil             INTEGER,
    ceruleum        INTEGER,
    repair_kits     INTEGER,
    retainer_count  INTEGER,
    submarine_count INTEGER,
    num_sub_slots   INTEGER,
    fc_id           INTEGER,
    first_seen_at   REAL NOT NULL,
    last_synced_at  REAL NOT NULL
);

CREATE TABLE character_sort_order (
    cid        INTEGER PRIMARY KEY,
    sort_index INTEGER NOT NULL,
    updated_at REAL
);

CREATE TABLE companion_submarine_snapshot (
    cid            INTEGER NOT NULL,
    sub_name       TEXT    NOT NULL,
    level          INTEGER,
    part1          INTEGER,
    part2          INTEGER,
    part3          INTEGER,
    part4          INTEGER,
    return_time    INTEGER,  -- Unix seconds
    updated_at     REAL,
    current_exp    INTEGER,
    next_level_exp INTEGER,
    slot           INTEGER,
    PRIMARY KEY (cid, sub_name)
);

CREATE TABLE companion_metric_history (
    recorded_at  REAL    NOT NULL,
    subject_type TEXT    NOT NULL,
    subject_id   INTEGER NOT NULL,
    metric       TEXT    NOT NULL,
    value        REAL    NOT NULL,
    label        TEXT
);
CREATE INDEX companion_metric_history_subject_idx ON companion_metric_history (subject_type, subject_id, metric, recorded_at);

CREATE TABLE fleet_economics_settings (
    setting_key   TEXT PRIMARY KEY,
    setting_value REAL,
    updated_at    REAL
);

CREATE TABLE companion_retainer_lookup (
    retainer_id       INTEGER PRIMARY KEY,
    owner_cid         INTEGER NOT NULL,
    name              TEXT    NOT NULL,
    updated_at        REAL,
    job               INTEGER,
    gil               INTEGER,
    has_venture       INTEGER,
    venture_id        INTEGER,
    venture_begins_at INTEGER,
    venture_ends_at   INTEGER,
    level             INTEGER,
    hire_order_index  INTEGER,
    items_seen_at     REAL
);

CREATE TABLE companion_character_housing (
    cid                INTEGER PRIMARY KEY,
    fc_id              INTEGER,
    fc_name            TEXT,
    fc_points          INTEGER,
    has_house          INTEGER,
    house_city         INTEGER,
    house_ward         INTEGER,
    house_plot         INTEGER,
    house_last_visited REAL,
    updated_at         REAL NOT NULL
);

CREATE TABLE housing_key_city_lookup (
    city_id   INTEGER PRIMARY KEY,
    city_name TEXT NOT NULL
);
INSERT INTO housing_key_city_lookup (city_id, city_name) VALUES
    (2, 'Lavender Beds'), (8, 'Mist'), (9, 'Goblet'), (70, 'Empyreum'), (111, 'Shirogane');

CREATE TABLE companion_character_login (
    cid           INTEGER PRIMARY KEY,
    pc_name       TEXT NOT NULL,
    account_label TEXT NOT NULL,
    logged_in_at  REAL NOT NULL
);

CREATE TABLE companion_pc_status (
    pc_name                TEXT NOT NULL,
    account_label          TEXT NOT NULL DEFAULT '',
    plugin_version         TEXT,
    last_sync_at           REAL,
    autoretainer_ready     INTEGER,
    allagantools_ready     INTEGER,
    fctracker_found        INTEGER,
    submarinetracker_found INTEGER,
    venture_stats_found    INTEGER,
    characters_synced      INTEGER,
    characters_left_out    INTEGER,
    characters_elsewhere   INTEGER,
    problems               TEXT,
    check_text             TEXT,
    check_to_fix           INTEGER,
    check_at               REAL,
    PRIMARY KEY (pc_name, account_label)
);

CREATE TABLE companion_inventory_snapshot (
    owner_cid         INTEGER NOT NULL,
    retainer_id       INTEGER NOT NULL,
    sorted_container  INTEGER NOT NULL,
    sorted_slot_index INTEGER NOT NULL,
    item_id           INTEGER,
    quantity          INTEGER,
    updated_at        REAL,
    PRIMARY KEY (owner_cid, retainer_id, sorted_container, sorted_slot_index)
);

CREATE TABLE retainer_gear_targets (
    retainer_id  INTEGER PRIMARY KEY,
    target_mode  TEXT CHECK (target_mode IN ('level', 'ilvl')),
    target_value INTEGER,
    only_crafted INTEGER NOT NULL DEFAULT 0,
    updated_at   REAL
);
