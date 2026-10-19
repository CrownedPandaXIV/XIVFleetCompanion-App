# Changelog

All notable changes to the app are recorded here. Versions follow
[Semantic Versioning](https://semver.org): MAJOR.MINOR.PATCH.

## 1.4.0 - 2026-10-19

No database or plugin change.

- **Market board prices on the Shopping List** (with Live Market Prices on in Settings → General). A **Prices from**
  choice picks where they come from: one world your characters are on, a data center, or a region (NA, EU, JP,
  OCE). It starts on the data center with the most of your characters and is remembered on each PC. For a data
  center or region, each price says which world it is on. Each sub part shows its cheapest listing, what it costs
  to make (its materials each at their cheapest: a vendor, the market board, or making them) and which is
  cheaper; materials show their cheapest listing too. Totals say what buying the parts not made yet, and every
  material still short, would cost. Your own retainers' listings are left out. With Look ahead on, the parts
  coming up are priced too.
- **The nightly backup also saves the subs' Next Rank dates,** so the Subs tab's forecast line gets at least one
  set a day even when no app window is open. It runs after the backup and never changes how the backup went.

## 1.3.0 - 2026-10-19

Adds one database table, which the app sets up by itself (database update 11). No plugin change.

- **How close the Next Rank dates come,** on one line at the top of the Subs tab, next to Columns: for example
  "Next Rank forecasts: within 3 hours on average over the last 12 rank-ups". The app saves each sub's Next Rank
  date every hour while it is open, then compares it with when the sub really ranked up (from the return of the
  voyage that brought it, with Submarine Tracker; otherwise from when the plugin recorded the new rank). The
  average counts dates worked out a day or more before, early or late. Hover lists each recent rank-up: what was
  said, what happened, and how far ahead it was said. Dates are kept 30 days.
- **Look ahead on the Parts tab,** so parts can be bought or crafted before a sub needs them: Now only (as
  before), 3, 7 or 14 days. It adds the parts of each sub's next build (the Subs tab's Next Build) due within
  that time. Summary splits the count into Needed Now and Coming Up; Detail has a Due column ("now", or "in 4d
  2h (Thu, Oct 23)"); the Shopping List includes them. Spares go to what is needed now first, across every
  character, and an old part a later upgrade frees is only counted for a need after it. Remembered on each PC.
  The Discord alerts and summary still only count what is needed now.
- Shopping List **Made** ticks are kept when Look ahead is changed.

## 1.2.0 - 2026-10-19

No database or plugin change.

- **Next Build from Fight Club** when a sub's Sub Rules have no change ahead: the first rank where Fight Club's
  best option needs a different build and makes more gil a day, after repair kits, than the sub does now. For
  example "WSUC+ at 92 · in 6d 4h", or "· now" when it is already unlocked. Hover says the route, its gil a day
  after repair kits, and how much more that is than now. Your Sub Rules still come first wherever they say
  something.
- **Target Route picks the most gil a day after repair kits,** at your repair kit price, instead of Fight Club's
  Gil/Hr column, which leaves repair kits out. Target Route, Next Build and the parts a Craft? sub needs (Parts,
  Shopping List) now always agree.

## 1.1.0 - 2026-10-19

No database or plugin change. More accurate with Submarine Tracker, but works without it.

- **Next Rank and Next Build are worked out voyage by voyage,** the way the game gives experience, instead of from
  the last week's average. Each voyage gives its route's experience (from game data) times the sub's own bonus,
  measured from its last few voyages against the routes they ran (Submarine Tracker records those). Voyages get
  shorter as the sub ranks up, and once its Sub Rules switch it to faster parts, so a sub that earns more and
  more over time is followed instead of averaged. Right after a route change the date follows the new route
  straight away; the 7-day average took a week to catch up. Hover shows the working, like "4,500 experience a
  voyage on its route, including its bonus (×1.50 from its last 4 voyages), 14.9h each".
- Until a sub has a few voyages recorded, its date is calculated from game data alone and marked ≈, as before.
  The last week's average is only used when its route or speed can't be worked out.

## 1.0.1 - 2026-10-19

No database or plugin change.

- **Next Rank and Next Build line up with the sub's return.** A sub only gains experience when its voyage is
  collected, so one out at sea can't rank up before it is back. A date worked out from the last week's experience
  is now the sub's return when that comes later, or the first return after it; hover says so. Before, a sub back
  in 37 hours could show "in 14h".
- **Current Route shows its map:** a dimmed number before the letters, like "1 · O-J", with the map's name on hover
  (every map uses the same letters). Needs the game data's Map column, which a game data update brings.
- **Sorting by Status goes by return time,** across the whole fleet: subs back and waiting first (longest waiting
  first), then subs out at sea (soonest back first), then subs in port. Before, it sorted by the words.

## 1.0.0 - 2026-10-19

The first stable release. Nothing changed since 0.36.2; works with plugin 0.14.0 or newer, and with plugin 1.0.0.

## 0.36.2 - 2026-10-19

No database change. Works with plugin 0.14.0 or newer.

- **A tidier log:** the Discord alert check, which runs every 5 minutes, no longer writes two lines to the app's log
  each time (it keeps its own alerts.log). Its warnings and errors still go to the app's log.
- **Windows shows a publisher:** Installed apps lists the app as published by CrownedPandaXIV.
- **"Report a problem" tags the report as a bug,** a label GitHub has, so reports are easy to find.
- **Database Connection** instead of "Postgres Connection" in Settings → Database, as in the plugin and the guides.
- Electron, the framework the app is built on, is updated to 44.9.0 with its latest security fixes.
- Removed two leftover lookups nothing used any more, and unused names in the tests.
- README: the Parts row says where the build rules are (**Show Rules**), and the developer notes list the newer files.

## 0.36.1 - 2026-10-19

No database or plugin change.

- **Settings → General → Updates:** this app's version, what the update check is doing ("Looking for a new version",
  "Downloading version 0.36.2 (45%)", "Up to date", or why it couldn't look, in plain words), and a **Check for
  updates** button.
- The app now looks for a new version every hour instead of every 6 hours, as well as when it starts.
- The app's log notes what the update check finds: a new version, when it's downloaded, or why it couldn't look.

## 0.36.0 - 2026-10-19

No database or plugin change.

- **Restore from a file...** (Settings → Backups) restores a backup kept anywhere, such as a USB drive or another PC's
  backup folder. It checks the file is really a backup of the app's database first, and backs up the database as it
  is now before restoring, as Restore does.
- **If the database PC dies:** the README says how to get everything back on another PC from a backup. Tested from
  start to finish: a backup from one server restored onto a brand-new database on another, every table and row back.
- **The app keeps a log:** what it does (database updates, Set up this PC, moving the database, Remove everything,
  restores, update checks) and any errors go to `app.log` in its settings folder. Never more than two small files,
  and never a password.
- **Found a problem?** in Settings → Setup Help: a button to report it on the app's GitHub page, the app's version to
  copy, what to include, and **Open the log folder**.

## 0.35.5 - 2026-10-19

No database or plugin change.

- The app is now free software under the GNU Affero General Public License v3, the same license as the plugin. The
  license comes with the app and is in the README.

## 0.35.4 - 2026-10-19

No database change. **Needs plugin 0.14.0 or newer:** the PCs tab now flags older ones, since they can't follow a
database move.

- **The "database moved" bar keeps up.** If this PC can't reach the database's new address, the bar now appears
  straight away, and goes once that's sorted, without restarting the app. Before, it was always one step behind.
- **Remove everything on a PC the database moved away from** now removes the copy left behind there. If the app
  installed PostgreSQL, PostgreSQL goes too, with the access for other PCs. Otherwise just the copy, its login and
  that access. Before, it left them all and said the app hadn't installed PostgreSQL.
- **Remove everything** says "PostgreSQL isn't running on this PC" in plain words when nothing answers, instead of a
  technical error.
- Tidied away the old code that moved a `config.json` from very early versions into the saved settings.

## 0.35.3 - 2026-10-19

No database or plugin change.

- **Leftovers from moving the database:**
  - After **Remove PostgreSQL from this PC**, the section shows only that it's done. It's gone the next time
    Settings opens, since there's nothing left to look in.
  - When nothing answers on this PC (PostgreSQL removed, stopped, or on another port), it now says "PostgreSQL isn't
    running on this PC, or it has been removed" instead of a message about letting other PCs connect.

## 0.35.2 - 2026-10-19

No database or plugin change.

- **Leftovers from moving the database** (Settings → Database, on a PC with PostgreSQL). Type the master password and
  click **Look for leftovers** to list what a move left behind: the copy on the PC it moved away from, and a database
  that was already on the PC it moved to under the same name (kept as `..._before_move_...`). Each has a **Remove**
  button, which asks first. The database the app uses is never listed, and only databases that are leftovers right
  now can be removed.
- **PostgreSQL itself can go** when only leftovers are in it and the app installed it (for example a PC the database
  was moved to and back from). One Windows permission prompt; the app stays.
- **The move deletes PostgreSQL's installer** (about 350 MB) once it's installed, as Set up this PC already did.

## 0.35.1 - 2026-10-19

No database or plugin change.

- **Moving the database no longer gets stuck at "Pause the plugins".** After the pause, the move waits for any
  sync still running. It counted every open plugin connection as a running sync, but the plugin keeps a finished
  connection open, idle, for a few minutes so it can reuse it. So the count never reached zero, and after 3 minutes
  the move gave up (and put everything back, as it should). Now only a connection that is doing something, or did
  in the last 15 seconds, counts. The move test now keeps an idle plugin connection open the whole time.

## 0.35.0 - 2026-10-19

Adds database update 10, which the app applies by itself. Works with any plugin version; moving the database needs
plugin 0.14.0 or newer on every PC that syncs.

- **Move the database to another PC** (Settings → Database → Move the database to this PC). Run it on the new PC,
  with its app connected to the database where it is now. The app:
  - checks first that every PC that synced in the last two weeks runs plugin 0.14.0 or newer and uses the app's
    login, and says what to do if one doesn't;
  - installs PostgreSQL if the new PC doesn't have it, and lets your other PCs connect to it (one Windows permission
    prompt);
  - makes the same database and login on the new PC, so nobody has to type a password again;
  - pauses the plugins and waits for any sync still running, then copies everything in one consistent snapshot;
  - checks every table on the new PC has exactly the rows it had, and only then leaves the new address in the old
    database.

  If any step fails, everything is put back and stays on the old database. The old database is never deleted. A
  database already on the new PC under the same name is kept under another name if it's empty or an old copy left
  by an earlier move; otherwise the move is refused.
- **Every app follows a move by itself.** Each app checks once a minute (and before a backup or an alert check)
  whether its database has moved, and switches to the new address when it answers. If it can't reach it, a banner
  says so and it keeps trying.
- **The PCs tab says which PCs haven't switched yet** after a move, and when they all have.

## 0.34.6 - 2026-10-19

No database or plugin change.

- **Income and Summary load faster.** The speed check's detail showed that most of their time was the
  venture rewards: 16,289 item totals (1.8 MB) sent from the database PC, which took 1.5 seconds. With live
  prices off, the database PC now works out each character's rewards, retainers, value at vendor prices and
  three most valuable items itself, and sends about one row per character. The item prices are no longer
  needed for those rewards either.
- **The numbers are the same.** A new test checks every character's figures and top 3 items against working
  them out from every single reward, including salvage, blank prices and items missing from the game data. When
  two items are worth the same, the one with the lower item number now always comes first.
- **With live prices on,** the rewards still come item by item, because each item is priced on the market.

## 0.34.5 - 2026-10-19

No database or plugin change.

- **Speed Check shows where Income and Summary spend their time.** After the tabs are timed, it runs the work
  behind those two tabs (Income's own figures, sub loot and venture rewards, and the Subs data they share) and
  times every question it asks the database. The screen shows each part and its slowest questions, and
  **Copy results** includes the full list. That names the exact question to make faster next. It only reads.

## 0.34.4 - 2026-10-19

No database or plugin change.

- **Income and Summary load faster.** After 0.34.3 they were still the slowest tabs, at about 3.5 seconds.
  They downloaded every single retainer venture reward in the period, often thousands, only to add them up.
  Now the database PC adds them up per character, item and quality (normal or high quality), and sends one
  total per item.
- **The numbers are the same.** New tests check that the totals match adding up every reward one by one:
  reward counts, retainers, item amounts, vendor values and market values.

## 0.34.3 - 2026-10-19

No database or plugin change.

- **Income, Summary, Supplies and Subs load much faster.** The speed check showed these were the slow tabs
  (Income took 20 seconds). They read the long-term history: gil, salvage, ceruleum, repair kits and sub
  experience. Alongside each change, the plugin records the same value again every hour, and these tabs fetched
  all of it from the database PC.
- **Only the changes are sent now.** The database PC drops the repeats first, keeping each change and the first
  and newest values, so 12 to 19 times fewer values travel. The database also finds them faster, through an
  index it already had.
- **The numbers are the same.** New tests run every calculation on these tabs with and without the repeats
  and get the same results, and check the database's answer against the full history.

## 0.34.2 - 2026-10-18

No database or plugin change.

- **Speed Check** stopped with `relation "companion_character_snapshot" does not exist` on a database without
  the old character history table, which includes every newer database. It now only asks about that table where
  it exists. A new test runs it against a database made the way the app makes one.

## 0.34.1 - 2026-10-18

No database or plugin change.

- **Restart to update** says what happens next: the app closes, the installer shows its progress, and the app
  opens again by itself when it's done. The installer can take a minute to appear after the app closes, which
  looked like nothing was happening. The installer now always shows its progress window and reopens the app.
  This applies to updates from this version on.

## 0.34.0 - 2026-10-18

No database or plugin change.

- **Settings → Database → Speed Check**, for when tabs are slow to load. It measures:
  - how long connecting to the database takes (every tab connects afresh);
  - how long one question to it takes;
  - whether Tailscale reaches the database PC directly or through its relay server;
  - whether characters are read the fast way (the plugin's current table) or the slow way (the whole history),
    and why;
  - how big the database is, and whether a backup or other work is running;
  - how long each tab takes to load its data.

  It says in plain words what is slow and why, and **Copy results** copies the whole report to send. It only
  reads from the database.

## 0.33.8 - 2026-10-18

No database or plugin change.

- The removal log's times are all in local time. Before, the app's lines were in UTC and the script's were
  local.
- **Remove everything** also deletes the folder the app downloads new versions to,
  `%LOCALAPPDATA%\xiv-fleet-companion-updater` (and the old `fleet-tier3-updater`).
- The app's internal name is now `xiv-fleet-companion` instead of the old `fleet-tier3`. A new install goes in
  `%LOCALAPPDATA%\Programs\xiv-fleet-companion`. A PC that already has the app keeps its folder: Windows
  remembers where it was installed, and updates go there. The old `fleet-tier3-updater` download folder is
  deleted the first time this version runs.

## 0.33.7 - 2026-10-18

No database or plugin change.

- **Close and remove the app** still left the app installed. Its log showed the clean-up script was started
  but never ran a line: it was most likely stopped along with the app as it closed. Now Windows' own process
  service starts the script, so it isn't one of the app's processes. The app waits until the script says
  it's running before it closes. If that doesn't happen within 30 seconds, the app stays open and says why,
  including any error from PowerShell or Windows Security.
- The script never removes anything while the app is still open.

## 0.33.6 - 2026-10-18

No database or plugin change.

- **Close and remove the app** closed the app but still left it installed, with its settings folder, and no log.
  The last part was a hidden PowerShell command, which Windows Security can stop without a word. It's now a
  plain script file, `%TEMP%\xiv-fleet-remove.ps1`, run from there. The log, `%TEMP%\xiv-fleet-remove.log`, is
  started before it, so it always shows how far the removal got. The script deletes itself once it's done.

## 0.33.5 - 2026-10-18

No database or plugin change.

Fixes from the first real test of **Remove everything**:
- **Close and remove the app** didn't remove the app or its settings. Now the button says "Closing...", and if the
  last part can't start it says why instead of doing nothing. The app closes for certain once it has started. The
  last part finds the app's uninstaller through Windows' list of installed programs, closes anything of the app
  still running, waits until the app is really gone, then deletes its settings folder.
- It writes each step to `%TEMP%\xiv-fleet-remove.log`, so a removal that didn't finish can be looked into.
- The empty `C:\Program Files\PostgreSQL` folder is now removed along with PostgreSQL (unless another version is
  still in it).

## 0.33.4 - 2026-10-18

No database or plugin change.

- **A new database gets its game data by itself.** The first time the app connects to a database with no game
  data yet (item names, worlds, recipes), it downloads and fills it in, with a note at the top while it works.
  Screens wait for it instead of showing errors like "column w.name does not exist" on the Summary. New users no
  longer need Settings → Data → Game Data → Update, which still works as before for later updates.

## 0.33.3 - 2026-10-18

No database or plugin change.

- The PCs tab's FC Tracker and Submarine Tracker tooltips no longer mention plugin versions before 0.12.0.

## 0.33.2 - 2026-10-17

No database or plugin change.

- Setup Help → The plugin: "Connect it to the database" was shown twice (as steps 3 and 4). The steps now run 1 to 4
  once each, and the list of plugins uses the page's full width so it's easier to read.

## 0.33.1 - 2026-10-17

No database or plugin change.

- **Settings → Setup Help → The plugin** now lists the repository addresses for AutoRetainer and FC Tracker, with Copy
  buttons, alongside the plugin's own. Allagan Tools and Submarine Tracker are in Dalamud's own list. It also thanks
  the people who make them. The README has the same list.
- The setup screen's last page names the plugins to install alongside XIV Fleet Companion.
- **Credits** in Settings → General thanks kawaii, NightmareXIV and the Puni.sh team (AutoRetainer), Critical_Impact
  (Allagan Tools), erdelf (FC Tracker) and Infi (Submarine Tracker).
- The app now writes the plugins' names the way their makers do: Allagan Tools, FC Tracker, Submarine Tracker.

## 0.33.0 - 2026-10-17

No database or plugin change.

- **Remove everything from this PC** (Settings → Setup Help). For when you're done with the app on a PC. It removes
  the app, its settings, its backup and alert tasks, and the database, after one Windows permission prompt:
  - it offers a final backup first (ticked to start with) and stops without removing anything if that backup fails;
  - you type DELETE to confirm, and it warns when your other PCs use this database;
  - PostgreSQL is removed only if "Set up this PC" installed it. Otherwise only the app's database and login go
    (with PostgreSQL's master password), plus the firewall rule and the access "Let other PCs connect" added;
  - Tailscale is removed only if the app installed it, and only when ticked.
- Uninstalling the app from Windows still keeps PostgreSQL and your data, as before.

## 0.32.0 - 2026-10-17

No database or plugin change.

- **Set up this PC.** The first time the app starts with no connection saved, it asks what the PC is for: everything
  on one PC, the database PC for your other PCs, a PC using a database elsewhere, or a PC that only plays. Then it
  does the rest:
  - downloads PostgreSQL 18 and Tailscale from their makers where needed, and refuses any download whose checksum
    doesn't match;
  - installs them quietly and, on the database PC, lets your other PCs connect, all after one Windows permission
    prompt;
  - makes the database and the app's own login with the master password you choose (written down by you, never
    kept by the app) and a separate password for the app;
  - opens Tailscale's sign-in page and waits until it's signed in;
  - shows what to type on your other PCs, or asks for the database PC's details on a connecting PC.
- Anything already installed is used as it is. It can be run again from Settings → Setup Help → **Set up this PC**.

## 0.31.1 - 2026-10-17

No database or plugin change.

- **Settings → Database is tidier:** while the saved connection works, "New database on this PC" is folded behind a
  **Make a new database instead** button, so its fields only show for someone setting up a new database.

## 0.31.0 - 2026-10-17

No database or plugin change.

- **Let other PCs connect** (Settings → Setup Help → Connect another PC, on the database PC): one button sets
  PostgreSQL to let in your Tailscale PCs and this home network (always with the password), opens Windows Firewall
  for PostgreSQL's port from those addresses only, and restarts PostgreSQL. Windows asks for permission first, and
  copies of PostgreSQL's two settings files are kept next to them. The page also says whether other PCs can
  already connect. No more editing files by hand (the steps are still on the Tailscale page, just in case).
- **New database on this PC** (Settings → Database): on a PC with PostgreSQL and no fleet database yet, enter the
  password of PostgreSQL's "postgres" login and pick one for the app. The app makes the database and its own login
  (which owns the database), connects to it and sets up its tables. The "postgres" password isn't saved.

## 0.30.0 - 2026-10-17

No database or plugin change.

- **Settings → Setup Help**, for setting up your other PCs:
  - **Connect another PC:** what to type on your other PCs (address, port, database name and username; the password
    is never shown), with a Copy button. On the database PC it shows this PC's Tailscale and home network addresses.
  - **The plugin:** adding its repository in the game (with the address to copy), installing it, what AutoRetainer,
    AllaganTools, FCTracker and SubmarineTracker each add, connecting it and checking it.
  - **Tailscale:** what it's for, making an account, installing it on every PC with the same login, finding the
    database PC's address, and a **Test connection** button that says what's wrong in plain words (wrong address,
    no answer, PostgreSQL not letting other PCs in, wrong password). If other PCs can't connect, it gives the lines
    to add on the database PC, ready to copy.
- The Database tab links to Setup Help.

## 0.29.0 - 2026-10-17

No database or plugin change.

- **Settings folder renamed** from `%APPDATA%\fleet-tier3` to `%APPDATA%\XIV Fleet Companion`. The app moves
  everything across the first time it starts, so the connection, alerts and backups carry on as before. If another
  copy of the app has the old folder open, it waits and moves it on the next start.
- **A database from before plugin 0.4.0** (one still holding the old `companion_character_snapshot` table) now gets
  a message to start a new database, since the old scripts for it are no longer handed out.
- **Tidier code:** the files that were loose in the top folder are grouped into `db/`, `subs/`, `characters/` and
  `shared/`, and `run-tier3.bat` (the launcher from before the installer) is gone. Nothing changes in the app itself.

## 0.28.0 - 2026-10-17

No database change. Best with plugin 0.12.0 or newer (the PCs tab says which PCs need updating).

- **Discord alert for backups.** On the PC that makes the backups, an alert goes out when the daily backup
  fails, when there hasn't been one for 2 days, or when its second copy fails. It can be turned off in
  Settings → Discord Alerts.
- **PCs tab: "Update the plugin".** A PC whose plugin is older than this app needs is shown in red, with a note
  above the table naming it and saying how to update it in the game. (The amber "older than on another PC" mark
  on the PCs tab also shows again; it had lost its color.)
- **Friendlier README** for players first: what you need, installing, first-time setup, a tour of the tabs,
  alerts, backups and what to do when something looks wrong. The developer notes are at the end.

## 0.27.0 - 2026-10-17

No database or plugin change.

- **Backups are in the app: Settings → Backups.** Turn on the daily backup on the PC that has the database,
  choose a folder (and optionally a second folder elsewhere for a copy), and the app does the rest, at 03:30
  by default (or when the PC is next on). It uses PostgreSQL's own tools, which it finds by itself, and the
  connection saved in Settings, so there is no password file or PowerShell to set up.
- **Back up now, Test and Restore** buttons. Test loads a backup into a temporary database and compares it
  with the live one. Restore puts the database back as it was in a backup, after first backing up how it is
  now, and changes nothing if it fails part way.
- **Moving from the PowerShell backup scripts:** on the PC with the old "Fleet database backup" task,
  Settings → Backups offers **Use its settings here**; saving then removes the old task. The old backups are
  listed and kept. The scripts (the `backup` folder) are removed.

## 0.26.0 - 2026-10-17

No plugin change. The app makes its own database changes from now on (nothing to run by hand).

- **The app keeps the database up to date by itself.** When it connects, it applies any database change a
  new version needs, each completely or not at all, and records which ones the database has (a new table,
  `companion_schema_version`). On your database there is nothing to change: it is recorded as up to date.
  If a change cannot be made (for example the login in Settings may only read), the app keeps working and
  a banner says why.
- **A new, empty database is set up on first connect,** with every table; a note then points to
  Settings > Game Data > Update to fill the game data.
- The window is now called **XIV Fleet Companion** instead of "Fleet Tracker - Tier 3".

## 0.25.0 - 2026-10-17

No database or plugin change.

- **Windows installer with automatic updates.** The app is published as `XIV-Fleet-Companion-Setup-<version>.exe`
  in the public XIVFleetCompanion-Releases repository (no Node.js, Git or commands needed). The installed app
  looks for a new version when it starts and every 6 hours, downloads it in the background and shows
  **Restart to update**; it is also installed the next time the app is closed.
- The installed app keeps the same settings folder as a copy run from source, so the saved connection,
  Discord webhook and alert state carry over.
- Settings → Discord Alerts notices when the automatic checks start another copy of the app (for example the
  one used before installing) and offers **Use this copy**.
- Each merged version with a new number is built and published by GitHub; every pull request also checks
  the installer builds.

## 0.24.2 - 2026-10-15

No database or plugin change.

- **Live prices: another player's retainer with the same name as yours now counts.** Your own listings were
  left out of the market by retainer name only, so a retainer of the same name on another world was left out
  too, which could make the data center and region prices too high. They are now matched by name and world.
- Tests run on a fixed Ubuntu version (24.04) instead of "latest", so GitHub's move to a newer Ubuntu on
  October 19 does not break them, and the artifact upload step uses its current version.

## 0.24.1 - 2026-10-09

No database or plugin change.

- **Charts show new values on the first refresh.** A value the plugin recorded during the minute of a refresh
  could take a second refresh to appear: the chart's range ended at the start of that minute, and its data
  was kept for a minute. The range now ends at the end of the minute, and kept data is used only while
  nothing newer has been recorded. Applies to every chart (Trends, Summary tiles, the charts on each tab).

## 0.24.0 - 2026-10-09

No database or plugin change.

- **PCs tab: remove a PC no longer used.** The × beside a PC's name removes its row (after "Yes, remove"), for
  a PC that was retired, renamed or given another account label. Characters and their data stay. If the
  plugin still runs there, the PC comes back at its next sync.
- **Discord: "AutoRetainer not running" only for PCs seen in the last 2 days.** A PC that stopped reporting
  (retired or renamed) no longer keeps that alert open forever. If no other PC syncs its account, the usual
  "not syncing" alert says so instead.
- **Updates:** Electron 44.5.1 → 44.7.0 (security and bug fixes) and SortableJS 1.15.0 → 1.15.7 (bug fixes).
  Run `npm.cmd install` once after pulling, then start the app as usual.

## 0.23.2 - 2026-10-09

For plugin 0.12.0. No database change.

- **PCs tab:** with plugin 0.12.0, the FC Tracker and Sub Tracker columns say whether each is running in that
  game, for that account, like AutoRetainer and Allagan Tools (before, whether its file was found). Their
  descriptions (hover over a cell) say so.

## 0.23.1 - 2026-10-07

For plugin 0.11.1 (works with 0.11.0 too). No database change.

- **Discord summary: the loot line compares like with like.** Its vendor figure counted only salvage while
  "At market prices" counted all loot. It now gives all loot at vendor prices, the same figure as the Income
  tab: "brought back 310 salvage; all loot worth … at vendor prices. At market prices: …".
- **A new auto-refresh time applies straight away**, when Settings closes, instead of after restarting the app.
- Tidying, with no change in what the app does: the summary reads loot and venture rewards once (through the
  Income tab's code), one import instead of two in the alert check, and a comment moved to the right place.

## 0.23.0 - 2026-10-07

- **Discord: undercut listings.** With live prices on, the alert check looks every 30 minutes for your listings
  someone else sells cheaper on the same world, and posts one message per world (without the @mention): how
  many, and the biggest gaps with your price and the cheapest. Said again only when the undercut listings change.
  Settings → Discord Alerts → "Someone sells cheaper than your listings" turns it off; it is left out for
  subs-only players.
- **Discord summary at market prices.** With live prices on, the daily or weekly summary gives loot and venture
  rewards at market prices too (world, data center and region), and venture rewards at vendor prices.
- **HQ venture rewards** are valued at the cheapest HQ listing (else either quality), instead of the cheapest of
  either quality.

## 0.22.1 - 2026-10-07

- **Live prices: no more 404 errors.** Universalis answers 404 when nothing asked for is on the market board (for
  example a single salvage item asked for when the saved prices run out after 30 minutes). That now counts as no
  listings instead of an error.
- **Live prices: a missed answer keeps the last prices.** When Universalis is busy, unreachable or answers with an
  error, the prices from the last check stay on screen with a note saying when they are from; they update at the
  next refresh.

## 0.22.0 - 2026-10-07

- **Live market prices from Universalis** (Settings → General → Live Market Prices, off until turned on). For each
  item: the cheapest listing on the character's home world, data center and region.
  - Income: World, DC and Region market value columns for Loot per Voyage, routes and Retainer Ventures, with
    totals. Items not on the market board keep their vendor price; your own listings are not counted.
  - Gil & Market: **Undercut Listings** (your listings someone else sells cheaper on the same world, with the
    cheapest on the data center and region), and the three prices on every listing. The Summary counts them.
  - Only item numbers and world names are sent; prices are kept for 30 minutes. If Universalis cannot be
    reached, the tabs say so and show vendor prices.
  - Vendor prices stay beside the market ones: Loot per Voyage's columns are now named "Vendor gil / voyage" and
    "Vendor value / day", every listing on Gil & Market has a "Vendor price" column, and the Summary's Venture
    Income tile adds the market values under the vendor one.
- **Discord: AutoRetainer not running.** A PC whose AutoRetainer is not running (plugin 0.11.0) gets its own
  alert, instead of the general "Plugin not syncing" one for its account. Part of the sync alerts.
- **What do you run?** now also covers the Summary's trend tiles (ceruleum, repair kits and salvage only with
  subs) and the Character Roster's default columns (Ceruleum, Repair Kits and Submarines only with subs,
  Retainers only with retainers; any of them can still be added in Columns).
- The rank-up UI test no longer depends on how old the test database is.

## 0.21.0 - 2026-10-07

For players who run only subs or only retainers (nothing changes with both). Best with plugin 0.11.0.

- **What do you run?** (Settings → General): subs and retainers, subs only, or retainers only; by default worked
  out from the characters. Tabs, Summary sections, Income and Gil & Market parts, Discord alerts and the Discord
  summary for what is not run are left out. A tab that is left out while open goes back to the Summary.
- **Retainers on the Summary.** Retainers without a venture (and a table of them), ventures ready to collect and
  back within the hour, venture income per day, and listings unsold for a while.
- **PCs tab.** An AutoRetainer column, first of the other plugins, amber when AutoRetainer is not running
  (plugin 0.11.0). "Venture stats" is now "Venture Log", and each column says what it is for when pointed at.
  FC Tracker is no longer amber when missing: it is optional.

## 0.20.2 - 2026-10-07

- **Routes in the order they were run.** Loot per Voyage (Income tab) showed each route's sectors by sector
  number. With plugin 0.10.1 and its `sql/009_voyage_sector_order.sql`, they show in the order the sub
  visited them. Voyages stored before that get their order at the next sync; until then, by number.

## 0.20.1 - 2026-10-07

- **Adjustable columns on every table.** The tables that did not have them yet now work like the Roster and
  Salvage tabs: drag a header's edge to resize, drag a header to move it, click to sort, and use the Columns
  menu to remove, reorder or add columns. That covers Summary (houses, subs ready for new parts, low
  supplies), Supplies (including the FC credits tables), Income (including loot per voyage, routes and
  ventures), Gil & Market, PCs, the Shopping List, Where Is It? and the Sub Rules. Tables of characters or
  Free Companies can also add columns from the master list (gil, FC points, house, ...). Each table
  remembers its layout on each PC; Reset columns goes back to the default.
- The Supplies table's two-row header is now one row ("Ceruleum / day", "Repair kits: days left", ...), so
  each column can be moved on its own.

## 0.20.0 - 2026-10-07

Every feature left on the roadmap. No database change is needed for most of it; the PCs tab, loot per
voyage, venture income and market listings need plugin 0.10.0 and its sql/008 (until then they say so).

- **Ready for new parts.** A Discord alert (it can be turned off) and a Summary list when a sub's rank
  calls for its next build, with each part and where a spare is held or that it is to craft.
- **Daily or weekly Discord summary** (Settings → Discord Alerts): one quiet message with the gil earned
  against expected, loot and venture rewards, subs that ranked up or are ready for new parts, and supplies
  running out within a week. "Send Summary Now" posts one straight away.
- **Ceruleum from FC credits** (Supplies tab): how many tanks each Free Company's credits buy and how many
  days that covers, per Free Company, per account and for the fleet. The credits per tank can be changed.
- **PCs tab**: every PC and account in one place (plugin 0.10.0).
- **Loot per voyage and retainer ventures** on the Income tab (plugin 0.10.0, from SubmarineTracker and
  AutoRetainer).
- **Gil & Market tab**: gil per account (characters and retainers) and listings unsold for a while
  (listings: plugin 0.10.0).
- **Export any table to CSV**: right-click a table for "Export this table to CSV" or "Copy table".
- **Shopping List progress**: tick off parts as they are crafted; every PC sees it, and a crafted part
  the plugin then finds leaves the list without being counted twice.
- `db/schema.sql` includes the sql/008 tables.

## 0.19.0 - 2026-10-07

Fixes from a full review of the app and plugin. No database changes are needed; with plugin 0.9.1 (and
its optional sql/007) income, supplies and the unseen retainers list are more accurate.

- **Characters no longer synced stop raising alarms.** A character unticked in the plugin but not removed
  keeps its last data, so its subs looked idle and its supplies low forever (Discord repeated it every 6
  hours). A character that falls behind the rest of its account by the "Plugin not syncing" time is now
  left out of the sub, retainer and supply checks and the Summary's low supplies, named once instead
  ("Not synced": untick and remove it, or tick it again), and tagged "not synced" on the Roster.
- **Income no longer counts salvage that was only moved.** Salvage taken out of the character's FC chest
  (a rise matched by a drop in the chest in the same sync), and items stored for the first time (a
  retainer first opened on a PC, plugin 0.9.1) are left out; the hover says how many. Repair kits used
  come from the kits in bags and retainers once plugin 0.9.1 has recorded a full window of them, so kits
  moved to a retainer are not counted as used.
- **Supplies: moving ceruleum or kits to a retainer is not use.** The use per day comes from what is
  held in bags and retainers once plugin 0.9.1 has recorded a day of it.
- **Characters removed before 0.17.2 are left out of Trends.** Once, when the app starts: every
  character no longer on the Roster and every Free Company none of them is in. Their history is kept.
- **Discord: no repeated messages after a failed post.** When Discord accepted the first part of a long
  alert and refused the next, the next check posted the first part again; now only what did not go out
  is posted.
- **Empty retainers are no longer "unseen"** once plugin 0.9.1 (with its sql/007) has seen them.
- Retainer gear targets are checked before saving (Level or ilvl, 1 to 999). `package-lock.json` has the
  right version; the database file's comments are corrected and it includes sql/007's column.

## 0.18.0 - 2026-10-07

No database changes; works with any plugin version. Plugin 0.9.0 keeps a retainer's stored items when
AllaganTools has not seen it, instead of clearing them.

- **Retainers tab: retainers whose items have not been seen.** One collapsed line above the table says
  how many retainers have no stored items (AllaganTools only knows them once they are opened at a
  summoning bell on a PC running the plugin), so Where Is It?, the Shopping List and salvage counts
  leave them out. Click it for the names and characters.

## 0.17.2 - 2026-10-07

No database changes; works with any plugin version.

- **A removed character no longer counts in Trends.** Its chart history is still kept, but fleet totals
  (total gil, for example) stop including it. The same goes for its Free Company when no other character
  is in it. If the plugin syncs the character again, it comes back in Trends with all of its history.
  Characters removed with an earlier version still count.
- The removal box now says to untick the character in the plugin's Characters list first.

## 0.17.1 - 2026-10-04

No database changes; works with any plugin version.

- **Next Rank and Next Build hover text** now says what the dates assume: that the sub carries on as now
  (same route, or the same pace as last week). Moving to higher-experience routes as they unlock, or a
  faster build, would make them sooner.

## 0.17.0 - 2026-10-04

No database changes; works with any plugin version. Plugin 0.7.0 adds the recorded experience for
measured dates.

- **Subs tab: Next Rank and Next Build.** When each sub reaches its next rank, and the rank and date of
  its next build (the next Sub Rules rule that changes its parts, or Fight Club's build for a Craft? sub
  from rank 85). Hover for the date, the number of voyages and how it was worked out.
  - **Measured** (no mark): from the sub's own rank and experience over the last week, recorded by
    plugin 0.7.0 and later. Includes bonus experience and time in port. Used once there is a day of it.
  - **Calculated** (marked ≈): from game data for the route the sub is on now: each sector's
    experience and the voyage length from the sectors' positions, survey times and the sub's speed. Bonus
    experience is left out, so these dates are on the late side.
  - "Max rank" at the highest rank; "No progress" when a measured sub gained nothing all week.
- The Parts tab's choice of each sub's build is now one shared function, used by both tabs.

## 0.16.0 - 2026-10-04

No database changes; works with any plugin version.

- **Income tab: real income against expected.** For every character with subs, what the subs actually
  brought in over the last 3, 7, 14 or 30 days (7 by default, shared by every PC) next to what Fight
  Club says their routes should earn. Real net income is the salvage that came into the character's bags
  and retainers (every rise in the recorded count of each piece, at its vendor price; selling or moving
  salvage is not counted) less the repair kits used (at the repair kit cost). Expected is the subs'
  Current Gil/Day from the Subs tab, which already takes off repair kits. Shown per day with the
  difference and the share of expected: amber under 90%, red under 75%. Subs on a route Fight Club does
  not list are left out of expected (marked * with the reason on hover); characters with less than a day
  of salvage history show "Not enough history". Fleet cards for the total, the share of expected and how
  many characters are below it. Roster order with Group by account.
- Supplies and Income cards stay on one row in a narrower window.

## 0.15.1 - 2026-10-04

No database changes; works with any plugin version.

- **Where Is It?** orders places the same way as the Retainers tab: Roster position, then character, then
  each character's retainers in hiring order and then by name. Characters that share a name on different
  worlds are no longer mixed together (one's retainers could appear between another's rows).

## 0.15.0 - 2026-10-04

No database changes; works with any plugin version.

- **Supplies tab: days until empty.** For every character with subs, how fast it uses ceruleum and repair
  kits (every drop in the recorded count over the last 3, 7, 14 or 30 days; restocks are ignored), how
  many days what it holds will last (amber under a week, red under 3 days, the date on hover), and how
  many to buy so it lasts a chosen number of days (14 by default). Fleet cards show the total use per day,
  the total to buy (repair kits in gil too when the repair kit cost is set), the ceruleum already in FC
  chests, and which character runs out first. Roster order with Group by account. The two day settings
  are shared by every PC. Characters with less than a day of history show "Not enough history".

## 0.14.1 - 2026-10-04

No database changes; works with any plugin version.

- **Where Is It?** lists places in the same order as the Character Roster (saved position, then name),
  with a **Group by account** option like the other tabs (on by default). Within a character: its own
  places (biggest first), then its retainers in hiring order, then the Free Company chest it holds (the
  same member the Salvage tab counts a shared chest on).

## 0.14.0 - 2026-10-04

No database changes; works with any plugin version.

- **Inventory → Where Is It?** (now the first Inventory view): type part of an item name and see every
  place it is held across the fleet, with counts - each character's bags, saddlebags, crystals,
  equipped gear, armoury, armoire and glamour dresser, their retainers (bags, crystals, gear, and items
  up for sale on the market board), and the Free Company chests by tab. Searches as you type (2 letters
  or more, any part of the name, any case), lists only items actually held, puts the biggest holders
  first, counts HQ copies with the normal ones, and remembers the last search.

## 0.13.0 - 2026-10-04

Works with any plugin version. **After updating, open Settings → Data, check for game data updates and
apply them once**: that adds the four FC workshop tables and the vendor list the shopping list needs
(nothing to run by hand).

- **Parts → Shopping List.** Turns the sub parts the Parts tab says to craft into everything needed to
  make them, less what is already held:
  - **Sub parts to craft**, built at the FC workshop. Their materials come from every phase of the
    workshop project (CompanyCraftSequence / Part / Process / SupplyItem in the game data).
  - **Craft first**: in-between items such as ingots, rivets and lumber, in the order to make them, with
    the crafter, how many to make, and how many crafts when one craft makes several.
  - **Gather or buy**: raw materials, with need, have and short.
  - **Crystals**: shards, crystals and clusters, in their own list.
  - **Held** counts every character's bags, saddlebags and crystals, their retainers' bags and crystals,
    and the Free Company chests (each counted once), and shows where. Items listed on the market board,
    equipped gear and the armoury are not counted. An item used by several recipes has what is held taken
    off its total once, and an in-between item that is already held needs none of its own materials.
  - **Buy from vendors where they sell it**: buys whatever an NPC vendor sells for gil (such as Steel
    Ingot, Steel Rivets, Cedar Lumber or Iron Ore) instead of crafting or gathering it, so its own
    materials drop off the list. Shows how many to buy, the price each and the cost, with the total.
    With the box off, the vendor price still shows next to anything a vendor sells, to help decide.
    Vendors come from GilShopItem in the game data and the price from each item's PriceMid.
  - **Copy as Text** for pasting the list somewhere; **Show items already held in full** to see those too.
- **Discord alerts** list characters in name order every time (the order could change from one check
  to the next).
- **Game data update** now creates a game table the database does not have yet (starting from its id
  column, like the others), instead of skipping it. If loading it fails, the new table is removed again.

## 0.12.0 - 2026-10-04

No database changes; works with any plugin version.

- **Parts reuses old parts.** Every upgrade takes a part off a sub, and that part can go straight onto
  another of the character's subs. When Sub 3 swaps its Shark bow for an Unkiu bow and the empty fourth
  slot needs a whole Shark-class sub, the new sub gets Sub 3's old bow, so Parts asks for four parts to be
  crafted instead of five. These show as "Reuse: Sub 3's old Bow (once it is upgraded)" in Detail, and are
  left out of the Summary's crafting totals and the Summary page's count. Spares already held are still
  used first; old parts only fit the same slot, class and Modified state; two subs can also swap parts.

## 0.11.0 - 2026-10-03

No database changes; works with any plugin version (instant sync in the plugin makes sub alerts
quicker).

- **Discord alerts.** The always-on PC posts to a Discord channel, @mentioning you, when subs have been
  back in port for 2 hours, retainers have no venture, ceruleum or repair kits are low, an FC house is past the house warning, an
  account's plugin has sent nothing new for 30 minutes, or the database cannot be read. Each problem is
  posted once, repeated every 6 hours while it lasts, and marked resolved when it clears.
- **Retainers without a venture** for more than 30 minutes (setting), per character with their names. A
  finished venture waiting to be collected does not count, nor a retainer with no class yet; the wait
  covers AutoRetainer briefly leaving one unassigned while it collects and resends.
- **At most one message every 30 minutes** (0 turns it off): problems found in between go out together in
  the next message, and one that comes and goes in between is never posted, so a burst or a problem
  flickering on and off does not spam the channel.
- **Pause alerts for N hours** (nothing is posted; what is still wrong goes out when it ends, or on
  "Resume now"), **Quiet (no @mention) for N hours** (messages arrive without pinging you), and daily
  **quiet hours** (any times, crossing midnight is fine) that either hold alerts or drop the @mention.
- **Settings → Discord Alerts**: every number above, which alerts to send, the @mention, a test message,
  "Check Now" (which says what it did: posted, held and until when, or nothing new), and the 5-minute
  Windows scheduled task. The webhook is kept encrypted on the alert PC only.
- **"How to set this up"** beside the section title opens a step-by-step guide: making the webhook,
  finding your user ID, the test message, turning on the 5-minute checks, confirming "Last check"
  updates, and what to do if something does not work.
- **Settings has tabs**: General, Database, Discord Alerts and Data, in a window that no longer jumps in
  size. It reopens on the last tab used.
- **A dot on the Discord Alerts tab** (and a note in it) when alerts are on but not set up yet, or the
  last check was more than 15 minutes ago (the alert PC is off or its checks stopped). Works on any PC.
- **The low repair kit, low ceruleum and FC house warnings moved to Settings → General**, next to the
  repair kit cost. The Summary shows what they are set to, with "Change in Settings"; the Summary and
  the other views reload when Settings is closed.
- A sub with no return time (not on a voyage, since an unknown time) is only reported once it has been
  seen idle for the whole setting.
- New unit tests (alerts.test.js) and UI test 20, with a stand-in for Discord: webhook and user ID
  checks, the test message and its @mention, the alerts posted, quiet time, and the background check
  started the way the scheduled task starts it.

## 0.10.1 - 2026-10-03

No database changes.

- **The Roster's Remove button no longer runs off the edge of the window.** It sat after the last column,
  so with wide columns it was cut off, could not be moved, and added a sideways scroll bar. It is now a
  small × at the start of each row, beside the drag handle (faint until the mouse is over the row), and
  the confirmation opens as a box in the middle of the window ("No" is selected first; Escape also
  closes it) instead of growing the row.

## 0.10.0 - 2026-10-03

No database changes; works with any plugin version that saves FCTracker's housing details.

- **FC house demolition warning.** The game demolishes a Free Company house after 45 days without a
  member entering it. The Free Companies tab has a new **Last Entered** column ("Today", "9 days ago"),
  amber from the warning setting and red from 30 days or when FCTracker has no date for the house.
  When several of your characters share a Free Company, the most recent visit counts.
- **Summary: "FC Houses Not Entered Recently"**, at the top: each house past the warning setting, most at
  risk first, with its address, world, account and roughly how many days until demolition is possible.
  "View Free Companies" opens the tab.
- **The warning setting** sits next to the low repair kit and ceruleum ones: 7 days by default (since
  AutoRetainer enters each house on every workshop trip, a house running subs normally reads 0 days),
  any whole number from 1 to 44.
- New UI test 19 and unit tests cover the ages, colours, ordering, the setting and its limits.

## 0.9.0 - 2026-10-03

No database changes; works with any plugin version.

- **Losing the connection no longer wipes the screen.** When the database cannot be reached (internet or
  Tailscale down, Postgres stopped), every tab keeps showing what it last loaded instead of
  "Failed to load: connect ETIMEDOUT ...", with a banner: offline since when, why, and that the data is
  from before. The header gets a "Database" dot (green, or amber with how long it has been offline).
- **It reconnects by itself.** While offline it checks every 30 seconds; when the database answers, the
  banner goes away and everything reloads.
- **It gives up after 8 seconds** instead of the operating system's ~20 seconds or more, so a refresh
  while offline does not hang.
- **Plain-language errors:** "Can't reach the database at host:port. Check this PC is online and any VPN
  (such as Tailscale) is connected", wrong username or password, or a database name that does not exist.
- New UI test 18 drops the database connection while the app is open (through a relay that stops
  answering) and checks all of the above; new unit tests cover the connection checks and messages.

## 0.8.2 - 2026-10-02

Fixes from the full audit. No database changes; works with plugin 0.5.1 (and older).

- **Remove a character.** Each Character Roster row has a Remove button at the end; after a second,
  explicit "Yes, remove" in the row, the character and what is stored for it go (subs and their Craft?
  settings, bags, retainers and their gear targets, Free Company and house details, roster position,
  build rules made only for it, and its Free Company's chest when no one else is in that Free Company),
  in one transaction. Chart history is kept. A character still in AutoRetainer comes back at the
  plugin's next sync. New UI test 17 checks all of it, including "No" changing nothing.
- **Backups can be copied somewhere else.** `backup.ps1`, `install-schedule.ps1` and `setup.ps1` take
  `-CopyDir`: each night's backup is also copied there (another PC, a USB drive, a cloud-synced folder),
  keeping the newest `-Keep`. A failed copy is logged as `COPY FAILED` and leaves the backup in place.
  See backup/README.md, "A second copy somewhere else".
- The window no longer receives Electron's raw message object when Settings is opened from the menu.
- Updated Electron to 44.5.1 and the Postgres library to 8.23.1 (patch releases).
- Out-of-date code comments left over from the file split are corrected.

## 0.8.1 - 2026-10-02

No change to what the app does; its code is split into smaller files so each part is easier to find and
change.

- `main.js` (about 2,300 lines) is now a short file that opens the window. The calls the window makes are
  in `ipc/`, one file per area; the database connection is in `db.js`; the submarine route and build
  helpers shared by Subs and Parts are in `submarine-builds.js`.
- `renderer/app.jsx` (about 3,600 lines) is now one file per tab plus `tables.jsx`, the pieces every table
  uses. `npm run build` compiles every `.jsx` file in `renderer/`.
- New `tests/file-layout.test.js` checks the files are wired together: every `ipc/` file is loaded, every
  call the window makes has exactly one handler, `index.html` loads every window file in a working order,
  and no two window files declare the same name.

## 0.8.0 - 2026-10-02

Best with plugin 0.5.0 and its `sql/006_submarine_slot.sql`; works with older plugins as before.

- **Renamed subs work in Parts.** Parts used to look for each slot's sub by the default name
  `Submersible-1` to `-4`, so a renamed sub was not found: its slot was treated as empty (asking for a
  whole Shark-class sub) and its real upgrade needs and build rules were ignored. It now finds each sub
  by its workshop slot (stored by plugin 0.5.0; for older data, the slot in a default name).
- The Subs tab lists each character's subs in slot order.
- The Craft? setting of a renamed sub now carries over (plugin 0.5.0 moves it to the new name).
- `db/schema.sql` has the new `slot` column. The UI test subs are named Sub1-Sub4, so every Parts test now
  exercises subs with non-default names; new UI test 16 checks Parts lists their real needs (it fails on
  the old code).

## 0.7.3 - 2026-10-02

- **Fixed: a Free Company chest shared by several of your characters was counted once per member.**
  - **Salvage:** each member's row included the whole chest, so Fleet Total counted it two or more times. The chest is now counted once, on one member's row: the FC's leader when that is one of your characters, otherwise the first member in roster order.
  - **Parts:** a spare part in a shared chest was offered to every member, so two characters could be told to use the same part. The members now draw from one shared chest: a part one character takes is gone for the others. Each character still uses its own parts first.
- Characters that each have their own Free Company (the usual setup) see no change.
- New tests: unit tests for choosing the member who holds a shared chest, and a UI test with two characters in one FC that checks Fleet Total (it fails on the old code).

## 0.7.2 - 2026-10-02

No change to how the app works; it already reads only the current-state table when the old history is gone.

- **For removing the old snapshot history** (plugin 0.4.0): `backup\save-character-snapshot.ps1` saves
  `companion_character_snapshot` to a file and proves the file is complete (restored into a temporary
  database, row counts compared) before the plugin's `sql/005` removes the table. Tried on a copy with
  3.6 million rows: about 40 seconds.
- `db/schema.sql` no longer has the old table. The restore test checks `companion_character_current`
  instead of it.
- New UI test: with the old table gone, the roster, Free Companies, Retainers, Salvage and Trends all
  still show everything.
- The Character Roster's subtitle no longer names the old table.

## 0.7.1 - 2026-10-02

No change to the app itself.

- **The table design is in the repository.** `db/schema.sql` creates every table the plugin and the app use, matching the live database column for column (checked against an export of it), with a note on each table saying what it holds and who writes it, and the two fixed name lists (inventory types and housing cities) as entered in the live database. It sets up a new, empty database; the game tables are then filled by Settings > Game Data > Update (tried with the real game files: the columns it makes match the live game tables).
- The UI tests now build their scratch database from `db/schema.sql` instead of their own approximate tables, so they run against the real design (real column types, keys and the change-recording trigger).

## 0.7.0 - 2026-10-02

Works with any plugin version. Reads the new current-state table with plugin 0.3.0 (after its `sql/004_character_current.sql` has been run).

- **Characters come from the current-state table.** With plugin 0.3.0, every tab reads each character's current row from `companion_character_current` instead of finding the newest of millions of history rows. The app checks once a minute: it uses the table while the plugin keeps it up to date (its newest sync no more than 10 minutes behind the history's), and otherwise reads the history exactly as before, so the app and the plugin can be updated in either order.
- With the current-state table, a character is listed under its current Free Company only (the history listed it under every Free Company it was ever recorded in).
- **Trends: Retainers, Submarines and Sub slots** can be charted, from the history plugin 0.3.0 records (including the earlier changes `sql/004` copies from the snapshot history).

## 0.6.1 - 2026-10-02

- **Faster lookups in the game tables.** The `ffxiv_` tables had no indexes, so every item name, job or world lookup read the whole table (52,000 items). The app now gives each game table an index on `id` (and recipes one on `item_result`) when it starts; the first start takes a few seconds, later ones nothing. Measured on a full copy of the game data: looking up 400 item names went from 13.5 ms to 1 ms, and the "craftable?" check behind the gear suggestions from 236 ms to under 1 ms.
- After a Game Data update or restore, the reloaded tables get their indexes back (a restore that recreates a table used to lose them) and fresh Postgres statistics, so queries on new data are planned well straight away.

## 0.6.0 - 2026-10-02

- **Plugin data age in the header.** The header now says how old the newest data from the plugin is ("Plugin data: 2 min ago"). It turns amber and names the account when an account has sent nothing for 30 minutes or more ("· Main: 5 h ago"); hover over it for every account's age and character count. The plugin only writes while the game is running, so old data is normal when nobody is playing.
- The old "Last synced" time showed when the app last reloaded, not when the plugin last wrote, so it is gone. The **Sync Now** button is now called **Refresh**: it reloads what is on screen from the database and never made the plugin sync.

## 0.5.1 - 2026-10-02

- Fixed: the Parts, Salvage and Route Optimization tabs stayed on "Loading..." forever when two or more characters had no saved position in the roster (a fresh install, or new characters that had never been dragged). Characters without a saved position are now listed by name, as the Character Roster already did.
- New automatic test that opens every tab with no saved roster order.

## 0.5.0 - 2026-09-30

- **Movable columns on every table.** Drag a column header onto another to move it, or use the arrows in the new **Columns** menu, which sits beside "Group by account" on each tab. The layout is remembered per tab on each computer, and **Reset columns** restores the usual one.
- **Add or remove columns.** Any column can be removed (the first one on each tab always stays) and added back from the "Add a column" list.
- **A master list of extra columns.** Tabs whose rows are characters or Free Companies can add columns they never had: for example Account, Retainer Gil, Subs Built and the character's FC details on the Roster, Subs, Retainers, Salvage, Parts and Route Optimization tabs, and members' totals (gil, ceruleum, repair kits, retainers, submarines), tracked members, rank, founding date and the ceruleum in the FC chest on the Free Companies tab. Only the extra columns you add are loaded, so the usual tabs stay as fast as before, and they sort like any other column.
- Subs and Parts (detail) show Character and World automatically when sorted into one table; they can also be added to the per-character view.
- The Inventory tabs, Parts summary and Route Optimization use the same column menu for their own columns. Trends' data table and the Sub Build Rules panel keep their fixed columns.

## 0.4.0 - 2026-09-30

- Character Roster: new **FC Points** column beside the Free Company name, sortable like the other columns. Characters without a Free Company (or with no points recorded yet) show a dash.

## 0.3.1 - 2026-09-29

- Game Data update: a placeholder column (`unknown0`, `unknown2`...) that the ffxiv-datamining repository has since given a real name (for example `BST`, `DamagePhysType`) is now renamed in place instead of blocking the table, when it sits in the same position. A column your tables call `order_field` is recognised as the file's `Order`. Renames of any other column are still refused.

## 0.3.0 - 2026-09-29

- Settings has a new **Game Data** section: **Check for updates** compares the item, recipe, retainer task and other `ffxiv_` tables with the files in the ffxiv-datamining repository on GitHub and lists what would change, without changing anything. **Apply update** then loads the changed tables. Each table is replaced in one all-or-nothing step, new columns are added automatically, columns that left the file are kept, and a table that looks like it had a column renamed (or a suspiciously short file) is left alone and reported. **Apply update** first asks whether to back up the game tables (recommended). A **Backups** list in the same section can make a backup by hand, restore one (the current state is saved as a new backup first, so a restore can be undone) or delete one; the newest 8 are kept.

## 0.2.2 - 2026-09-29

- `run-tier3.bat` also reinstalls when only some libraries are missing (for example the build tool), not just when everything is.

## 0.2.1 - 2026-09-29

- Backup scripts for Windows (`backup/`): nightly compressed database backup to another drive, a restore test, and a scheduled-task installer. Not part of the app itself.
- `run-tier3.bat` now installs the app's libraries on first run (a fresh copy no longer needs `npm install` by hand) and stays open to show any error instead of closing.

## 0.2.0 - 2026-09-29

- New **Trends** tab: chart gil, ceruleum, repair kits, FC points and salvage over time, for the
  whole fleet or comparing characters or Free Companies, with hover values, drag-to-zoom and a table view. The table view can be made taller by dragging its bottom-right corner (the height is remembered), and its column headers stay in view while scrolling.
- Summary tab: a trend tile per value for the last 30 days, each opening the matching chart.
- Charts on the Character Roster (fleet gil), Salvage (salvage value) and Free Companies (FC points) tabs; each can be hidden, and the choice is remembered.
- A chart icon beside each character and Free Company name opens a panel with all of that one's charts (30 days, 90 days or 1 year), each with an "Open in Trends" button.
- Charts are drawn with uPlot (bundled locally).
- Heavy charts (for example the whole-fleet salvage value) load in parallel and are remembered for a minute.
- Needs the plugin's metric history tables (plugin 0.1.0 or later, `sql/001_metric_history.sql`); without them the Trends tab and tiles say the data is unavailable and everything else works as before.

## 0.1.0 - 2026-09-29

First tracked version. Everything the app does so far:

- Views: Summary, Character Roster, Free Companies, Salvage, Subs, Parts, Route
  Optimization, Sub Rules, Inventory (Character / FC / Fleet) and Retainers.
- Fight Club spreadsheet import, with merged-cell handling and row validation.
- Postgres connection settings stored encrypted (Electron safeStorage); the password is
  never sent back to the interface.
- Auto-refresh across every view.
- Faster loading on large history tables: latest-row lookups use the recommended indexes
  when they exist and fall back safely when they do not (see README, Performance).
- React, ReactDOM and SortableJS are bundled locally (no internet needed at startup); the
  interface code is compiled at start and a Content-Security-Policy limits scripts to the app.
- Electron 44, xlsx 0.20.3.
- The version is shown in the window title and at the top of Settings.
