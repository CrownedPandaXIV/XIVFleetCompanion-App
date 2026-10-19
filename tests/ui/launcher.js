// Test-only launcher, run by Electron: points the app at a scratch database and a throwaway
// profile folder, then runs the app's real main.js unchanged.
//   electron tests/ui/launcher.js --remote-debugging-port=9333
// Reads PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE, and UI_TEST_PROFILE (profile folder).
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

app.setPath('userData', process.env.UI_TEST_PROFILE);
// No internet for the game data download: a new database stays without it (filling it is tested in
// tests/db/verify-game-data.js).
if (process.env.XIV_FLEET_SKIP_GAME_DATA_FILL === undefined) process.env.XIV_FLEET_SKIP_GAME_DATA_FILL = '1';
// Linux CI machines have no system keyring; use plain-text storage there (tests only).
if (process.platform === 'linux') safeStorage.setUsePlainTextEncryption(true);

app.whenReady().then(() => {
  const host = process.env.PGHOST || '127.0.0.1';
  const config = {
    host,
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || 'postgres',
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || '',
  };
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(path.join(app.getPath('userData'), 'pg-credentials.enc'), safeStorage.encryptString(JSON.stringify(config)));
});
require('../../main.js');
