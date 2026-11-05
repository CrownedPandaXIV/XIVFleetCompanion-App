# Database updates

When a new version of the plugin or the app needs a change to the database (a new table, a new column), it goes here.
The app applies it to every database by itself the next time it connects, so nobody has to run anything by hand.

## Adding one

1. Make a file named with the next number and what it does, for example `010_add_crafting_log.sql`. (Numbers 001 to 009
   were the plugin's old `sql/` scripts, and are already covered.)
2. Make the same change in `db/schema.sql`, so a brand-new database gets it too.
3. Write it so it's safe to run twice: `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`. Restoring an older
   backup runs it again.
4. Leave out `BEGIN` and `COMMIT`. The app wraps each file in its own transaction, so a file is applied completely or
   not at all.

Once a file has been released, don't change it. Fix a mistake with the next number instead.

## How the app keeps track

The `companion_schema_version` table lists every update a database has. On an empty database the app runs
`db/schema.sql` and records it as up to date. On a database made before any of this existed, it adds anything still
missing (`db/catch-up.sql`) and records version 9. Then it applies any newer files from this folder, in order.

If two copies of the app connect at the same moment, they take turns.

## Views: db/views.sql, not here

The ready-made views plugin 2.0 reads (`fleet_*_view`) live in `db/views.sql`, not in this folder, because they change
often as more of the app's numbers move into the database. After the numbered updates, the app compares that file's
checksum with the one recorded in `companion_views` and, when they differ, replaces the views in one transaction. So
edit `db/views.sql` freely, and don't add a numbered update for a view. An older app never replaces a newer app's views,
and a login that may only read keeps the views it has. Tables and data still change only through numbered updates.

