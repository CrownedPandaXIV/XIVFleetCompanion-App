# Changelog

All notable changes to the app are recorded here. Versions follow
[Semantic Versioning](https://semver.org): MAJOR.MINOR.PATCH.

## 1.13.5 - 2026-11-26

### Changed
- **Sub and retainer statuses read as the plugin's.** The Subs page says "In port", "Back" (waiting to be collected) or
  the time until it's back, and both the Subs and Retainers pages show that time as the plugin does: "45:10" under an
  hour, "3:05:09" in hours, "2d 4:00:00" over a day (before: "In Port", "Returned / Awaiting Collection" and always
  "03:05:09", with hours past a day as "52:00:00").
- **Supplies: held ceruleum and repair kits follow the low-supply warnings** (Settings → General → Warnings), as the
  Roster does: amber under the warning, red under half of it, green otherwise, the warning on hover. They weren't
  coloured before.
- **Supplies: what to buy follows days left,** as days left does: red under 3 days, amber under 7, green otherwise.
  Days left is now green when none are used and grey without enough history, as the plugin's.
- **Newer Sub Calculator data is looked for every 6 hours instead of once a day.** GitHub sometimes starts its daily
  run hours late or skips it; now the next run catches up. Nothing changes in the app: it still downloads a newer copy
  once a day.

## 1.13.4 - 2026-11-25

### Changed
- **Levelling Plan: the fewest days.** Part swaps are now judged by how much sooner the whole plan reaches the target,
  both on the route being run and on the best route the new part allows (a part that opens a better route was missed
  before), with no cap on how many. A rank 96 Whale-Shark-Unkiu-Coelacanth sub to rank 145 went from 145 days with no
  swaps suggested to 106. Several parts can change at the same rank.
- **Levelling Plan with a Free Company's sectors: sectors open on the way.** Each voyage through a sector has a chance
  to open each sector it leads to (25% to start with, from Pepper's guide; change it on the page), and the plan counts
  on the expected number of voyages. Stages say what they're expected to open ("opens C, D"), and a stage that goes out
  of its way to open a better sector says so ("to open J"). Before, an FC that had found only A and B was planned on A-B
  forever.
- **Hovering a sector letter shows its name, map and rank**, on every page that shows them.
- **Levelling Plan, easier to read:** "Not discovered yet" says when the plan opens a sector itself ("H opens on the way,
  by rank 97") instead of what it would add; a stage that doesn't reach the next rank shows its one rank ("96", not
  "96 → 96"); and the day strip labels only the stages with room, with the days under it where the stages end and
  never crowded (every stage's ranks and days on hover).

### Fixed
- **The Levelling Plan worked its plan out again at every auto-refresh**, even when nothing had changed. It now plans
  again only when something the plan uses changed: a sub's rank, experience or parts, or the Free Company's sectors. A
  chosen sub now follows its new rank, experience and parts after a refresh (unless they were changed on the page).

## 1.13.3 - 2026-11-25

### New
- **Settings → Database → Connections in Use:** how many of the database's connection slots are taken (when they run
  out, the plugins can't sync), split into this app, the plugins and anything else, and from which PC. A warning from
  80% of the slots. Connections from another login (pgAdmin signed in as postgres, say) are counted, without their PC.
- **Settings → Data → Sub Calculator Data:** which copy of the Sub Calculator's data is in use (the one this version
  came with, or a newer one downloaded by the daily check), when it was last checked, and Check now.

### Changed
- **A quiet note when live prices fall back:** the Summary's Venture Income, the Route Finder and Compare Builds now say
  in small grey text when live prices didn't arrive this time (vendor prices shown) or some are from an earlier check;
  the reason is on hover. The other pages with live prices already said so.

### Fixed
- **"Choose one of your subs…" opened at the bottom of the page** on the Levelling Plan and Route Finder (once a sub's
  results were showing), and could on Compare Builds and Build Finder. It now opens right under its button everywhere.

## 1.13.2 - 2026-11-25

### Fixed
- **The leak itself:** with Live Market Prices on, the Summary page's loot figures could wait on Universalis for good,
  holding a database connection open each time the page refreshed (once a minute). The app's log from 1.13.1 named it.
  Now a request to Universalis that hasn't ended 5 seconds past its 20-second limit is given up, and a page waits at
  most 60 seconds in all for market prices; it then shows vendor prices, and the log says what was still waiting.
- **What caused it:** Universalis was answering slowly (up to 20 seconds a request, some not at all), and each refresh
  queued its own copies of the same requests (about 60) behind the last refresh's, so the queue only grew. A request
  still on its way is now shared with whoever asks for it again instead of being queued twice.

## 1.13.1 - 2026-11-25

### Fixed
- **The app could use up the database's connections.** Some of its connections were left open, a few every 10 minutes,
  until the database (100 at most) had none left: the plugins on other PCs then couldn't
  sync or read ("remaining connection slots are reserved"). Now the database itself closes any of the app's
  connections left idle for 10 minutes (PostgreSQL 14 and later), so they can't pile up whatever the cause.
- **Trends:** when one of a chart's connections failed, the ones that opened a moment later were left open. They're
  closed now.

### Changed
- The app's connections are named "XIV Fleet Companion app" in the database's list of connections, and one still open
  after 2 minutes is written to the app's log with the page call that opened it, to find what leaves them open.

## 1.13.0 - 2026-11-24

### New
- **Sub Calculator data, daily:** newer loot and breakpoint data (XIVStats, Pepper's guide) is now checked every day and
  published once it passes the checks. The app downloads it once a day, or when it next opens after a day missed, and
  uses it when it's newer than the copy it came with, so a patch's new data no longer waits for an app update. Nothing
  changes when it can't be reached.
- **Subs → Repair in:** how many more voyages each sub can go on its current route before a part needs repairing, from
  the plugin's last workshop reading of its parts. "Repair now" in red, 1 voyage in amber; the part and its condition on
  hover.

### Changed
- **Experience** with a bonus is now in whole points per sector, as the game gives it (Voyage Planner, Route Finder,
  Compare Builds, Levelling Plan).

## 1.12.1 - 2026-11-23

Fixes to the Sub Calculator and the market price, from a full check of 1.12.0.

### Faster
- **Route Finder** and **Compare Builds** search only for the routes they show, in the background: "Any" on a 30-sector
  map takes a fraction of a second instead of several, and the rest of the app no longer waits on it. With the list cut
  to the best 100, the count reads "The best 100 routes" (the full count shows when every route fits on the list).
- **Build Finder** searches in the background too, so the rest of the app doesn't wait on it.
- Reopening a Sub Calculator page keeps the market prices already fetched.

### Numbers
- **Repair kits:** a part can still sail until its condition reaches 0, so it lasts one voyage longer than shown before,
  and a repair is always a full one. Kits a day and "parts last" were up to 45% too high.
- **Levelling Plan:** a stage's Exp a voyage and Exp an hour are now its averages, not its first voyage's (they grow with
  rank inside a stage).
- **Levelling Plan:** the "not discovered yet" hint looks at every rank of a stage, not just its first, and says the rank
  when it's later.
- **Levelling Plan:** when the parts can't fly any route at all, it suggests the one part swap that lets the sub level.
- **Compare Builds:** a build whose parts can't be fitted at its rank says so ("Its parts can't be fitted until rank 50")
  and gets no voyage numbers or green "best" marks.
- **Market price:** the check against last week's sales no longer overrides three or more listings that agree with each
  other: that's the market dropping, not a lone low listing. Undercuts show again on Gil & Market, and Income values the
  loot at what it sells for now.
- Routes that tie exactly (same time and range) always come in the same order.

### Pages
- Build Finder, Compare and Levelling no longer show old results after their goals or builds are cleared mid-search, and
  the Levelling Plan's "Working out…" can't stay on for good.
- Levelling Plan: a target at or below the sub's rank (after changing the rank, or a sub that levelled past its target)
  moves to the next rank up.
- Add (Voyage Planner, Build Finder, Compare) can no longer put in a sector from the map before, or one twice.
- Route Finder: an item picked on one map is cleared on another; "Working out the routes…" and the dimmed table as on
  the other pages; the click hint always shows under the tiles.
- Voyage Planner shows the real error when a plan can't be worked out; stale prices say from when.
- Build Finder shows "Working out the builds…" from its first search; "Clear goals" has room next to the count.
- The Levelling Plan's sector note is the same size as the text around it.
- Gil & Market: the columns read "Market on World/DC/Region" (the price can be the recent sales'); Settings no longer
  says the Shopping List uses that price.

### Your data
- Removing a character also removes its sub part readings, and the sectors and part readings of a Free Company no one
  is left in, so the Free Company pickers don't show a nameless "Free Company …".
- Releases ship the Sub Calculator data the tests ran on (and the plugin has). A weekly check says when XIVStats or
  Pepper's guide has newer data.

## 1.12.0 - 2026-11-23

The Sub Calculator: five new pages for planning sub builds, routes and levelling, under a new Sub Calculator group in
the sidebar.

### New: the Sub Calculator

- **Voyage Planner.** Pick a rank, four parts and up to five sectors, or start from one of your subs, and see:
  - the build's surveillance, retrieval, speed, range and favor;
  - the range the route uses against the sub's, the voyage length, experience and ceruleum, with Best order to put the
    sectors in the fastest order the sub's range allows;
  - for each sector, the loot tier, retrieval and double dip the build reaches (amber where XIVStats and Pepper's guide
    disagree, with how much more of a stat it needs);
  - the loot it can bring back, with how often ("about 1 in 15 voyages") and what one is worth, gil per voyage and per
    day, experience per day with the bonus the build is sure of (and the most luck can add), and repair kits a day
    (parts' wear as Submarine Tracker predicts it).
  With Live Market Prices on, the loot is priced on the market, on a world, data center or region you choose (your sub's data center to start).
- **Route Finder.** Two tabs:
  - **Best routes:** for one of your subs (or any parts and rank), a map, and what to go for (experience, gil or a
    chosen item), every route of up to five sectors that fits the sub's range and the longest voyage you pick, best
    first, with the loot tier at each stop and the range to spare. The map's sectors are tiles coloured by what your Free
    Company has done (explored, explore next, could open by chance, not yet); click one to make it a must, again to leave
    it out. Only sectors your FC has discovered are used, and routes that explore something new can go first. With Live Market Prices on, gil is at market prices on your data center.
  - **Unlocks:** what your FC is sure to explore next, what could open by chance and from where, and the way to the next
    map, step by step.
- **Build Finder.** Pick up to five sectors and what you want from each (a loot tier, optimal retrieval, a double
  dip, or particular items), and see every build that gets it, at the lowest rank its stats and parts allow:
  - what the goals need, the rank and the route's range, and each build's stats with what it has to spare (hover a "+"
    for what it's measured against), its voyage, and the parts you'd still need to get;
  - amber where only the lower of XIVStats' and Pepper's figures is met, or only builds sure to reach it;
  - sorted by lowest rank (grouped by rank), fastest voyage, fewest parts to get or most range to spare;
  - **Find an item:** every sector on every map that drops it, with the rank it needs, the tier, how often and how many
    at each retrieval; Add puts it in as a goal;
  - **Only these parts:** a filter per slot (Any, Standard only, Modified only, Ones I own, or parts to tick); a slot's
    Any is highlighted while it has a filter.
- **Compare Builds.** Up to three builds side by side: one of your subs, one typed in, or Add to compare from the
  Build Finder and Voyage Planner. **Same route** compares the builds alone (a build that can't fly it says why);
  **Best route each** gives each build its own best route on a map, for experience or gil. Rows: the five stats, range
  used, voyage, experience and gil a voyage and a day, repair kits, gil after repairs, and what each build reaches at each
  stop; the best in each row is green.
- **Levelling Plan.** A sub's way from its rank to a target (its next build's rank to start, else the top rank),
  each voyage on the route best for experience an hour at its rank, experience carrying over as the game gives it:
  - voyages, days and the date it gets there, ceruleum and repair kits, and a strip showing each stage's share;
  - the stages as a table: ranks, time, voyages, route (with the sectors a new rank opens), parts, voyage length and
    experience, and, where a sector your FC hasn't discovered would do at least 1% better, by how much;
  - one sub, or every sub in a Free Company (a row each, with its own target);
  - keep the build, or suggest part swaps on the way (only parts the sub's rank allows; Standard parts only if you like),
    each saying whether you have the part and how much sooner it gets there, as a line before the stage that uses it;
  - **Use every sector:** the plan as if every sector were discovered.
  A plan from rank 1 to 145 takes about a second; changing a choice starts the new plan at once. It's worked out away from the app's other pages, so they aren't held up.

### Across the Sub Calculator

- **Choosing a sub or a Free Company:** a panel grouped by account label (characters and Free Companies in Character
  Roster order, with their world), with a search.
- **Tables like every other page's:** columns to size, move, sort and choose.
- **Clear buttons** on every search and selection: Clear sub, Clear route, Clear marks, Clear goals, Remove all builds,
  Reset target(s). Each shows only while there's something to clear.
- **"Working out…"** while a page works out its answer, the old answer dimmed until the new one is in.
- **An amber note for a part the rank can't fit yet** on the Voyage Planner and Compare Builds ("Not fittable at rank 10
  yet: Modified Whale (Hull) needs rank 50."); the build is still worked out as typed.
- **The game data behind it:** the loot each sector can give, by tier, and the stat breakpoints, from XIVStats with
  Pepper's FFXIV Ship Guide's beside them, shipped with the app and read again at each release. Surveillance, retrieval and
  favor are worked out from the game data alongside speed and range.

### Elsewhere

- **Open in Voyage Planner** on each row of the Subs and Route Optimization pages.
- **Fight Club routes your FC can't run yet are marked** on Subs and Route Optimization: "needs R" (hover: where it opens
  from), with the best Fight Club route the FC can run now below it.
- **The next build on the Subs page stops at the game's top rank (145).** The game's rank table also lists experience
  "to the next rank" on the top rank, so the top was taken as 146.
- **Market prices skip odd listings** (Income, Gil & Market and the Voyage Planner): a lone listing far below the others is
  skipped, and a price still far under the last week's sales uses those instead. A price changed this way is amber, with
  a hover saying why; Income lists the items whose prices were changed.
- **The repair kit price is set on the Supplies page**, beside what to buy, instead of in Settings.
- **Column widths are saved once, when you let go** of a column's edge, not at every move of the mouse.
- **Database updates 17 and 18:** tables for the plugin's readings of each sub part's condition (so the Sub Calculator
  can later work out how much each voyage wears your parts; nothing shows it yet) and of which sectors each Free Company
  has unlocked and explored (used by the Route Finder and Levelling Plan).

## 1.11.0 - 2026-11-21

Fixes from a full check of the app and the plugin. This entry grows until 1.11.0 is released.

- **Remove everything keeps the plugin's fleet file.** The app's settings folder is also where the plugin keeps its
  fleet file (Just this PC), its choice for the PC and their backups. Remove everything deleted the whole folder;
  it now deletes only the app's own files, and lists the fleet file under what it keeps.
- **Restoring a backup works after an update that added fleet views.** Before, any backup made before such an
  update failed to restore with a PostgreSQL message about CASCADE. The fleet views are now set aside first and made
  again straight after, whether the restore worked or not.
- **Summary, Subs, Routes, Salvage, FC Directory and Inventory's Fleet totals recover once the database is back.**
  After one failed load they kept showing "Failed to load" until you switched pages. Inventory's Fleet totals now
  also follow the app's refreshes.
- **Restoring a backup pauses the plugins on your other PCs first**, as moving the database does, so their syncs can't
  block it or write over it straight after.
- **Backups use tools new enough for the database:** an older PostgreSQL installed on the PC for something else is
  passed over for the downloaded tools, and when none are new enough it says so plainly.
- **A damaged fleet file isn't backed up** by Back up now, so the good backups aren't pushed out.
- Testing a backup, or getting the backup tools, can't crash the app if the network drops meanwhile.
- "Let other PCs connect" fixes a firewall rule left on another port (after setting PostgreSQL up again).
- Set up this PC checks the PostgreSQL and Tailscale installers again just before running them with administrator
  rights.
- Moving the database works when the Windows user name has letters outside English, and a refused password with such
  letters is said so.
- Removing a copy a move left behind names the PCs that may still need it to find the new address, and the move window
  says to close the app on your other PCs first.
- The nightly backup run always quits within a minute of finishing, even if saving the subs' forecasts is held up.
- **Income is much faster for a big fleet:** on 80 characters with two months of history it took over two minutes;
  now about two seconds (the same answers). The plugin's Income page uses the same view.
- **The shared database and the fleet file sort the same way:** names and account labels go letter by letter whatever
  language the database PC's PostgreSQL was set up in, and missing names sort last on both.
- Windows of a number of days are exactly that many 24-hour days on both, so they don't shift by an hour after a
  daylight-saving change.
- A house warning now says "the game can demolish it in 3 more days" instead of "demolished after 3 more".
- Database updates wait at most 10 seconds for a table another PC is using, then try again later.
- **Just this PC: the app no longer freezes while a game is writing the fleet file.** It waited up to 15 seconds
  with every window stuck; now it waits a moment at a time, staying responsive.
- **Just this PC: while the game data is first downloading, pages say so** instead of showing an SQL error, and
  tables a first download missed are fetched again by themselves.
- Trends charts show connection problems in plain words, and follow a moved database, as every other page does.
- A saved connection that can't be read on this PC (copied from another PC) says to enter it again, instead of a
  technical error on every page.
- Settings only reuses the saved password for the address it was saved for, and checks the address, port, name and
  username before saving.
- Safety: the window can't be replaced by a dropped file or a link, a database password in SQL never reaches the log,
  and a spreadsheet export also guards cells starting with a tab or line break.
- Another PC updating the database makes pages say so after a minute, instead of waiting forever.
- Game data tables loaded by hand with number columns can now be updated.
- **Current gil/day picks the Fight Club row for the sub's own build** (or, failing that, the fastest one its rank
  clears), not whichever row comes first in the spreadsheet. The plugin does the same.
- **Shopping List ticks aren't lost** when ticking while the list reloads, or on two PCs at once.
- **Settings doesn't save stand-in values:** if a section couldn't be read (the database offline), it says so instead
  of showing 0s that Save would write back. A section with edits not saved yet says "Not saved yet" beside its Save.
- **Not synced, with no account labels:** characters are grouped by the PC they last logged in on, so closing one
  game no longer marks another game's characters as not synced.
- A character whose supplies aren't known yet isn't counted as low on them.
- Free Companies: an FC short on both rank and days says both ("Rank 2/6, and 25 more days").
- Just this PC with Live Market Prices: Income's retainer counts are right (they counted letters).
- Shopping and market prices: the Shadow data centre is known, and Universalis's own list is asked again later if
  it couldn't be read at first.
- Sub Rules, the Roster's order, and other changes are checked before saving, and saved all or nothing; the Roster's
  order is saved in one go. The FC Rank column reads ranks like "Rank 8".
- **A page that couldn't refresh keeps what it showed**, with "Could not update: ..." above it, instead of replacing
  it with an error. A screen whose request failed outright (setup, backups, updates, imports) says why and can be
  closed or tried again, instead of staying on "Loading..." for good.
- **Inventory follows Refresh and Auto-Refresh** on every tab, keeping the characters or FCs chosen. A load that fails
  shows under the picker, so another choice can be made.
- **Sub Rules and retainer gear targets show changes made in the game** after a refresh, unless the row has edits not
  saved yet ("Not saved yet"). Saving or deleting a Sub Rule updates the parts beside it. Delete asks first (Delete it /
  Keep), as in the plugin, and saving one new rule no longer throws away other new rows not saved yet.
- Subs: ticking Fight Club builds updates Next build and Target route straight away; if it can't be saved, it says why.
- Shopping List: a "Made" number that couldn't be saved goes back, rather than looking shared when it isn't.
- Income: changing "Income over the last N days" updates Loot per Voyage and Retainer Ventures too.
- Market and Supplies: a refresh no longer replaces a number being typed; a value that isn't saved goes back, with the
  reason beside its box.
- Backups: a second-copy folder on a PC that's switched off no longer freezes the app; it says the folder can't be
  reached.
- The Roster keeps a drag's new order when a refresh lands at the same moment.
- Set up this PC, "This PC only plays the game": says where to find the database PC's details, instead of a link that
  did nothing.
- Where Is It?: two FCs (or retainers) with the same name are listed apart.
- **Trends remembers what was chosen** (value, characters, span) when leaving the tab and coming back, and never shows
  the previous chart under a new label while the new one loads. A character's "FC points" card says it's recorded
  only for an FC's leader, rather than looking like missing history.
- Summary: Venture Income and Listings say why they couldn't load, instead of always asking for a database update;
  Parts That Need Crafting counts the same characters as the list beside it.
- Route Optimization: with no sub off its Target route, it says why (no sub at rank 85 yet, or no Fight Club Data
  imported) instead of always "all on target". A gain of 0 shows without a +.
- Inventory and Parts: the sub-tab showing is marked, not greyed out as if it couldn't be used.
- Keyboard and screen readers: table headings sort with Enter, column widths change with the arrow keys, Settings
  closes with Escape, the Trends picker works with the arrow keys and Enter, and icon buttons are named.
- Widths of columns added from the Columns menu are remembered after a restart. Copying a table, the shopping list or
  setup details says so if it fails. Retainer countdowns share one clock. The Subs tab lists characters in the same
  order as the other tabs. Inventory quantities have thousands separators.
- Setup Help points to Settings → Database → Test Connection on the other PC, rather than the Tailscale page.
- Gil & Market: the note under unsold listings no longer says undercutting isn't checked while Live Market Prices is on.
- Fight Club Data: merged cells are read right when the sheet doesn't start at A1 (as the plugin now does too).
- Sub Rules' All tick can be unticked (slot 1 stays ticked), as in the plugin. The PCs page and Roster say "another
  PC or account" instead of "another game", and the note about PCs that haven't reported reads right for several.
- **High-quality items say "(HQ)"** on Inventory's Character, FC and Fleet tabs (they showed as "Item 10xxxxx"), and
  in a retainer's gear. The plugin now records which stacks are high quality.
- **A database move that fails after every PC was sent to the new database keeps it** (nothing is lost, and syncing
  carries on); only this app's own saved details failing is reported.
- Views only gain columns from now on, so an older plugin on another PC keeps working when this app updates the views
  (checked by the tests against every column released so far).
- Releases are published only after the full tests pass.

## 1.10.6 - 2026-11-20

- **Removing a character on the Character Roster also removes its market listings.** Before, its retainers' listings
  stayed on Gil & Market, getting older and showing as unsold for a while.
- **Gil & Market shows only the listings of characters on the roster**, so listings left from a character removed
  before this version don't show either.
- The plugin (2.4.6) can now remove characters too, from its own Character Roster.

## 1.10.5 - 2026-11-19

- **A sub almost at its next rank shows 99%, not 100%**, on the Subs page: it showed "68.100" and sorted as if it were
  already the next rank. The plugin now shows the rank the same way (68.81).

## 1.10.4 - 2026-11-16

Simpler for new players: one clear way to do each thing, and nothing they don't need.

- **The setup screen starts with "I play on one PC"**: nothing to install, only where to click in the game (**Keep it on
  this PC**), after which the app opens the fleet by itself. "Everything on this PC", which installed a whole PostgreSQL
  database for one PC, is gone. A database already set up that way keeps working.
- **The setup screen no longer asks "full app or Database Helper?"**: it opens the full app. Settings → General → This
  PC shows still switches.
- **With no fleet yet**, the pages say how to get one for one PC as well as for a shared database.
- **Fight Club Data has a link to Fight Club's spreadsheet** (Settings → Data), and says how to save it for the import.
- **Game Data** is described in plain words, without the source's name and code.
- **Clearer names on the pages**, the same as the plugin's: the Subs page's **Craft?** is now **Fight Club builds**
  (ticked: from rank 85 the sub follows Fight Club's best build, as its hover says), the Parts page's **Sub Build
  Rules** are **Sub Rules**, pages are called pages (not tabs), and "setup" is now "game" (as in "synced by another
  game"). Column names are written one way throughout (Next build, Target route, Quantity).
- No more mentions of plugin versions everyone already has (0.10.0, 1.0.2). Plainer messages on an empty Inventory, when
  nothing needs crafting, and after a game data update.

## 1.10.3 - 2026-11-13

- **No connection saved no longer leaves pages on "Loading..."**: with no database connection saved on this PC (setup
  skipped, or a saved one Windows can't read), every page now says so and where to enter one, instead of most pages
  loading for good.
- **Inventory shows only what's chosen**: picking another character or Free Company while the last one was still loading
  could show the earlier one's items. Only the answer for what's chosen now is shown.
- **Auto-refresh is kept to whole minutes from 1 to 1440.** A value outside that (a negative number, or more than about
  24 days) made every page reload nonstop. One saved before reads as the usual 5 minutes.
- **The database tools check the port first**: New database, Move the database to this PC and Leftovers take a whole
  number from 1 to 65535, and say so plainly otherwise, before anything starts (a move installs PostgreSQL on it). A
  port box left empty or with letters no longer quietly becomes 5432. The same as the plugin's (2.4.2).
- **Parts: the Sub Build Rules panel stays within the page**, however wide it was dragged or the window is now, so the
  parts table always keeps its room.
- Auto-refresh keeps going at 5 minutes if its setting can't be read, instead of stopping.

## 1.10.2 - 2026-11-13

- **One window at a time.** Opening the app while it's already open (the desktop icon, the Start menu) brings the open
  window to the front instead of starting a second copy alongside it.
- **The window opens where you left it**, at the same size, and maximized if it was. If that place is no longer on a
  screen (a screen unplugged), it opens on the main screen instead.
- **Live Market Prices give up after 20 seconds** when Universalis doesn't answer, and say so ("no answer in 20
  seconds"), instead of a page waiting on it for up to 5 minutes. The same as the plugin's (2.4.1).
- A download that's cut off part way during Set up this PC closes and removes the part-downloaded file before saying
  what happened.
- Electron 44.11.3, which has a security fix 44.9.0 didn't.

## 1.10.1 - 2026-11-10

- **Trends: salvage shows "Gained a day".** Salvage value and salvage items climb, then drop back when you sell, so "A
  day on average" counted every sale as a loss and showed next to nothing. For salvage it's now "Gained a day": every
  rise over the span added up, drops from selling left out. Everything else keeps "A day on average". The same as the
  plugin's (2.3.1), on a database or the fleet file.

## 1.10.0 - 2026-11-08

- **The app opens the plugin's fleet file.** A PC where the plugin keeps the fleet in a file ("Keep it on this PC",
  plugin 2.2 and later) needs no database for the app either: it opens the same file by itself, following the game's
  choice for the PC.
  - Every page works on the file, and edits (Sub Rules, Craft?, gear targets, the Roster order, settings, the
    Shopping List's ticks, removing a character or a PC, the Fight Club import) go into it, for the game to see.
  - No setup screen and nothing to connect. The header says **Fleet file**.
  - **Settings → Database** shows the file and the plugin's last check of it; **Settings → Backups** its backups,
    with **Back up now** (putting one back is done in the game); **Settings → Data → Game Data** updates the app's own
    copy of the game data (item names, recipes...), which is filled in by itself the first time.
  - The database tools (moving it, the speed check, the nightly database backups) aren't shown, as there's no
    database.
  - Checked by making every page's call and every edit on the same fleet in a database and in a file, and comparing
    the answers and the tables afterwards.
- A few lists now keep the same order every time when two rows tie (Sub Rules of the same rank, retainers' gear,
  Free Companies of the same name, items held in the same amount).

## 1.9.0 - 2026-11-07

- **The Database Helper: the app with only its database tools.** The same download now opens one of two ways, per PC
  (**Settings → General → This PC shows**):
  - **The full app**: your fleet's pages and the database tools, as before. Every PC that's already set up stays on it.
  - **The Database Helper**: only the database tools, with no fleet pages. For the PC that keeps the database, or one
    that only plays with the plugin, where your fleet is in the game anyway.
  - The Database Helper opens on its own page: where the database is, whether it answers and is up to date, this
    PC's backups and how many PCs use the database, with buttons to setup, moving the database, and backups and restore.
  - The PCs page stays, and the Database Helper still updates the database and makes the nightly backup, as the full
    app does.
  - The fleet's own settings (what you run, live prices, repair kit cost, warnings) leave Settings there. They're
    also in the plugin, and on any PC that opens the full app.
  - The setup screen asks the first time too: a PC that only plays suggests the Database Helper, the others the
    full app.
  - Neither is the database itself (that's PostgreSQL). It's for that PC only: **Open the full app** switches
    back, and nothing is lost either way.
- **Plugin 2.1.0 keeps the database up to date too**, with a copy of the app's own update files, so a PC with only
  the plugin needs no app open after an update. The app and the plugin take turns, and neither undoes the other's.

## 1.8.1 - 2026-11-07

- **Trend charts draw their line again.** Since 1.8.0, every chart with one line (and the first line on charts that
  compare several) drew almost black on the dark background. It's back to blue, with its shading.

## 1.8.0 - 2026-11-07

For plugin 2.0, which shows the fleet inside the game. The app updates the database by itself (updates 14 to 16); nothing to
do by hand.

- **Ready-made views of the fleet in the database**, so the plugin can show the Summary, Subs and Supplies in the game
  without the app running: every built sub with its build and whether it's out, back or in port; each character's
  ceruleum and repair kits, how many it uses a day, days left and how many to buy; and the fleet at a glance. The
  database works out the use per day itself (the same way as the Supplies tab), so the plugin reads a few dozen rows
  instead of weeks of history. Nothing in the app changes.
- **What needs attention**, for the plugin's in-game Summary and its line in the game's info bar: Free Company houses
  not entered for the house warning's days (or with no date yet), characters below the low-supply warnings,
  characters no longer synced, and setups where AutoRetainer wasn't running. The same rules as the app's Summary;
  characters no longer synced are left out of the low-supply counts there too.
- **A new submarine icon** for the app's window, taskbar and installer: steel blue with amber portholes, drawn clear at
  every size from 16 to 256 pixels. It matches the plugin's new picture.
- **The Roster, Retainers and PCs for the game** (plugin 2.0's next pages): every character with its Free Company,
  house, supplies (and whether they're below the warnings, by the Roster's own rules), retainers, subs and the setup
  that syncs it; every retainer with its class, venture, gear target and what it wears; and every setup of the
  plugin. The views give the game's numbers for classes, ventures and items, never names, so they work on a database
  that has no game data yet; the plugin names them from the game's own files.
- **Free Companies and Inventory for the game** (plugin 2.0's next pages): every Free Company with its house, how long
  since a member entered it and when it can bid; every stack of every item held (bags, retainers, Free Company chests),
  with the same place names as Where is it?; and the fleet's totals per item. The Free Companies tab's own working out
  moved into characters/fc-directory-rows.js so the game's is checked against it; a Free Company whose rank isn't a
  number now reads "Rank too low (?/6)" instead of "NaN/6".
- **Retainer counts for the game's Summary, the same as the app's:** retainers of characters no longer synced, and of
  characters not in the Roster, are left out, and a venture with no end time counts as away. The game reads them every
  30 seconds instead of every 5 minutes, so a retainer caught between two ventures while AutoRetainer sends it out
  again clears within a minute.
- **Salvage and Income for the game** (plugin 2.0's next pages): the salvage each character holds (with its Free
  Company chest's, on the same member as the Salvage tab), each character's real net income from its subs over the
  Income window (salvage that came in, less repair kits used, the same way as the Income tab), and the venture rewards
  over that window. Fight Club's expected figures come later in 2.x, with routes.
- The Roster's view also gives each character's sub slots and the low-supply warnings themselves, so the game can show
  subs as dots out of the slots and colour supplies by how close they are to the warnings.
- **Retainer Ventures leaves out characters no longer in the Roster** (on the Income tab and the Summary's venture
  income), as Trends does. A removed character showed as a long number with its old rewards; its rewards stay recorded,
  so adding it back brings them back.
- **Searching word by word**: every search box (Where is it?, the inventory item searches, the character and Free
  Company pickers, Parts, Trends and the Columns list) now finds names with every word typed, in any order:
  "diadochos healing" finds every piece of Diadochos healing gear.
- **Hide equipped gear** on the Inventory tab's Characters, Fleet totals and Where is it?: leaves out gear being worn by
  the characters and their retainers. One choice for all three, remembered.
- **The same colours as the plugin's tables**: green when fine, amber getting low, red well below a warning (the
  Roster's ceruleum and repair kits, Last Synced, Supplies' days left, Income, the PCs' plugins and what they could
  not see, retainers' ventures, houses), subs as dots out of the slots unlocked on the Roster, gil in gold (large
  amounts as "5.86M", the full amount on hover), house addresses in blue, Free Company names in lavender, worlds
  softer, and numbers on the right. The warning colour is now orange rather than gold, so it's never mistaken for gil.
- **Every column can be resized, the last one too**: a table keeps each column at the width it's given instead of
  stretching them all to fill the page, so dragging the last column's edge works, the room left over sits after it,
  and a wider table scrolls sideways.
- **Character and world together**: every table with characters (Roster, Retainers, Subs, Supplies, Salvage, Income,
  Route Optimization, Parts, Where is it?, the Summary's lists) names each with its world after it, softer, instead of
  a separate World column, as the plugin does. A copied or exported table gives it as "Wa'kana Gojo (Cuchulainn)".
  Free Companies the same (the Free Companies tab, the Summary's house warnings and Supplies' FC credits): the FC's
  name with its world after it.
- **Livelier Subs and Retainers**: a thin bar beside each sub's rank for how far to the next, softer dashes in builds,
  subs back in green and in port softer; each retainer's owner named once, its class in its role's colour (tanks
  blue, healers green, damage red, a base class such as Gladiator or Conjurer a lighter shade) with the level softer,
  Avg ilvl green when the gear meets the gear target and amber when it falls short, and the time a venture is done
  after its countdown.
- FC points in aqua, and ceruleum and repair kits that don't count toward the warnings (no sub built, or not synced)
  dim rather than plain.
- **The Parts tab's inputs for the game** (plugin 2.0's Parts page): every character's sub slots and FC, every built
  sub's parts and Craft? tick, the Sub Rules, Fight Club's recommended builds with the repair kit price, and every spare
  sub part in bags, retainers and FC chests. The plugin works the parts out itself, the same way as the Parts tab (a
  shared FC chest can't give one part twice, which a view does badly); tests/db/parts-fixture.js writes made-up fleets
  and the Parts tab's answers for the plugin's tests to check against. The one-file (SQLite) version gets the Sub
  Rules, Craft? and Fight Club tables too.
- The Parts tab reads everything in a fixed order (a character's own spares before its retainers', Sub Rules and Fight
  Club routes as they were made), so the same fleet always gets the same answers: before, which of two identical spares
  it named could depend on the database.
- **Subs Ready for New Parts lists new subs to build too** (on the Summary): a sub not built yet in an open slot gets
  its own row with its first build's parts, its rank shown as "new", and a line above says how many of each ("7 subs
  are ready for new parts, 1 new sub to build"), as the plugin's Summary.
- **Gil and the market for the game** (plugin 2.0's Gil & Market page): gil per account, every listing with how long
  it has been up and whether that's unsold for a while (the Gil & Market tab's days), and the Gil & Market settings
  (those days, and whether Live Market Prices is on). Venture rewards now say how many were high quality, so the game
  can price them apart as the Income tab does. The plugin asks Universalis itself when Live Market Prices is on, the
  same way as the app; tests/market-fixture.js runs the app's own Universalis code on canned listings and writes its
  answers for the plugin's tests to check against.
- **Live prices come in faster.** Universalis is asked up to 4 requests at a time instead of one after another, and
  each world, data center and region once (worlds on the same data center share its answer).
- **Routes for the plugin.** New views (fleet_route_subs_view, fleet_route_fight_club_view, fleet_sub_history_view,
  fleet_voyage_sectors_view, with SQLite twins) give the plugin what the Subs tab's routes, gil a day and rank-up dates are
  worked out from; tests/db/routes-fixture.js writes made-up fleets and the app's answers for the plugin's tests. The Subs
  tab now reads Fight Club and the Sub Rules in a fixed order, so the same fleet always gets the same answers.
- **Route colours, as in the plugin:** Current and Target Gil/Day in gold, Target Route green when a sub is on it and
  amber when it isn't, a Next Build it can switch to now in green, Route Optimization's gain green (red for less), and
  Income's Expected / day in gold.
- **Loot per Voyage and the Next Rank forecasts for the plugin:** fleet_voyage_loot_view, fleet_rankup_forecast_view,
  fleet_rankup_history_view and fleet_voyage_returns_view (with SQLite twins). Loot per Voyage picks a sub's character in
  a fixed order. Its gil a voyage and Expected / day are now gold and its value a day green, as in the plugin.
- **The Shopping List for the plugin:** fleet_shopping_held_view (what's held where, as the Shopping List counts it)
  and fleet_shopping_progress_view (the ticks), with SQLite twins; the plugin works the list out itself from the game's
  own recipes. Places holding as many of an item now always list in the same order. The Shopping List's gil is gold,
  what's still to craft, make, gather or buy amber, and the cheaper of buying or making green, as in the plugin.
- **The Shopping List's market prices look at the 100 cheapest listings of each item** (was 20), so buying a material
  needed in the thousands isn't shown as short when plenty more is for sale. "Only 1,639 of 2,277 for sale" now means
  just that, and its hover says what those cost and that the rest can't be bought there right now.
- **Craft first's market board prices have the same hover** as the other sections: what buying the ones still to make
  costs, from the cheapest listing up (with "only X of Y for sale" when there aren't enough). The totals stay for
  parts and raw materials.
- **Trends: a day on average, and a table of lines.** Beside a single line's now and change, its change a day on
  average; under a chart comparing characters or Free Companies, each one's now, change, change %, a day on average,
  lowest and highest (as the plugin's new Trends page). Rises are green and falls amber on the Summary's tiles and the
  tab charts, as in the plugin. The plugin's Trends page is checked against the app's answers for a made-up history
  (tests/db/trends-fixture.js).
- **The plugin can now make the app's edits from the game** (Sub Rules, Craft?, gear targets, the Roster order, unsold
  days, the Income window, removing a PC, Shopping List ticks), checked against the app's own: tests/db/edits-fixture.js
  makes each edit through the app's calls and records the database after it.
- **Summary's subs ready for new parts: one part to a line**, the class then the slot ("Shark Hull (to craft)"), "to
  craft" in amber, as the plugin's. The Parts tab's tables show Needed before Slot by default.
- **Gil in gil's gold everywhere:** Income's and Gil & Market's cards and notes, Supplies' repair kit cost, the Summary's
  venture income, unsold listings and salvage total, and the Gil and Salvage value trends.
- **Gear targets no longer count an empty off-hand** for classes whose weapon fills both hands: only Gladiators,
  Paladins, Miners and Botanists have one, so the Avg ilvl breakdown no longer lists Off-hand as Empty for the rest.
- **The shared settings for the plugin:** fleet_settings_view gives the Warnings, the repair kit cost, Live Market
  Prices and What do you run? (with what "work it out" decides from), so the plugin's Settings can show and change them.
- **The Warnings and the repair kit cost check what's typed:** whole numbers, 0 or more (a blank box, a fraction or a
  negative number is refused with a reason instead of being saved).
- **Fight Club data from the plugin:** the plugin can import Fight Club's route spreadsheet too, read the same way as
  here; the SQLite twin of the routes table now has every column. Its tests check it against this app's own reading of
  some awkward spreadsheets (tests/db/fight-club-fixture.js). An import that can't reach the database now says so
  instead of failing silently.
- **PCs that only read** (plugin 2.0, database update 16): a PC whose plugin syncs no characters checks in while the
  game runs. The PCs tab lists it ("Only reads", seen when), and **Move the database to this PC** checks it like the
  others (its plugin version and login) instead of skipping it.
- **Looks, as in the plugin** (Settings → General → Look): XIV Fleet Companion (as before), High contrast, Princess,
  Deep Sea, Sunset Harbor, Parchment (a light look) and Evergreen, with a strip of each look's colours. Kept on this PC.
  **Colour-blind friendly status colors** too: blue, yellow and orange-red for fine, a look and urgent, shaded for each
  look; gil, addresses, Free Companies and classes are then plain text. Every look is measured by the tests
  (tests/themes.test.js): text contrast, every colour that means something readable on its background, and the
  colour-blind colours apart with each common kind of colour blindness. The plugin's tests check it has the same
  colours (tests/themes-fixture.js).
- **The sidebar in groups, as the plugin's:** Overview (Summary, Trends), Submarines (Subs, Route Optimization, Parts,
  Supplies, Salvage), Characters (Character Roster, Retainers, Free Companies, Inventory), Gil (Income, Gil & Market)
  and System (PCs). A group with nothing to show (Submarines with retainers only) is left out.
- **SQLite twins of every view** (db/sqlite/), for the plugin-only one-file version planned later in 2.x, checked row
  for row against PostgreSQL with made-up fleets. "Needs attention" now orders ties letter by letter, so it's the same
  whatever the database's language setting.
- The views live in one file the app applies again whenever it changes, so later versions can improve them without a
  database update each time (update 15 records which version a database has). An older copy of the app never
  replaces a newer one's views.

## 1.7.0 - 2026-11-05

Goes with plugin 1.0.3. The app updates the database by itself (update 13); nothing to do by hand.

- **The Discord alerts are gone.** Settings no longer has a Discord Alerts tab. Alerts are planned inside the game
  instead, on the plugin's Summary, in a later version.
  - On a PC that had them set up, the app removes what they left behind the first time it starts: the scheduled task
    that checked every 5 minutes, the saved webhook address and the alerts' own files. Uninstalling also removes that
    task, in case the app never started again.
  - Their settings are removed from the database, except one the app still uses.
- **Settings → General → Warnings** now has that setting: how many minutes a character can fall behind the rest of
  its account before the Roster, Subs and Retainers tabs mark it as not synced (10 to 1440, 30 by default). It was
  "Plugin has sent nothing new for N minutes" under the Discord alerts, and keeps the value you had there.
- A failed nightly backup is shown in Settings → Backups, as before.

## 1.6.0 - 2026-11-05

Goes with plugin 1.0.2. The app adds two tables and a column to the database by itself (update 12); nothing to do by
hand.

- **The app says when new game data is available.** Once a day, the app asks GitHub whether any of the game data
  files it uses (items, recipes, submarine parts and sectors, and so on) have changed since the game data was last
  updated, usually after a game patch. Only the dates the files changed are asked for, not the files, and with the app
  open on several PCs only one of them asks each day. When something is new, a bar under the header says so: **Update
  now** runs the same check and update as **Settings → Data → Game Data** (backing up the old game data first), and
  **Later** hides it on that PC until something newer changes. Nothing is changed until you click.
- **Only the setup a character last logged in on syncs it** (with plugin 1.0.2). Each setup of the plugin now notes
  in the database when a character logs in on it. A setup leaves alone a character that last logged in on another
  setup, so an old copy of it in that setup's AutoRetainer can't overwrite it any more. Characters that haven't logged
  in anywhere since the update keep syncing as before, and there's no time limit: a long break, or the plugins being
  down for a while after a game patch, changes nothing. Removing a character from the Roster removes its login too.
- **Test versions.** Tick **Get test versions** in **Settings → General → Updates** and that PC gets new versions to
  try before everyone else, numbered like `1.6.0-test.12`. It still gets every normal update too, and turning it off
  keeps the version you have until a normal version is newer. From plugin 1.0.2 on, new plugin versions can be tried
  first too, with Dalamud's testing builds.
- **Who syncs each character.** The Roster's new **Synced By** column names the setup (account label and PC) each
  character last logged in on, which with plugin 1.0.2 is the only one that syncs it. The PCs tab says how many
  characters each setup left to another one.
- **A note when no setup syncs a character.** If a character's setup keeps syncing but leaves it out (its AutoRetainer
  lost it), the Roster and the PCs tab name it; logging in as it once on the right setup fixes it. A character unticked
  in a setup's plugin settings never counts as that setup's, so unticking it on one PC never stops another that syncs it.
- **What's new after an update.** The first time the app opens after updating, it shows what changed in each version
  since you last opened it, until you click **Got it**. The **Restart to update** bar has a **What's new** button too,
  and **Settings → General → Updates → What's new** shows the recent versions any time.
- **A warning when two setups of the plugin sync the same character.** If one setup's AutoRetainer still has an old
  copy of a character another account plays, the two setups keep overwriting each other: its subs can disappear, the
  Parts tab asks for starter parts, and its account label switches back and forth. The Summary and the PCs tab now
  name the character and both labels, and say how to fix it: update every setup to plugin 1.0.2, then log in as the
  character once on the setup that plays it. If you'd rather not wait, AutoRetainer's **Advanced → Character
  Synchronization → Prune deleted characters** on the other setup fixes it straight away. The warning goes away once
  the label has stopped switching for 3 days.
- **A note when a character or a setup of the plugin has no account label.** Without one, the app can't tell which
  account a character is on, setups on one PC share a row on the PCs tab, and the warning above can't work. The
  Roster and the PCs tab say how many have none and where to fill it in (each setup's plugin settings, Account
  Label). Plugin 1.0.2 says the same in the game.
- **The Subs tab's countdowns tick together.** They run off one clock instead of one timer each, so subs back at the
  same moment always show the same time.

## 1.5.0 - 2026-10-20

No database or plugin change.

- **Any PC can make the backups.** Backups need PostgreSQL's own tools, which only the database PC had, so with the
  app uninstalled there nothing was backed up. **Settings → Backups → Get the backup tools** now gets them on any PC:
  it downloads PostgreSQL from its maker in the version the database runs (14 to 18; about 350 to 370 MB, once,
  checksum checked), keeps only the 11 MB needed for backups and restores, and deletes the rest. Nothing is
  installed. Daily backups, Test, Restore and Restore from a file then work on that PC. If Microsoft's Visual C++
  runtime is missing, it says so.

## 1.4.5 - 2026-10-19

No database or plugin change.

- **Uninstalling the app also removes its daily backup and Discord alert tasks on that PC.** Both start the app, so
  once it was gone they failed quietly every time. PostgreSQL, the database, Tailscale, the app's settings and your
  backup files still stay, so you can uninstall the app from the database PC and keep the database running for
  your other PCs. Updates keep the tasks.

## 1.4.4 - 2026-10-19

No database or plugin change.

- **The Shopping List shows where each price comes from.** Hover over a part's To make price for one line per
  ingredient: how many, the price each, and whether that is from a vendor, the market board (with its world) or
  making it, with what goes into anything made. A new **Cheapest** column in Craft first, Gather or buy and
  Crystals says Vendor, Market board or Make for each item. Both show with Live Market Prices on.

## 1.4.3 - 2026-10-19

No database or plugin change.

- **The Shopping List's market board totals add up the listings, as buying would,** instead of multiplying the
  cheapest price by how many are needed. Five hulls with one listed at 600,000 and the rest at 750,000 now total
  3,600,000, not 3,000,000. When fewer are listed than needed, the part says "only 3 of 5 listed", the total
  counts what is listed, and the note says how many have too few. Hover over a price for what buying all of them
  costs. The Market board column still shows the cheapest single price.

## 1.4.2 - 2026-10-19

No database or plugin change.

- **The Shopping List no longer jumps back to the top on every refresh.** It keeps showing the last list while the
  new one is worked out, with "Updating..." beside Copy as Text, so the page stays where you scrolled to. The same
  goes for changing Prices from, Look ahead or Buy from vendors. If an update fails, the last list stays up with a
  note saying so.

## 1.4.1 - 2026-10-19

No database or plugin change.

- **Prices from on the Shopping List lists every world, data center and region,** not only where your
  characters are, so you can price parts on another data center you could travel to. Worlds show their data
  center, like "Maduin (Dynamis)", and your own regions come first. The list comes from Universalis, so new
  worlds and data centers appear by themselves. It still starts on the data center with the most of your
  characters.

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
