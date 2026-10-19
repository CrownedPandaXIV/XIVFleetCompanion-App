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
