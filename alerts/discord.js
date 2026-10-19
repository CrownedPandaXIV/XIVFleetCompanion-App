// Posting to Discord through a channel webhook, and keeping that webhook's address on this PC only.
// The address is a secret (anyone with it can post in the channel), so it is stored encrypted with
// Windows' own protection for this Windows account (Electron safeStorage, as the database login is),
// never in the shared database.
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const WEBHOOK_FILE = () => path.join(app.getPath('userData'), 'discord-webhook.enc');
const WEBHOOK_URL = /^https:\/\/(?:ptb\.|canary\.)?(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/;
// The UI test posts to a stand-in for Discord on this machine.
const LOCAL_TEST_URL = /^http:\/\/127\.0\.0\.1:\d+\/[\w/-]+$/;

function checkWebhookUrl(url) {
  const trimmed = String(url || '').trim();
  if (WEBHOOK_URL.test(trimmed)) return { ok: true, url: trimmed };
  if (process.env.FLEET_ALERTS_ALLOW_LOCAL_WEBHOOK === '1' && LOCAL_TEST_URL.test(trimmed)) return { ok: true, url: trimmed };
  return { ok: false, error: 'That does not look like a Discord webhook address. In Discord: Edit Channel → Integrations → Webhooks → New Webhook → Copy Webhook URL. It starts with https://discord.com/api/webhooks/' };
}

function loadWebhook() {
  try {
    if (!fs.existsSync(WEBHOOK_FILE())) return null;
    return safeStorage.decryptString(fs.readFileSync(WEBHOOK_FILE()));
  } catch {
    return null;
  }
}

function saveWebhook(url) {
  const checked = checkWebhookUrl(url);
  if (!checked.ok) return checked;
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(WEBHOOK_FILE(), safeStorage.encryptString(checked.url));
  return { ok: true };
}

function clearWebhook() {
  try { fs.unlinkSync(WEBHOOK_FILE()); } catch { /* already gone */ }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Posts one message. Only the given user can be @mentioned (no @everyone, no roles). Throws an Error
// with a plain message when Discord refuses it.
async function postMessage(url, content, mentionUserId) {
  const body = JSON.stringify({
    username: 'Fleet Companion',
    content,
    allowed_mentions: { parse: [], users: mentionUserId ? [mentionUserId] : [] },
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    let res;
    try {
      res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(15000) });
    } catch (err) {
      throw new Error(`Could not reach Discord (${err.cause && err.cause.code ? err.cause.code : err.message}). Is this PC online?`);
    }
    if (res.ok) return;
    if (res.status === 429 && attempt === 0) {
      // Rate limited: Discord says how long to wait. Wait once if it is short; otherwise the next check retries.
      const info = await res.json().catch(() => ({}));
      const waitMs = Math.ceil(Number(info.retry_after || 1) * 1000);
      if (waitMs <= 10000) { await sleep(waitMs); continue; }
    }
    if (res.status === 401 || res.status === 404) {
      throw new Error('Discord says this webhook no longer exists (was it deleted?). Paste a new one in Settings → Discord alerts.');
    }
    throw new Error(`Discord refused the message (HTTP ${res.status}).`);
  }
  throw new Error('Discord is limiting how often messages can be posted; the next check will try again.');
}

module.exports = { checkWebhookUrl, loadWebhook, saveWebhook, clearWebhook, postMessage };
