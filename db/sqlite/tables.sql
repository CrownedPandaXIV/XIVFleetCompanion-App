-- A first draft of the tables the plugin-only one-file version (SQLite) will need, for now only those the fleet views
-- read, so the views can be checked on SQLite as well as PostgreSQL (tests/db/verify-sqlite-views.js). Nothing uses
-- this file yet; the one-file version itself comes near the end of 2.x.
--
-- How PostgreSQL's types are kept here:
--   character and retainer ids              INTEGER (they fit in a signed 64-bit number)
--   Free Company ids                         TEXT: the game's go past a signed 64-bit number (up to 18,446,744,073,709,551,615),
--                                            which is all SQLite's INTEGER holds; it would keep them as rounded REALs
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
    fc_id           TEXT,     -- see below: too big for INTEGER
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
    cid                     INTEGER PRIMARY KEY,
    fc_id                   TEXT,
    fc_name                 TEXT,
    fc_points               INTEGER,
    fc_rank                 TEXT,
    total_members           INTEGER,
    has_house               INTEGER,
    house_city              INTEGER,
    house_ward              INTEGER,
    house_plot              INTEGER,
    house_last_visited      REAL,
    updated_at              REAL NOT NULL,
    fc_master               TEXT,
    fc_home_world_id        INTEGER,
    fc_founding_date        REAL,
    fc_eligibility_override REAL
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

CREATE TABLE companion_fc_inventory_snapshot (
    fc_id             TEXT    NOT NULL,
    sorted_container  INTEGER NOT NULL,
    sorted_slot_index INTEGER NOT NULL,
    item_id           INTEGER NOT NULL,
    quantity          INTEGER NOT NULL,
    updated_at        REAL,
    PRIMARY KEY (fc_id, sorted_container, sorted_slot_index)
);

CREATE TABLE companion_inventory_type_lookup (
    sorted_container INTEGER PRIMARY KEY,
    display_name     TEXT NOT NULL
);
INSERT INTO companion_inventory_type_lookup (sorted_container, display_name) VALUES
    (0, 'Inventory 1'),
    (1, 'Inventory 2'),
    (2, 'Inventory 3'),
    (3, 'Inventory 4'),
    (1000, 'GearSet0'),
    (1001, 'GearSet1'),
    (2000, 'Currency'),
    (2001, 'Crystal'),
    (2003, 'Mail'),
    (2004, 'KeyItem'),
    (2005, 'HandIn'),
    (2007, 'DamagedGear'),
    (2008, 'UNKNOWN_2008'),
    (2009, 'Examine'),
    (2500, 'Armoire'),
    (2501, 'GlamourChest'),
    (2502, 'FreeCompanyCurrency'),
    (3200, 'ArmoryOff'),
    (3201, 'ArmoryHead'),
    (3202, 'ArmoryBody'),
    (3203, 'ArmoryHand'),
    (3204, 'ArmoryWaist'),
    (3205, 'ArmoryLegs'),
    (3206, 'ArmoryFeet'),
    (3207, 'ArmoryEar'),
    (3208, 'ArmoryNeck'),
    (3209, 'ArmoryWrist'),
    (3300, 'ArmoryRing'),
    (3400, 'ArmorySoulCrystal'),
    (3500, 'ArmoryMain'),
    (4000, 'Saddlebag 1'),
    (4001, 'Saddlebag 2'),
    (4100, 'Premium Saddlebag 1'),
    (4101, 'Premium Saddlebag 2'),
    (10000, 'Retainer Bag 1'),
    (10001, 'Retainer Bag 2'),
    (10002, 'Retainer Bag 3'),
    (10003, 'Retainer Bag 4'),
    (10004, 'Retainer Bag 5'),
    (10005, 'Retainer Bag (unused 6)'),
    (10006, 'Retainer Bag (unused 7)'),
    (11000, 'RetainerEquippedGear'),
    (12000, 'RetainerGil'),
    (12001, 'RetainerCrystal'),
    (12002, 'RetainerMarket'),
    (20000, 'FC Chest 1'),
    (20001, 'FC Chest 2'),
    (20002, 'FC Chest 3'),
    (20003, 'FC Chest 4'),
    (20004, 'FC Chest 5'),
    (20005, 'FC Chest 6'),
    (20006, 'FC Chest 7'),
    (20007, 'FC Chest 8'),
    (20008, 'FC Chest 9'),
    (20009, 'FC Chest 10'),
    (20010, 'FC Chest 11'),
    (22000, 'FreeCompanyGil'),
    (22001, 'FreeCompanyCrystal'),
    (25000, 'HousingExteriorAppearance'),
    (25001, 'HousingExteriorPlacedItems'),
    (25002, 'HousingInteriorAppearance'),
    (25003, 'HousingInteriorPlacedItems1'),
    (25004, 'HousingInteriorPlacedItems2'),
    (25005, 'HousingInteriorPlacedItems3'),
    (25006, 'HousingInteriorPlacedItems4'),
    (25007, 'HousingInteriorPlacedItems5'),
    (25008, 'HousingInteriorPlacedItems6'),
    (25009, 'HousingInteriorPlacedItems7'),
    (25010, 'HousingInteriorPlacedItems8'),
    (25011, 'HousingInteriorPlacedItems9'),
    (25012, 'HousingInteriorPlacedItems10'),
    (25013, 'HousingInteriorPlacedItems11'),
    (25014, 'HousingInteriorPlacedItems12'),
    (25200, 'HousingExteriorPlacedItems2'),
    (27000, 'HousingExteriorStoreroom'),
    (27001, 'HousingInteriorStoreroom1'),
    (27002, 'HousingInteriorStoreroom2'),
    (27003, 'HousingInteriorStoreroom3'),
    (27004, 'HousingInteriorStoreroom4'),
    (27005, 'HousingInteriorStoreroom5'),
    (27006, 'HousingInteriorStoreroom6'),
    (27007, 'HousingInteriorStoreroom7'),
    (27008, 'HousingInteriorStoreroom8'),
    (27009, 'HousingInteriorStoreroom9'),
    (27010, 'HousingInteriorStoreroom10'),
    (27011, 'HousingInteriorStoreroom11'),
    (27200, 'HousingExteriorStoreroom2');
