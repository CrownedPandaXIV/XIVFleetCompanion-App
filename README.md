# XIV Fleet Companion

Your whole FFXIV submarine and retainer fleet in one window, across every account and PC.

The app reads what the [XIV Fleet Companion plugin](https://github.com/CrownedPandaXIV/XIVFleetCompanion) sends from
each game, and turns it into one view of your fleet: which subs are back, what they brought home, what's running
low, which parts to build next, and what your retainers are up to. It can also back up your data every night.

## What you need

- **The plugin**, running in the game on each PC that plays, along with the plugins it reads from (below).
- **A PostgreSQL database** on one PC. That's where the plugin sends the data and the app reads it from.
- **Tailscale** (free), if your PCs aren't all on the same home network, so they can reach the database.

The app works on Windows. It installs PostgreSQL and Tailscale for you where they're needed (see First-time setup).

### The plugins it works with

| Plugin | | What it provides | Where to get it |
|---|---|---|---|
| **AutoRetainer** | required | Your characters, retainers, subs, gil, ceruleum and repair kits. | Add `https://love.puni.sh/ment.json` in Dalamud |
| **Allagan Tools** | recommended | Everything in your bags, your retainers' and the FC chest. | Dalamud's own plugin list |
| **FC Tracker** | optional | Free Company houses, and when each was last entered. | Add `https://puni.sh/api/repository/erdelf` in Dalamud |
| **Submarine Tracker** | optional | What every voyage brought back. | Dalamud's own plugin list |

To add a repository: in the game, type `/xlsettings`, open **Experimental**, paste the address under **Custom Plugin
Repositories**, click **+**, tick **Enabled**, then **Save and Close**. The app shows the same list, with Copy
buttons, in **Settings → Setup Help → The plugin**.

**Thank you** to the people who make these plugins: kawaii, NightmareXIV and the Puni.sh team (AutoRetainer),
Critical_Impact (Allagan Tools), erdelf (FC Tracker) and Infi (Submarine Tracker). XIV Fleet Companion couldn't work
without them.

## Install

1. Download `XIV-Fleet-Companion-Setup-<version>.exe` from the
   [latest release](https://github.com/CrownedPandaXIV/XIVFleetCompanion-Releases/releases/latest).
2. Run it. If Windows says "Windows protected your PC", click **More info**, then **Run anyway**. (The
   installer isn't signed yet, so Windows doesn't recognize it.)
3. The app opens by itself. It's also in the Start menu and on your desktop.

No administrator rights are needed: it installs just for your Windows account.

### Updates happen by themselves

The app looks for a new version when it starts and every hour, and downloads it in the background. When it's ready,
a bar at the top says so: click **Restart to update**, or just carry on and it updates the next time you close the
app. After **Restart to update**, the app closes, the installer shows its progress, and the app opens again by
itself. This can take a minute or two.

**Settings → General → Updates** shows which version you have and what the update check is doing, and **Check for
updates** looks straight away.

After an update, the app shows what changed in each version since you last opened it, until you click **Got it**.
**What's new** on the update bar, and in **Settings → General → Updates**, shows the same any time.

**Trying new versions first:** tick **Get test versions** in **Settings → General → Updates**, and that PC gets new
versions to try before everyone else (they're numbered like `1.6.0-test.12`). It still gets every normal update too.
Turning it off keeps the version you have until a normal version is newer. A test version can still have problems, so
this is for whoever wants to try things first. The plugin has its own test builds: see
[the download page](https://github.com/CrownedPandaXIV/XIVFleetCompanion-Releases) for how to get them in Dalamud.

## First-time setup

The first time the app starts, it asks what this PC is for:

- **Everything on this PC:** it plays and keeps the database, and no other PC connects.
- **This PC keeps the database for my other PCs.**
- **This PC uses a database on another PC.**
- **This PC only plays the game** (just the plugin).

Then click **Set up this PC**. The app downloads PostgreSQL and Tailscale from their makers where they're needed
(checking each download is the genuine file), installs them, and sets everything up. Windows asks for permission once.
On the database PC you choose two passwords:

- **The master password:** the master key to your database. Write it down somewhere safe; the app doesn't keep it.
  You'll need it if you ever move or rebuild the database.
- **The app's password:** the one you type on your other PCs and in the plugin.

If Tailscale is involved, the app then opens Tailscale's sign-in page. Use the same Tailscale account on every PC.
At the end it shows what to type on your other PCs, and how to install the plugin.

You can run it again any time from **Settings → Setup Help → Set up this PC**, for example to add Tailscale later.
Uninstalling the app never removes PostgreSQL, your database or Tailscale, so you can take the app off the database
PC and leave the database running for your other PCs. Uninstalling does remove the daily backup task on that PC,
since it needs the app. To keep daily backups, turn them on from another PC (see
[Backups from a PC without the database](#backups-from-a-pc-without-the-database)).

**Done with the app on a PC?** **Settings → Setup Help → Remove everything** takes it all off: the app, its settings,
its scheduled tasks, and the database. It makes a final backup first if you want one, and asks you to type DELETE.
It only removes PostgreSQL and Tailscale if the app installed them. If PostgreSQL was already on the PC, only the
app's own database and login are removed. On a PC the database was moved away from, it removes the copy left behind.

**Rather do it yourself?** Skip the setup screen, then type your database's address, port, name, username and
password in **Settings → Database**, click **Test Connection**, then **Save**.

On a brand-new database, the app fills in the game data (item names, recipes, worlds and so on) by itself the first
time it connects. That takes a minute or two, and a note at the top of the window says when it's done. After that, a bar
at the top says when new game data is available (usually after a game patch), with an **Update now** button.

Your password is encrypted with Windows' own protection and never leaves this PC.

When a new version of the app needs a change to the database, it makes the change itself the next time it connects.
You never need to run anything on the database by hand.

### Setting up your other PCs

**Settings → Setup Help** walks you through the rest:

- **Connect another PC** shows exactly what to type on your other PCs (the address, port, database name and
  username), with a button to copy it all. On the database PC, it finds the address other PCs should use, and
  **Let other PCs connect** sets up PostgreSQL and Windows Firewall so they can (Windows asks for permission first).
- **The plugin** covers installing it in the game, which other plugins it works with, and connecting it.
- **Tailscale** covers setting it up on every PC, with a **Test connection** button that says in plain words what's
  wrong if a PC can't reach the database.

### More than one account

Give each game account its own setup of AutoRetainer and Fleet Companion (for example, separate XIVLauncher setups),
with its own account label in the plugin's settings (the Roster and the PCs tab point out any without one). Each setup
notes when a character logs in on it, and only the setup a character last logged in on syncs it (plugin 1.0.2 or
newer), so an old copy of a character left in another setup's AutoRetainer can't overwrite it. There's no time limit:
after a long break, each character still belongs to the setup it last logged in on.

One setup used for several accounts (the same AutoRetainer and plugin, logging into each account in turn) still syncs
every character correctly. But the account label belongs to the setup, so all of its characters share one label, and
the app can't tell those accounts apart in the Account column, the Roster or Trends.

The same goes for Allagan Tools, FC Tracker and Submarine Tracker: they keep their data per character or Free Company,
so a shared setup syncs all of it, under its one label. And a setup leaves alone their data too (bags, retainers' items,
FC chests, house details, voyage loot) for any character that last logged in on another setup.

The Roster's **Synced By** column names the setup each character last logged in on, and the PCs tab says how many
characters each setup left to another one. A character unticked in a setup's plugin settings never counts as that
setup's, so unticking it on one PC (say, a laptop) never stops another PC that does sync it. If a character's setup
keeps syncing but leaves it out (its AutoRetainer lost it), no setup sends it any more: the Roster and the PCs tab say
which character, and logging in as it once on the right setup fixes it.

With an older plugin, or before a character has logged in since the update, each setup syncs every character its
AutoRetainer knows, so if one setup's AutoRetainer still has an old copy of another account's character, the two setups
keep overwriting that character's subs and label. The Summary and the PCs tab warn when that happens. To fix it,
update every setup to plugin 1.0.2 or newer, then log in as the character once on the setup that plays it. If you'd
rather not wait, on the setup that doesn't play the character, open AutoRetainer's settings → **Advanced → Character
Synchronization** and click **Prune deleted characters** (AutoRetainer asks for the JustBackup plugin first, so it can
keep a backup).

## What's in the app

| Tab | What it shows |
| --- | --- |
| **Summary** | Everything that needs you, at a glance: idle subs, low supplies, FC houses at risk, retainers without a venture. |
| **Character Roster** | Every character with gil, ceruleum and repair kits, and which setup of the plugin syncs it. Drag to reorder; group by account. |
| **Free Companies** | Each FC with its house and when it was last entered. |
| **Salvage** | The salvage you're holding and what it's worth. |
| **Subs** | Every sub, when it's back, and its next rank-up and build change, with how close the rank-up dates have come. |
| **Supplies** | How many days of ceruleum and repair kits are left. |
| **Income** | What your subs and retainers actually earn, voyage by voyage, compared with what was expected. |
| **Parts** | Which subs are ready for new parts, plus a shopping list of materials. **Look ahead** adds the parts of builds coming up in the next few days. **Show Rules** sets the build each sub should have at each rank. |
| **Route Optimization** | Subs whose route isn't the best one for their rank. |
| **Inventory** | Everything you own, with a fleet-wide "Where is it?" search. |
| **Retainers** | Ventures, levels and gear. |
| **Gil & Market** | Gil per account, and listings that haven't sold or that someone undercut. |
| **Trends** | Charts of gil, supplies, FC points and salvage over time. |
| **PCs** | Each PC running the plugin, and anything it can't see. |

Handy everywhere:

- **Columns** (above most tables): add, remove and rearrange columns. Each PC remembers its own layout.
- **Right-click a table** to export it to CSV or copy it straight into a spreadsheet.
- **Settings → General → What do you run?** Choose subs only or retainers only, and the app hides everything you
  don't use.
- **Settings → General → Warnings**: when repair kits and ceruleum count as low, how long before a Free Company house
  warning, and how far a character can fall behind the rest of its account before it's marked as not synced.
- **Live market prices** (Settings → General): turn this on to see Universalis market prices next to vendor prices,
  to spot listings someone sells cheaper, and to see on the Shopping List whether each sub part is cheaper to buy or
  to make, from the world, data center or region you pick. Only item numbers and world, data center or region names
  are sent.

## Backups

On the PC with the database, open **Settings → Backups**:

1. Choose a **backup folder**, ideally on a different drive from the database.
2. Optionally choose a **second copy** folder somewhere else: another PC's shared folder, a USB drive, or a folder that
   syncs to OneDrive or Google Drive. Then even losing the whole PC doesn't lose your data.
3. Tick **Back up every day**, pick a time, and click **Save**.

The app keeps the newest 14 backups (you can change that). If the PC is off at backup time, it backs up as soon as the
PC is back on.

- **Back up now** makes one straight away.
- **Test** loads a backup into a temporary database and checks it's complete. Your real data isn't touched.
- **Restore** puts everything back the way it was in that backup. It saves a backup of how things are right now first,
  so you can undo it.
- **Restore from a file...** does the same with a backup kept anywhere else, such as a USB drive or another PC's backup
  folder.

If a backup fails, **Settings → Backups** says so, with the reason.

### Backups from a PC without the database

Backups are made with PostgreSQL's own tools, which come with PostgreSQL, so normally only the database PC has them.
Any other PC with the app can get them: **Settings → Backups → Get the backup tools**. It asks the database which
PostgreSQL version it runs (14 to 18), downloads that version from PostgreSQL's maker (about 350 to 370 MB, once,
checked against its known checksum), keeps only the 11 MB needed for backups and restores in the app's settings folder,
and deletes the rest. Nothing is installed and Windows doesn't ask for permission. Then set up backups there as above.
The tools have to match the database's version, so if the database later moves to a newer PostgreSQL, click **Get
the backup tools again**.

The tools need Microsoft's Visual C++ runtime, which most PCs with games already have. If it's missing, the app says
so: install "Microsoft Visual C++ Redistributable" (x64) from Microsoft's website and try again.

### If the database PC dies

Your backups are how you get everything back. Keep a second copy somewhere other than that PC (Settings → Backups →
second copy folder), so losing the PC doesn't lose them too.

1. On the PC that will hold the database from now on, install the app and run **Set up this PC** → **This PC keeps
   the database for my other PCs**. Use the same database name, username and app password as before, so the plugins
   only need the new address.
2. Open **Settings → Backups**, choose and save a backup folder, then click **Restore from a file...** and pick your
   newest backup.
3. On every other PC, type the new address in the app (**Settings → Database**) and in the plugin's settings.
   **Setup Help → Connect another PC** on the new database PC shows it.
4. Turn on daily backups on the new PC.

Anything recorded after that backup is lost, which is why the daily backup matters.

## Moving the database to another PC

For when the database should live on a different PC, for example a new PC replacing the old one.

1. On the new PC, install the app and connect it to the database where it is now (Set up this PC → **This PC uses
   a database on another PC**), the same way as your other PCs.
2. Open **Settings → Database → Move the database to this PC** and click **Move the database here**. If PostgreSQL
   isn't on that PC yet, the app downloads and installs it, and asks you to choose its master password. If it's
   already there, type the master password it was installed with. Windows asks for permission once.
3. Wait for it to finish. That's it.

The app checks everything first, and says what to do if a PC's plugin needs updating. Then it pauses the plugins,
copies everything across, and checks every table has the same number of rows. Only then does it leave the new address
in the old database. Every app and plugin finds it at its next refresh or sync and switches by itself, keeping the
same username and password. The PCs tab shows which PCs haven't switched yet.

If anything goes wrong part way, everything stays on the old database as it was. The old database is never deleted
by the move. Remember to turn on backups on the new PC and turn them off on the old one.

**Tidying up afterwards:** a move leaves an unused copy behind. That's the old database on the PC it moved away from,
and, if the new PC already had a database with the same name, that one too, kept as `..._before_move_...`. Once every
PC has switched, open **Settings → Database → Leftovers from moving the database** on that PC, type PostgreSQL's
master password, and click **Look for leftovers**. Each one has a **Remove** button. The database the app uses is
never listed. If only leftovers are in that PC's PostgreSQL and the app installed it, you can remove PostgreSQL there
too, and keep the app.

## When something looks wrong

- **"Offline" bar at the top:** the app can't reach the database (Tailscale or the internet is down, or the database
  PC is off). It keeps showing what it last loaded and reconnects by itself.
- **Tabs are slow to load:** run **Settings → Database → Speed Check**. It says what's slow and why, and **Copy
  results** copies the details to send.
- **A new PC can't connect:** use **Settings → Setup Help → Tailscale → Test connection** on it. It says what's wrong
  and what to change.
- **"The database could not be updated":** usually the login in Settings isn't allowed to change the tables. Use the
  login that created the database.
- **PCs tab says "Update the plugin":** that PC's plugin is older than this app needs. In the game, type `/xlplugins`
  and update XIV Fleet Companion.
- **A retainer's items are missing:** Allagan Tools only sees a retainer's items after you've opened that retainer at a
  summoning bell on a PC running the plugin. The Retainers tab lists any it hasn't seen yet.
- **A character you removed came back:** the plugin is still syncing it. Untick it in the plugin's Characters list
  first, then remove it from the Character Roster (the faint × at the start of its row).
- **"The database moved to ..., but this PC can't reach it yet":** the database was moved to another PC, and this
  one can't connect to its new address. Check Tailscale is running on both PCs. The app keeps trying every minute.
- **Something else?** In the game, type `/xivfleet check` to see what the plugin can and can't see on that PC.

### Found a problem?

Report it on the app's [GitHub page](https://github.com/CrownedPandaXIV/XIVFleetCompanion-App/issues/new/choose), for
the app and the plugin alike (a free GitHub account is needed). **Settings → Setup Help → Found a problem?** has a
button that opens it, the app's version to copy, and **Open the log folder**: the app's log, `app.log`, says what
the app did and any errors, and never has passwords in it. For the plugin, paste the **Copy results** of
`/xivfleet check` too.

## License

XIV Fleet Companion is free software under the [GNU Affero General Public License v3](LICENSE.md), the same as the
plugin. You can use it, share it and change it. If you share a changed version, share its code under the same license.
It comes with no warranty.

---

## For developers

### Running from source

You need Node.js. Then:

```
npm install
npm start
```

`npm start` compiles the `renderer/*.jsx` files and starts the app. A copy run from source shares its settings with the
installed app (`%APPDATA%\XIV Fleet Companion`).

### Tests

`npm test` runs the quick unit tests. The database and click-through tests are explained in
[tests/README.md](tests/README.md). Every pull request runs all of them on GitHub, and also builds the installer.

### Where things are

- `main.js` starts the app; `preload.js` is the only bridge between the window and the rest.
- `ipc/` answers the window's requests, one file per area. `renderer/` is the window itself (React), one file per tab.
- `db/` is the database: `index.js` holds the connection, `apply-updates.js` keeps the tables up to date, and
  `schema.sql` describes every table.
- `subs/` works out subs, parts, supplies, income and the shopping list. `characters/` covers retainers, Free
  Companies, inventories and the market. `shared/` has the pieces used all over (table columns, CSV, what you run).
- `setup/` is "Set up this PC" (the downloads, with their checksums, in `setup/installers.js`), Setup Help, "Let
  other PCs connect", "New database on this PC" and "Remove everything".
- `backups/` is the backups, `updater.js` the automatic updates (`update-status.js`
  turns them into what Settings → General → Updates shows).
- `app-log.js` writes the app's log (logs\app.log), and `user-data-folder.js` picks the folder the settings and
  the log are kept in.

### Changing the database

Add the change as the next numbered file in `db/updates/`, and make the same change in `db/schema.sql`.
[db/updates/README.md](db/updates/README.md) has the details. The app applies it on every database the next time it connects.

### Releasing a new version

1. Raise the version: `npm version <new> --no-git-tag-version`.
2. Add a section for it at the top of `CHANGELOG.md`.
3. Merge to `main`.

GitHub then tags the release, builds the installer and publishes it to
[XIVFleetCompanion-Releases](https://github.com/CrownedPandaXIV/XIVFleetCompanion-Releases), where installed copies
pick it up. That needs the `RELEASES_TOKEN` secret: a token that can write to that repository.
`npm run dist` builds the installer locally into `dist/`.

**A test version first:** push the branch to `testing` (`git push origin dev:testing --force`). GitHub builds it as
`<version>-test.<run>` and puts it on the `testing` pre-release of XIVFleetCompanion-Releases, where only copies with
**Get test versions** on look (`update-feed.js`, `.github/workflows/test-release.yml`). Every normal release also goes
there when it's newer, so testers never miss one.

Version numbers follow [Semantic Versioning](https://semver.org):

- **0.1.0 → 0.1.1** for fixes,
- **0.1.0 → 0.2.0** for new features,
- **1.0** for the first stable release.

### Game data

**Settings → Data → Game Data** refreshes the `ffxiv_` tables (items, recipes, worlds and so on) from
[xivapi/ffxiv-datamining](https://github.com/xivapi/ffxiv-datamining). Before applying an update it can save a copy of
those tables inside the database, and those copies can be restored from the same screen.

You don't have to remember to look: once a day the app asks GitHub whether any of those files have changed since the
last update (only their dates, a few kilobytes), and says so in a bar under the header. **Update now** there does the
same check and update, backing up the old tables first; **Later** hides it on that PC until something newer changes.
With the app open on several PCs, only one of them asks each day.
