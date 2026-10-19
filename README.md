# XIV Fleet Companion

Your whole FFXIV submarine and retainer fleet in one window, across every account and PC.

The app reads what the [XIV Fleet Companion plugin](https://github.com/CrownedPandaXIV/XIVFleetCompanion) sends from
each game, and turns it into one view of your fleet: which subs are back, what they brought home, what's running
low, which parts to build next, and what your retainers are up to. It can also ping you on Discord when something
needs you, and back up your data every night.

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

The app checks for a new version when it starts and every few hours, and downloads it in the background. When it's
ready, a bar at the top says so: click **Restart to update**, or just carry on and it updates the next time you close
the app. After **Restart to update**, the app closes, the installer shows its progress, and the app opens again by
itself. This can take a minute or two.

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
Uninstalling the app never removes PostgreSQL or your database.

**Done with the app on a PC?** **Settings → Setup Help → Remove everything** takes it all off: the app, its settings,
its scheduled tasks, and the database. It makes a final backup first if you want one, and asks you to type DELETE.
It only removes PostgreSQL and Tailscale if the app installed them. If PostgreSQL was already on the PC, only the
app's own database and login are removed. On a PC the database was moved away from, it removes the copy left behind.

**Rather do it yourself?** Skip the setup screen, then type your database's address, port, name, username and
password in **Settings → Database**, click **Test Connection**, then **Save**.

On a brand-new database, the app fills in the game data (item names, recipes, worlds and so on) by itself the first
time it connects. That takes a minute or two, and a note at the top of the window says when it's done.

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

## What's in the app

| Tab | What it shows |
| --- | --- |
| **Summary** | Everything that needs you, at a glance: idle subs, low supplies, FC houses at risk, retainers without a venture. |
| **Character Roster** | Every character with gil, ceruleum and repair kits. Drag to reorder; group by account. |
| **Free Companies** | Each FC with its house and when it was last entered. |
| **Salvage** | The salvage you're holding and what it's worth. |
| **Subs** | Every sub, when it's back, and its next rank-up and build change. |
| **Supplies** | How many days of ceruleum and repair kits are left. |
| **Income** | What your subs and retainers actually earn, voyage by voyage, compared with what was expected. |
| **Parts** | Which subs are ready for new parts, plus a shopping list of materials. |
| **Route Optimization**, **Sub Rules** | Plan routes and the build each sub should have at each rank. |
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
- **Live market prices** (Settings → General): turn this on to see Universalis market prices next to vendor prices,
  and to spot listings someone sells cheaper. Only item numbers and world names are sent.

## Discord alerts

The app can post to a Discord channel and @mention you when something needs attention:

- subs back in port for a while, or retainers sitting without a venture,
- ceruleum or repair kits running low,
- a Free Company house that hasn't been entered in a while (houses get demolished after 45 days),
- a sub ready for new parts,
- a PC that stopped syncing, or where AutoRetainer isn't running,
- someone undercutting your market listings (with live prices on),
- the nightly backup failing,
- the database itself not answering.

Each problem is posted once, repeated every few hours while it lasts, and gets a "Resolved" line when it's fixed. You
can pause alerts, go quiet (no @mention) for a few hours, or set quiet hours every night. You can also get a daily or
weekly summary.

**To set it up**, on the PC that's always on (usually the one with the database), go to **Settings → Discord Alerts**
and click **How to set this up**. In short:

1. In Discord, make a webhook for your channel (Edit Channel → Integrations → Webhooks → New Webhook → Copy Webhook URL).
2. Paste it in the app and click **Save**.
3. Add your Discord user ID so the alerts ping you.
4. Click **Send Test Message**, then **Check every 5 minutes**.

Everything else (which alerts, how often) can be changed from any PC.

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

If a backup fails, the Discord alerts tell you.

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
- `alerts/` is the Discord alerts, `backups/` the backups, `updater.js` the automatic updates.

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

Version numbers follow [Semantic Versioning](https://semver.org):

- **0.1.0 → 0.1.1** for fixes,
- **0.1.0 → 0.2.0** for new features,
- **1.0** for the first stable release.

### Game data

**Settings → Data → Game Data** refreshes the `ffxiv_` tables (items, recipes, worlds and so on) from
[xivapi/ffxiv-datamining](https://github.com/xivapi/ffxiv-datamining). Before applying an update it can save a copy of
those tables inside the database, and those copies can be restored from the same screen.
