// Checks the database's venture reward totals against working them out from every single reward, on a real
// Postgres: VENTURE_TOTALS (per character, item and quality, for live prices) against subs/loot.js
// ventureTotals, and ventureValues (each character's rewards, retainers, vendor value and top 3 items) against
// ventureSummary and topItems with the prices itemPrices gives. Set PGHOST, PGPORT, PGUSER, PGPASSWORD,
// PGDATABASE for a scratch server, as its administrator: it makes and drops a database named venture_totals_check.
const fs = require('fs');
const path = require('path');
const Module = require('module');
const { Client } = require('pg');
const assert = require('node:assert');
const { ventureTotals, ventureSummary } = require('../../subs/loot');

// ipc/details.js registers its calls with Electron when loaded; only its query is needed here.
const original = Module._load;
Module._load = function load(request, ...rest) {
  if (request === 'electron') return { ipcMain: { handle() {} }, app: { getPath: () => '.', getVersion: () => '0' }, safeStorage: {}, BrowserWindow: { getAllWindows: () => [] } };
  return original.call(this, request, ...rest);
};
const { VENTURE_TOTALS, ventureValues, topItems } = require('../../ipc/details');
const { SALVAGE_PRICES } = require('../../ipc/inventory');
Module._load = original;

let n = 0;
async function scenario(name, fn) {
  try { await fn(); console.log(`PASS ${++n}. ${name}`); } catch (e) { console.log(`FAIL ${++n}. ${name}\n   ${e.stack}`); process.exitCode = 1; }
}

const NAME = 'venture_totals_check';
(async () => {
  const admin = new Client();
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${NAME}`);
  await admin.query(`CREATE DATABASE ${NAME}`);
  const client = new Client({ host: process.env.PGHOST, port: process.env.PGPORT, user: process.env.PGUSER, password: process.env.PGPASSWORD, database: NAME });
  await client.connect();
  try {
    await client.query(fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'schema.sql'), 'utf8'));
    // 20,000 rewards over 20 days: 30 characters, 10 retainers each, 40 items, some HQ.
    await client.query(`
      INSERT INTO companion_venture_result (owner_cid, retainer_name, received_at, item_id, hq, quantity)
      SELECT 18014498000000000 + (g % 30), 'Retainer ' || ((g / 30) % 10), now() - (g || ' minutes')::interval * 1.4,
             5000 + (g * 7) % 40, g % 5 = 0, 1 + (g * 13) % 140
      FROM generate_series(1, 20000) g`);
    // Vendor prices as the game data has them (text), including blanks, one that isn't a number and items
    // missing from the table; two salvage items, priced from SALVAGE_PRICES instead.
    await client.query('ALTER TABLE ffxiv_item ADD COLUMN "PriceLow" text');
    await client.query(`INSERT INTO ffxiv_item (id, "PriceLow")
      SELECT (5000 + k)::text, CASE WHEN k % 9 = 0 THEN '' WHEN k % 11 = 0 THEN 'n/a' ELSE (k * 37 % 500)::text END
      FROM generate_series(0, 34) k`);
    await client.query(`UPDATE companion_venture_result SET item_id = 22500 WHERE item_id = 5038`);
    await client.query(`UPDATE companion_venture_result SET item_id = 22503 WHERE item_id = 5039`);

    await scenario('the totals for the last 7 days match adding up every reward', async () => {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const rewards = (await client.query(`SELECT owner_cid::text AS owner_cid, retainer_name, item_id, quantity, hq
        FROM companion_venture_result WHERE received_at > $1`, [since])).rows;
      const fromDatabase = (await client.query(VENTURE_TOTALS, [since])).rows;
      const key = (r) => `${r.owner_cid}|${r.item_id}|${r.hq}`;
      const normal = (rows) => rows.map((r) => ({ key: key(r), quantity: Number(r.quantity), rewards: Number(r.rewards), retainers: [...r.retainers].sort() }))
        .sort((a, b) => a.key.localeCompare(b.key));
      assert.deepStrictEqual(normal(fromDatabase), normal(ventureTotals(rewards)));
      console.log(`   ${rewards.length} rewards, ${fromDatabase.length} rows now`);
      assert.ok(fromDatabase.length < rewards.length / 5);
    });

    await scenario("each character's rewards, retainers, vendor value and top 3 items match working them out from every reward", async () => {
      const windowDays = 7;
      const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
      const rewards = (await client.query(`SELECT owner_cid::text AS owner_cid, retainer_name, item_id, quantity, hq
        FROM companion_venture_result WHERE received_at > $1`, [since])).rows;
      // The prices as itemPrices() reads them.
      const prices = new Map((await client.query('SELECT id, "PriceLow" AS price FROM ffxiv_item')).rows.map((r) => [Number(r.id), Number(r.price) || 0]));
      for (const [id, gil] of Object.entries(SALVAGE_PRICES)) prices.set(Number(id), gil);
      const expected = ventureSummary(ventureTotals(rewards), { prices, windowDays })
        .map((v) => ({ ownerCid: v.ownerCid, rewards: v.rewards, retainers: v.retainers, gil: v.gil, perDay: v.perDay, top: topItems(v.items, prices) }));
      const actual = await ventureValues(client, since, windowDays);
      const byOwner = (list) => [...list].sort((a, b) => a.ownerCid.localeCompare(b.ownerCid));
      assert.deepStrictEqual(byOwner(actual), byOwner(expected));
      assert.ok(expected.some((v) => v.top.some((t) => t.id === 22500)) && expected.every((v) => v.gil > 0), 'salvage and priced items are in it');
      console.log(`   ${rewards.length} rewards, ${actual.length} characters`);
    });
  } finally {
    await client.end();
    await admin.query(`DROP DATABASE IF EXISTS ${NAME}`);
    await admin.end();
  }
})();
