-- Small made-up data for the rest of the plugin's and app's tables, so the app has something to
-- show next to the generated metric history (tests/db/generate-metric-history.sql, which
-- creates 80 characters with ids 18014498578000000+1..80 and 80 Free Companies).
-- The tables themselves come from db/schema.sql, the same design as the live database. Order:
--   psql -f db/schema.sql; psql -f tests/db/generate-metric-history.sql; psql -f tests/ui/fixtures.sql

-- The old per-sync history that plugins before 0.4.0 wrote (no longer in db/schema.sql). The app still
-- reads it when the current-state table is missing or behind; scenarios 12 and 13 use it, and
-- scenario 14 hides it (as after database version 5).
create table companion_character_snapshot (cid numeric not null, name text, world text, account_label text,
  snapshot_at timestamptz not null default now(), retainer_count int, submarine_count int, gil bigint,
  ceruleum int, repair_kits int, fc_id numeric, num_sub_slots int);
create index companion_character_snapshot_cid_snapshot_at_idx on companion_character_snapshot (cid, snapshot_at desc);
create index companion_character_snapshot_fc_id_cid_snapshot_at_idx on companion_character_snapshot (fc_id, cid, snapshot_at desc);
insert into companion_character_snapshot (cid, name, world, retainer_count, submarine_count, gil, ceruleum, repair_kits, account_label, fc_id, num_sub_slots, snapshot_at)
select 18014498578000000+c, (array['Aki','Bex','Cal','Dara','Eli','Fen','Gus','Hana'])[1+c%8] || ' Kitteh ' || c,
       (array['Maduin','Cuchulainn','Behemoth'])[1+c%3], 4, 4, 1000000, 5000, 300, 'acct'||(c%3), 9000000+c, 4, now()
from generate_series(1,80) c;

-- The current-state table (plugin 0.3.0, database version 4), up to date with the snapshots.
-- Scenario 13 hides it to check the app still reads the snapshot history for an older plugin.
insert into companion_character_current (cid, name, world, account_label, gil, ceruleum, repair_kits, retainer_count, submarine_count, num_sub_slots, fc_id, last_synced_at)
select cid, name, world, account_label, gil, ceruleum, repair_kits, retainer_count, submarine_count, num_sub_slots, fc_id, snapshot_at from companion_character_snapshot;

insert into character_sort_order (cid, sort_index) select 18014498578000000+c, c from generate_series(1,80) c;

-- Houses (every third FC) were entered a few hours ago, as when AutoRetainer runs subs, except FC 3 (9 days:
-- past the 7-day warning), FC 6 (33 days: red), FC 9 (no date from FCTracker) and FC 12 (50 days: past 45).
insert into companion_character_housing(cid, fc_id, fc_name, fc_master, fc_points, fc_rank, total_members, has_house, house_city, house_ward, house_plot, fc_home_world_id, fc_founding_date, house_last_visited)
select 18014498578000000+c, 9000000+c,
       (array['Cute Kittehs!','Best Cats','Floofeh Kitties!','Cutie Kitties!'])[1 + (c % 4)],
       (array['Aki','Bex','Cal','Dara','Eli','Fen','Gus','Hana'])[1+c%8] || ' Kitteh ' || c,
       500000 + (c % 1000)*1000, 5 + (c % 4), 1 + (c % 30), (c % 3 = 0), (array[8, 2, 9, 111])[1 + (c % 4)], 1 + (c % 24), 1 + (c % 60),
       1 + (c % 3), now() - interval '200 days',
       case when c % 3 <> 0 then null
            when c = 3 then now() - interval '9 days 2 hours'
            when c = 6 then now() - interval '33 days 2 hours'
            when c = 9 then null
            when c = 12 then now() - interval '50 days'
            else now() - (c % 5) * interval '1 hour' end
from generate_series(1,80) c;

-- Game tables start with only an id column (db/schema.sql); the game data update adds the rest. Here
-- just the columns the app reads are added.
alter table ffxiv_world add column name text;
insert into ffxiv_world values ('1','Maduin'),('2','Cuchulainn'),('3','Behemoth');
alter table ffxiv_item add column name text, add column level_item text, add column level_equip text,
  add column equip_slot_category text, add column class_job_category text;
insert into ffxiv_item(id, name) select i::text, 'Salvage item '||i from generate_series(22500,22507) i;
insert into ffxiv_item(id, name) values ('10155', 'Ceruleum Tank'), ('21792', 'Shark-class Bridge'), ('22526', 'Whale-class Bridge');

insert into companion_inventory_snapshot (owner_cid, retainer_id, sorted_container, sorted_slot_index, item_id, quantity)
select 18014498578000000+c, 18014498578000000+c, 1000, i - 22500, i, 1 + (c+i)%7 from generate_series(1,80) c, generate_series(22500,22507) i;
insert into companion_fc_inventory_snapshot (fc_id, sorted_container, sorted_slot_index, item_id, quantity)
select 9000000+f, 20000, i - 22500, i, 1 + (f+i)%5 from generate_series(1,30) f, generate_series(22500,22503) i;
-- Ceruleum Tanks (item 10155) in the first 20 Free Company chests
insert into companion_fc_inventory_snapshot (fc_id, sorted_container, sorted_slot_index, item_id, quantity)
select 9000000+f, 20000, 10, 10155, f*10 from generate_series(1,20) f;


-- Retainers: 2 to 4 per character
insert into companion_retainer_lookup(retainer_id, owner_cid, name, job, gil, has_venture, level, hire_order_index)
select 50000000 + c*10 + r, 18014498578000000 + c, 'Retainer ' || c || '-' || r, 8 + (r % 3), 1000 * c + 10 * r, false, 90 - r, r
from generate_series(1,80) c, generate_series(1, 2 + (c % 3)) r;

-- Submarines: 4 per character, ranks 80 to 90, with parts and a route; odd-numbered ones are out on a voyage
-- Named Sub1-Sub4, not the default Submersible-N, so the app has to find them by slot (as for renamed subs).
insert into companion_submarine_snapshot(cid, sub_name, level, part1, part2, part3, part4, points, return_time, current_exp, next_level_exp, slot)
select 18014498578000000+c, 'Sub'||s, 80 + (c+s)%11, 21792, 22526, 23903, 24344, '\x0102'::bytea,
       case when s % 2 = 1 then extract(epoch from now())::bigint + s*3600 else 0 end, 1000*s, 4000, s
from generate_series(1,80) c, generate_series(1,4) s;
insert into sub_craft_toggle(cid, sub_name, craft_enabled) select 18014498578000000+c, 'Sub1', true from generate_series(1,80) c where c % 2 = 0;
insert into sub_build_rules(rank, hull, stern, bow, bridge) values (1, 'S', 'S', 'S', 'S'), (80, 'W', 'W', 'W', 'W');
insert into fight_club_routes(route, hours, repair_times, gil_sub_day, gil_hr, rec_build_notes, unmod_min_rank, min_rank_build)
values ('OJZ', 24, '10', 300000, 12500, '85: WWWW', '85: WWWW', '85: WWWW'), ('OJ', 12, '10', 250000, 10400, '85: SSSS', '85: SSSS', '85: SSSS');
-- Sectors for the rank-up dates: point 0 is the map's starting point; O and J are 500 and 120 apart and
-- give 1,000 and 2,000 experience, with 100- and 50-minute surveys (Z has no position, so is left out).
alter table ffxiv_submarineexploration add column location text, add column exp_reward text, add column survey_durationmin text,
  add column x text, add column y text, add column z text, add column starting_point text;
insert into ffxiv_submarineexploration values ('0', '', '0', '0', '0', '0', '0', 'True'),
  ('1','O', '1000', '100', '300', '400', '0', 'False'), ('2','J', '2000', '50', '300', '400', '120', 'False'), ('3','Z', null, null, null, null, null, 'False');
-- Ranks 1-89 need 10,000 experience each to the next; 90 is the highest.
alter table ffxiv_submarinerank add column speed_bonus text, add column range_bonus text, add column exp_to_next text;
insert into ffxiv_submarinerank (id, speed_bonus, range_bonus, exp_to_next)
select r::text, (r * 2)::text, (r)::text, (case when r < 90 then 10000 else 0 end)::text from generate_series(1,90) r;
alter table ffxiv_submarinepart add column "class" text, add column slot text, add column speed text, add column range text;
insert into ffxiv_submarinepart (id, "class", slot, speed, range) select (cl * 4 + sl)::text, cl::text, sl::text, '10', '5' from generate_series(1,10) cl, generate_series(0,3) sl;

-- Retainer look-ups used by the Retainers tab
alter table ffxiv_classjob add column abbreviation text;
insert into ffxiv_classjob values ('8','CRP'),('9','BSM'),('10','ARM');
alter table ffxiv_retainertask add column is_random text, add column task text;
alter table ffxiv_retainertaskrandom add column name text;
alter table ffxiv_retainertasknormal add column item text;

-- Recipes for the shopping list (Parts → Shopping List), with the column names a game data update gives
-- them. Made-up materials. Each Whale-class part (22526-22528) is built at the FC workshop in two phases:
-- phase 1 = 1 Test Ingot + 1 Test Lumber, phase 2 = 1 Test Ingot + 2 sets of 1 Fire Shard. Test Ingot =
-- 3 Test Ore + 1 Fire Shard (Blacksmith); Test Lumber = 2 Test Log, makes 2 (Carpenter).
alter table ffxiv_companycraftsequence add column result_item text, add column company_craft_part0 text, add column company_craft_part1 text;
alter table ffxiv_companycraftpart add column company_craft_process0 text, add column company_craft_process1 text, add column company_craft_process2 text;
alter table ffxiv_companycraftprocess add column supply_item0 text, add column supply_item1 text,
  add column set_quantity0 text, add column set_quantity1 text, add column sets_required0 text, add column sets_required1 text;
alter table ffxiv_companycraftsupplyitem add column item text;
insert into ffxiv_companycraftsequence values ('1', '22526', '0', '1'), ('2', '22527', '1', '0'), ('3', '22528', '1', '0');
insert into ffxiv_companycraftpart values ('1', '1', '2', '0');
insert into ffxiv_companycraftprocess values ('1', '1', '2', '1', '1', '1', '1'), ('2', '1', '3', '1', '1', '1', '2');
insert into ffxiv_companycraftsupplyitem values ('1', '5001'), ('2', '5002'), ('3', '2');
alter table ffxiv_recipe add column craft_type text, add column item_result text, add column amount_result text,
  add column ingredient_0 text, add column ingredient_1 text, add column ingredient_2 text, add column ingredient_3 text,
  add column ingredient_4 text, add column ingredient_5 text, add column ingredient_6 text, add column ingredient_7 text,
  add column amount_ingredient_0 text, add column amount_ingredient_1 text, add column amount_ingredient_2 text,
  add column amount_ingredient_3 text, add column amount_ingredient_4 text, add column amount_ingredient_5 text,
  add column amount_ingredient_6 text, add column amount_ingredient_7 text;
insert into ffxiv_recipe (id, craft_type, item_result, amount_result, ingredient_0, amount_ingredient_0, ingredient_1, amount_ingredient_1,
                          ingredient_2, amount_ingredient_2, ingredient_3, amount_ingredient_3, ingredient_4, amount_ingredient_4,
                          ingredient_5, amount_ingredient_5, ingredient_6, amount_ingredient_6, ingredient_7, amount_ingredient_7) values
  ('90100', '1', '5001', '1', '5003', '3', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '2', '1', '0', '0'),
  ('90101', '0', '5002', '2', '5004', '2', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0');
insert into ffxiv_item(id, name) values ('2', 'Fire Shard'), ('5001', 'Test Ingot'), ('5002', 'Test Lumber'),
  ('5003', 'Test Ore'), ('5004', 'Test Log'), ('22527', 'Whale-class Bridge 2'), ('22528', 'Whale-class Hull');
-- Held: 7 Test Ingot in Free Company 9000001's chest, 10 Test Ore in a retainer's bag and 5 in the
-- character's bags, 40 Fire Shards in the crystal bag, and 99 Test Ore listed on the market (not counted).
insert into companion_fc_inventory_snapshot (fc_id, sorted_container, sorted_slot_index, item_id, quantity)
values (9000001, 20001, 0, 5001, 7);
insert into companion_inventory_snapshot (owner_cid, retainer_id, sorted_container, sorted_slot_index, item_id, quantity) values
  (18014498578000001, 50000011, 10000, 0, 5003, 10),
  (18014498578000001, 18014498578000001, 0, 0, 5003, 5),
  (18014498578000001, 18014498578000001, 2001, 0, 2, 40),
  (18014498578000001, 50000011, 12002, 0, 5003, 99);
-- Vendors (GilShopItem) sell Test Ingot for 100 gil and Test Log for 5 gil (the price is the item's PriceMid).
alter table ffxiv_gilshopitem add column item text;
insert into ffxiv_gilshopitem values ('262144.0', '5001'), ('262144.1', '5004'), ('262145.0', '5001');
alter table ffxiv_item add column price_mid text;
update ffxiv_item set price_mid = '100' where id = '5001';
update ffxiv_item set price_mid = '5' where id = '5004';
update ffxiv_item set price_mid = '50' where id = '5003';
