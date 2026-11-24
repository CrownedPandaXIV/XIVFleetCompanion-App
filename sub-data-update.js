// The Sub Calculator's newer data (subs/calculator-data.js): once a day, the app asks the Releases repository for the
// copy .github/workflows/sub-data.yml last published, and keeps it when it is fine and newer than the one in use. A day
// missed while the app was closed is made up for when it opens. Nothing changes when it can't be reached.
const fs = require('fs');
const path = require('path');
const calculatorData = require('./subs/calculator-data');

// The format number in the name: a later app that needs a different file asks for its own, and older apps keep theirs.
const URL = 'https://raw.githubusercontent.com/CrownedPandaXIV/XIVFleetCompanion-Releases/main/sub-data/calculator-data-v1.json';
const DAY = 24 * 60 * 60 * 1000;
const CHECK_EVERY = 60 * 60 * 1000;
const FIRST_CHECK_AFTER = 30 * 1000;

// Whether a check is due: none yet, or the last one a day or more ago (or in the future: the clock was changed).
function due(lastAt, now) {
  return !(lastAt > 0) || now - lastAt >= DAY || lastAt > now;
}

function readState(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { return {}; }
}

// One check: { checkedAt, adopted, error }. get(url) -> the parsed file (fetch in the app; made up in the tests).
async function checkNow({ get, stateFile, now = Date.now() }) {
  const state = { checkedAt: now, adopted: false, error: null };
  try {
    state.adopted = calculatorData.adopt(await get(URL));
  } catch (err) {
    state.error = err && err.message ? err.message : String(err);
  }
  try { fs.writeFileSync(stateFile, JSON.stringify(state)); } catch { /* checked again on the next start */ }
  return state;
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'xiv-fleet-companion' }, signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Started once the window is up: the folder is the app's own (userData).
function startSubDataUpdates(folder, { get = fetchJson, log = console } = {}) {
  calculatorData.useFolder(folder);
  const stateFile = path.join(folder, 'sub-data-check.json');
  let running = false;
  const tick = async () => {
    if (running || !due(readState(stateFile).checkedAt, Date.now())) return;
    running = true;
    try {
      const done = await checkNow({ get, stateFile });
      if (done.adopted) log.log(`Sub Calculator data updated (made ${calculatorData.load().about.made}).`);
      else if (done.error) log.log(`Sub Calculator data: no newer copy fetched (${done.error}).`);
    } finally {
      running = false;
    }
  };
  setTimeout(tick, FIRST_CHECK_AFTER).unref();
  setInterval(tick, CHECK_EVERY).unref();
}

module.exports = { URL, DAY, due, checkNow, startSubDataUpdates };
