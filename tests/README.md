# Tests

All of these run on GitHub for every pull request, so you only need this page to run them yourself.

There are three kinds:

| Kind | Where | What it checks |
| --- | --- | --- |
| Unit tests | `tests/*.test.js` | The calculations, quickly, with no database. Run `npm test`. |
| Database tests | `tests/db/` | The real queries, updates and backups against a real PostgreSQL. |
| Click-through tests | `tests/ui/` | The real app, started against a test database and clicked through by a script. |

## Before the database and click-through tests

They need a **test** PostgreSQL, never your real one: some of them delete and recreate tables. Point the usual
`PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD` and `PGDATABASE` settings at it. The backup tests also need PostgreSQL's
`pg_dump` and `pg_restore` on the PATH.

## Database tests

```
psql -v ON_ERROR_STOP=1 -v days=30 -f tests/db/generate-metric-history.sql   # 30 days of made-up chart history
node tests/db/verify-metric-series.js       # the chart queries, against an independent calculation
node tests/db/verify-game-data.js           # the game data update, with small made-up tables
node tests/db/verify-column-catalog.js      # the extra table columns, with a tiny hand-checked dataset
node tests/db/verify-database-updates.js    # the app's own database updates (uses databases named dbupd_*)
node tests/db/verify-backups.js             # backups, test and restore (uses bkp_live and fleet_restore_test)
node tests/db/verify-create-database.js     # "New database on this PC" (uses newdb_check, newdb_app and newdb_plain)
node tests/db/verify-speed-check.js          # Settings > Database > Speed check (uses speed_check_new and speed_check_old)
node tests/db/verify-metric-window.js        # the Subs, Supplies and Income history without repeated values (reads only)
node tests/db/verify-venture-totals.js       # venture rewards and their value worked out by the database (uses venture_totals_check)
MOVE_NEW_PORT=5433 node tests/db/verify-database-move.js   # moving the database between two servers (uses move_db* and move_app)
node tests/db/verify-leftovers.js           # finding and removing what a move leaves behind (uses lo_*)
```

The move test needs a **second** test PostgreSQL on `localhost` at `MOVE_NEW_PORT` (5433 by default), with the same
password for its `postgres` login as `PGPASSWORD` (or set `MOVE_NEW_PASSWORD`). It moves a small database from the first
server to the second and back again. If `pg_dump` isn't on the PATH, set `PG_BIN_DIR` to PostgreSQL's `bin` folder.

## Click-through tests

Start from an empty test database:

```
psql -v ON_ERROR_STOP=1 -f db/schema.sql                                      # every table
psql -v ON_ERROR_STOP=1 -v days=30 -f tests/db/generate-metric-history.sql   # chart history
psql -v ON_ERROR_STOP=1 -f tests/ui/fixtures.sql                              # made-up characters, subs, retainers...
node tests/ui/run.js                                                          # all of them
node tests/ui/run.js 35-backups                                               # or just some
```

They open real windows, so on a server without a screen use `xvfb-run node tests/ui/run.js`. Screenshots are saved to
the folder in `UI_TEST_SHOTS` (or your temp folder).
