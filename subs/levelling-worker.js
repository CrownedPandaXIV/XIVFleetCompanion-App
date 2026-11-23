// The Levelling Plan's working out, away from the app's main process (ipc/calculator.js runLevelling): one job in, its
// plans out. The app stops this worker when a newer plan is asked for.
const { parentPort } = require('worker_threads');
const levelling = require('./levelling');

parentPort.once('message', (job) => {
  try {
    parentPort.postMessage({ plans: levelling.plansFor(job) });
  } catch (err) {
    parentPort.postMessage({ error: err && err.message ? err.message : String(err) });
  }
});
