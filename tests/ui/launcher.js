// Test-only launcher, run by Electron: points the app at a scratch database and a throwaway
// profile folder, then runs the app's real main.js unchanged.
//   electron tests/ui/launcher.js --remote-debugging-port=9333
// Reads PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE, UI_TEST_PROFILE (profile folder) and
// XIV_FLEET_TEST_SEEN_VERSION (What's new).
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

app.setPath('userData', process.env.UI_TEST_PROFILE);
// What's new (ipc/updates.js) is marked seen, so its box doesn't appear in every test; XIV_FLEET_TEST_SEEN_VERSION
// sets the version last seen instead (the What's new test).
fs.mkdirSync(process.env.UI_TEST_PROFILE, { recursive: true });
fs.writeFileSync(path.join(process.env.UI_TEST_PROFILE, 'whats-new.json'),
  JSON.stringify({ seen: process.env.XIV_FLEET_TEST_SEEN_VERSION || require('../../package.json').version }));
// No internet for the game data download: a new database stays without it (filling it is tested in
// tests/db/verify-game-data.js).
if (process.env.XIV_FLEET_SKIP_GAME_DATA_FILL === undefined) process.env.XIV_FLEET_SKIP_GAME_DATA_FILL = '1';
// No internet either for the daily look for new game data: GitHub's answer is stood in for (nothing new, unless a
// scenario says otherwise).
if (process.env.XIV_FLEET_TEST_GAME_DATA_CHANGES === undefined) process.env.XIV_FLEET_TEST_GAME_DATA_CHANGES = '{}';
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
