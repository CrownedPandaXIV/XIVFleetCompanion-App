// The Sub Calculator's longer working out, away from the app's main process (ipc/calculator.js runIn): the Levelling
// Plan's plans, the Route Finder's and Compare Builds' route searches, and the Build Finder's search. It stays up for the next job of its kind; the
// app stops it when a newer job of that kind is asked for before this one is done.
const { parentPort } = require('worker_threads');
const levelling = require('./levelling');
const routeFinder = require('./route-finder');
const { searchBuilds } = require('./build-search');

// routes: the Route Finder's; compare: Compare Builds' (its own kind, so the two pages don't stop each other's).
const work = { levelling: (job) => levelling.plansFor(job), routes: (job) => routeFinder.findRoutes(job), compare: (job) => routeFinder.findRoutes(job),
  builds: (job) => searchBuilds(job) };

parentPort.on('message', ({ kind, job }) => {
  try {
    parentPort.postMessage({ result: work[kind](job) });
  } catch (err) {
    parentPort.postMessage({ error: err && err.message ? err.message : String(err) });
  }
});
