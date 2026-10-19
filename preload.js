const { contextBridge, ipcRenderer } = require('electron');

// This is the ONLY bridge between the browser-side React code and the
// Node/Postgres-capable main process. Renderer code never touches Postgres
// directly - it can only call window.api.getRoster(), which is handled
// in the main process (the ipc/ files). This keeps contextIsolation on and nodeIntegration
// off, which is the safe default for Electron apps.

// What each read call last returned successfully, per call and arguments. When the database cannot
// be reached, a read returns that instead (marked `stale: true`), so every tab keeps showing what it
// last loaded rather than an error; the window's banner says the data is from before the
// connection was lost. Writes are never answered from here. Kept to the newest MAX_REMEMBERED.
const READ_CALL = /^(get-|settings:get-|game-data-status$|game-data-backups$)/;
const MAX_REMEMBERED = 200;
const lastLoaded = new Map();

async function invoke(channel, ...args) {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (!READ_CALL.test(channel)) return result;
  const key = channel + '\u0000' + JSON.stringify(args);
  if (result && result.success !== false) {
    lastLoaded.delete(key);
    lastLoaded.set(key, result);
    if (lastLoaded.size > MAX_REMEMBERED) lastLoaded.delete(lastLoaded.keys().next().value);
    return result;
  }
  if (result && result.offline && lastLoaded.has(key)) {
    return { ...lastLoaded.get(key), stale: true };
  }
  return result;
}

contextBridge.exposeInMainWorld('api', {
  getRoster: () => invoke('get-roster'),
  getDataFreshness: () => invoke('get-data-freshness'),
  updateSortOrder: (orderedCids) => invoke('update-sort-order', orderedCids),
  removeCharacter: (cid) => invoke('remove-character', cid),
  pickFightClubCsv: () => invoke('import-fight-club:pick-file'),
  commitFightClubImport: (payload) => invoke('import-fight-club:commit', payload),
  getPostgresConfig: () => invoke('settings:get-postgres-config'),
  savePostgresConfig: (payload) => invoke('settings:save-postgres-config', payload),
  testPostgresConnection: (payload) => invoke('settings:test-postgres-connection', payload),
  getAutoRefreshInterval: () => invoke('settings:get-auto-refresh-interval'),
  saveAutoRefreshInterval: (minutes) => invoke('settings:save-auto-refresh-interval', minutes),
  getConnectionStatus: () => ipcRenderer.invoke('get-connection-status'),
  // The listeners below pass only data, never Electron's event object (that would hand the page the
  // IPC channel itself), and return a function that stops listening.
  // `callback(status)` runs whenever the database becomes unreachable or reachable again.
  onConnectionStatus: (callback) => {
    const listener = (event, status) => callback(status);
    ipcRenderer.on('connection-status', listener);
    return () => ipcRenderer.removeListener('connection-status', listener);
  },
  // Settings → Backups (ipc/backups.js).
  getBackups: () => invoke('backups:get'),
  saveBackupSettings: (settings) => invoke('backups:save', settings),
  chooseBackupFolder: (options) => invoke('backups:choose-folder', options),
  openBackupFolder: (folder) => invoke('backups:open-folder', folder),
  backUpNow: () => invoke('backups:run-now'),
  testBackup: (file) => invoke('backups:test', file),
  restoreBackup: (file) => invoke('backups:restore', file),
  chooseBackupFile: () => invoke('backups:choose-file'),
  restoreBackupFile: (file) => invoke('backups:restore-file', file),
  // Database updates (db/apply-updates.js): { ok, version, created, applied, newer } or { ok: false, message }.
  getDatabaseStatus: () => invoke('get-database-status'),
  checkDatabaseSpeed: () => invoke('database:speed-check'),
  getSpeedDetail: () => invoke('database:speed-detail'),
  getSpeedFindings: (input) => invoke('database:speed-findings', input),
  onDatabaseStatus: (callback) => {
    const listener = (event, status) => callback(status);
    ipcRenderer.on('database-status', listener);
    return () => ipcRenderer.removeListener('database-status', listener);
  },
  // The installed app's updates (updater.js): { version } once a new version is downloaded.
  getUpdateReady: () => invoke('get-update-ready'),
  installUpdate: () => invoke('install-update'),
  getUpdateStatus: () => invoke('updates:status'),
  checkForUpdates: () => invoke('updates:check'),
  onUpdateStatus: (callback) => {
    const listener = (event, status) => callback(status);
    ipcRenderer.on('update-status', listener);
    return () => ipcRenderer.removeListener('update-status', listener);
  },
  onUpdateReady: (callback) => {
    const listener = (event, ready) => callback(ready);
    ipcRenderer.on('update-ready', listener);
    return () => ipcRenderer.removeListener('update-ready', listener);
  },
  onOpenSettings: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('open-settings', listener);
    return () => ipcRenderer.removeListener('open-settings', listener);
  },
  getSubmarines: () => invoke('get-submarines'),
  getRepairKitCost: () => invoke('settings:get-repair-kit-cost'),
  saveRepairKitCost: (value) => invoke('settings:save-repair-kit-cost', value),
  setCraftEnabled: (payload) => invoke('set-craft-enabled', payload),
  getPartsNeeded: () => invoke('get-parts-needed'),
  getShoppingList: (options) => invoke('get-shopping-list', options),
  getSupplies: () => invoke('get-supplies'),
  saveSupplySettings: (settings) => invoke('save-supply-settings', settings),
  getIncome: () => invoke('get-income'),
  saveIncomeSettings: (settings) => invoke('save-income-settings', settings),
  getSubBuildRules: () => invoke('get-sub-build-rules'),
  addSubBuildRule: (rule) => invoke('add-sub-build-rule', rule),
  updateSubBuildRule: (rule) => invoke('update-sub-build-rule', rule),
  deleteSubBuildRule: (id) => invoke('delete-sub-build-rule', id),
  getSalvage: () => invoke('get-salvage'),
  getLowThresholds: () => invoke('settings:get-low-thresholds'),
  saveLowThresholds: (payload) => invoke('settings:save-low-thresholds', payload),
  getFleetWarnings: () => invoke('get-fleet-warnings'),
  getHouseWarnings: () => invoke('get-house-warnings'),
  getCharacterInventory: (cids) => invoke('get-character-inventory', cids),
  getFcList: () => invoke('get-fc-list'),
  getFcInventory: (fcIds) => invoke('get-fc-inventory', fcIds),
  getFleetInventorySummary: () => invoke('get-fleet-inventory-summary'),
  findItems: (term) => invoke('find-items', term),
  getRetainerTargets: () => invoke('get-retainer-targets'),
  saveRetainerTarget: (payload) => invoke('save-retainer-target', payload),
  deleteRetainerTarget: (retainerId) => invoke('delete-retainer-target', retainerId),
  getGearSuggestions: (payload) => invoke('get-gear-suggestions', payload),
  getFcDirectory: () => invoke('get-fc-directory'),
  getAppVersion: () => invoke('get-app-version'),
  getGameDataStatus: () => invoke('game-data-status'),
  checkGameData: () => invoke('game-data-check'),
  applyGameData: (options) => invoke('game-data-apply', options),
  listGameDataBackups: () => invoke('game-data-backups'),
  createGameDataBackup: () => invoke('game-data-backup-create'),
  restoreGameDataBackup: (name) => invoke('game-data-backup-restore', name),
  deleteGameDataBackup: (name) => invoke('game-data-backup-delete', name),
  getColumnCatalog: () => invoke('get-column-catalog'),
  getColumnExtras: (request) => invoke('get-column-extras', request),
  getMetricCatalog: () => invoke('get-metric-catalog'),
  getMetricSubjects: () => invoke('get-metric-subjects'),
  getMetricSeries: (request) => invoke('get-metric-series', request),
  getAlertSettings: () => invoke('alerts:get-settings'),
  saveAlertSettings: (settings) => invoke('alerts:save-settings', settings),
  setAlertsQuietFor: (hours) => invoke('alerts:quiet-for', hours),
  pauseAlertsFor: (hours) => invoke('alerts:pause-for', hours),
  saveAlertWebhook: (url) => invoke('alerts:save-webhook', url),
  clearAlertWebhook: () => invoke('alerts:clear-webhook'),
  sendTestAlert: (mentionUserId) => invoke('alerts:send-test', mentionUserId),
  checkAlertsNow: () => invoke('alerts:check-now'),
  sendAlertSummary: () => invoke('alerts:send-summary'),
  getRetainerSummary: () => invoke('get-retainer-summary'),
  getUniversalisSetting: () => invoke('get-universalis-setting'),
  saveUniversalisSetting: (enabled) => invoke('save-universalis-setting', enabled),
  getPlayStyle: () => invoke('get-play-style'),
  savePlayStyle: (choice) => invoke('save-play-style', choice),
  getPcs: () => invoke('get-pcs'),
  removePc: (pcName, accountLabel) => invoke('remove-pc', pcName, accountLabel),
  getLoot: () => invoke('get-loot'),
  getMarket: () => invoke('get-market'),
  saveMarketSettings: (settings) => invoke('save-market-settings', settings),
  saveShoppingProgress: (input) => invoke('save-shopping-progress', input),
  saveCsv: (input) => invoke('save-csv', input),
  installAlertSchedule: () => invoke('alerts:install-schedule'),
  removeAlertSchedule: () => invoke('alerts:remove-schedule'),
  getSetupDetails: () => invoke('setup:get-details'),
  getProblemInfo: () => invoke('help:problem-info'),
  openLogFolder: () => invoke('help:open-log-folder'),
  reportProblem: () => invoke('help:report-problem'),
  testSetupAddress: (address) => invoke('setup:test-address', address),
  checkFromHere: (address) => invoke('setup:check-from-here', address),
  letOtherPcsConnect: () => invoke('setup:let-other-pcs-connect'),
  createDatabase: (input) => invoke('setup:create-database', input),
  getWizardInfo: () => invoke('setup:wizard-info'),
  getSetupPlan: (choice) => invoke('setup:plan', choice),
  suggestPassword: () => invoke('setup:suggest-password'),
  runSetup: (input) => invoke('setup:run', input),
  onSetupProgress: (callback) => {
    const listener = (event, steps) => callback(steps);
    ipcRenderer.on('setup:progress', listener);
    return () => ipcRenderer.removeListener('setup:progress', listener);
  },
  getTailscaleStatus: () => invoke('setup:tailscale-status'),
  signInToTailscale: (options) => invoke('setup:tailscale-sign-in', options),
  getRemovalPlan: () => invoke('setup:removal-plan'),
  removeEverything: (input) => invoke('setup:remove-everything', input),
  onRemoveProgress: (callback) => {
    const listener = (event, steps) => callback(steps);
    ipcRenderer.on('setup:remove-progress', listener);
    return () => ipcRenderer.removeListener('setup:remove-progress', listener);
  },
  getMoveInfo: () => invoke('move:info'),
  moveDatabase: (input) => invoke('move:run', input),
  onMoveProgress: (callback) => {
    const listener = (event, steps) => callback(steps);
    ipcRenderer.on('move:progress', listener);
    return () => ipcRenderer.removeListener('move:progress', listener);
  },
  getLeftoversInfo: () => invoke('leftovers:info'),
  findLeftovers: (input) => invoke('leftovers:find', input),
  removeLeftover: (input) => invoke('leftovers:remove', input),
  removeLeftoverPostgres: (input) => invoke('leftovers:remove-postgres', input),
  finishRemoval: () => invoke('setup:finish-removal')
});
