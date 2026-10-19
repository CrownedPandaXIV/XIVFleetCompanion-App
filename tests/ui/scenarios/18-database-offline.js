// Losing the database while the app is open (for example the internet or Tailscale dropping): the app
// gives up within seconds, keeps showing what it last loaded with a banner saying so, and reloads on
// its own once the database answers again. The app talks to the database through a relay this
// scenario controls; "down" makes the relay accept connections and never answer, like a network
// that silently drops everything (the ETIMEDOUT case).
const net = require('net');

let relay = null;
let down = false;
const open = new Set();

function databaseAddress() {
  const host = process.env.PGHOST || '127.0.0.1';
  const port = Number(process.env.PGPORT || 5432);
  return host.startsWith('/') ? { path: `${host}/.s.PGSQL.${port}` } : { host, port };
}

function track(socket) {
  open.add(socket);
  socket.on('close', () => open.delete(socket));
  socket.on('error', () => socket.destroy());
}

function cutEverything() {
  for (const socket of open) socket.destroy();
}

module.exports = async (t) => {
  const { ev, sleep, waitFor, check, nav, clickText } = t;
  const banner = `document.querySelector('.connection-banner')`;
  const rosterRows = `document.querySelectorAll('tbody tr[data-cid]').length`;

  await nav('Character Roster');
  await waitFor(`${rosterRows} > 0`, 'roster rows', 30000);
  const rowsBefore = await ev(rosterRows);
  check(await ev(`!!document.querySelector('.connection-dot') && !document.querySelector('.connection-dot.offline')`), 'the header shows the database as connected');
  check(await ev(`!${banner}`), 'no offline banner while connected');

  // The network goes away. Every call opens its own connection, so once the app is idle, new
  // connections are the ones that hang: the app must give up on its own (connect timeout).
  await sleep(2000);
  down = true;
  const started = Date.now();
  await clickText('button', 'Refresh');
  await waitFor(`!!${banner}`, 'the offline banner', 25000);
  const gaveUpAfter = Date.now() - started;
  check(gaveUpAfter >= 6000 && gaveUpAfter < 13000,
    `a connection that never answers is given up after about 8 seconds (${(gaveUpAfter / 1000).toFixed(1)} s), not the operating system's ~20 s or more`);
  await t.shot('offline-banner');
  const text = await ev(`${banner}.innerText`);
  check(/Can't reach the database at 127\.0\.0\.1:\d+\. Check this PC is online and any VPN \(such as Tailscale\) is connected\./.test(text), 'the banner explains the problem in plain words: ' + text);
  check(/Showing what was loaded at/.test(text) && /Trying again every 2 seconds/.test(text), 'the banner says the data shown is from before, and that it keeps trying');
  check(await ev(`!!document.querySelector('.connection-dot.offline')`), 'the header dot shows the database as offline');
  check(await ev(`${rosterRows}`) === rowsBefore && await ev(`!document.querySelector('.error')`),
    `the Roster keeps its ${rowsBefore} rows instead of an error`);

  await nav('Summary');
  await sleep(1500);
  check(await ev(`!document.querySelector('.error')`), 'the Summary, loaded earlier, still shows its data, not an error');
  check(!/ETIMEDOUT|ECONNREFUSED/.test(await ev(`document.body.innerText`)), 'no raw network error codes on screen');

  // The network comes back: the app notices on its own, drops the banner and reloads.
  down = false;
  await waitFor(`!${banner}`, 'the banner to go away by itself', 20000);
  check(true, 'the banner went away by itself once the database answered again');
  check(await ev(`!document.querySelector('.connection-dot.offline')`), 'the header dot shows the database as connected again');
  await nav('Character Roster');
  await waitFor(`${rosterRows} > 0`, 'roster rows after reconnecting', 20000);
  check(await ev(rosterRows) === rowsBefore, 'the Roster loads again after reconnecting');
};

module.exports.setup = () => new Promise((resolve) => {
  relay = net.createServer((client) => {
    track(client);
    if (down) return; // accepted but never answered, like a network that drops everything
    const server = net.connect(databaseAddress());
    track(server);
    client.pipe(server);
    server.pipe(client);
    client.on('close', () => server.destroy());
    server.on('close', () => client.destroy());
  });
  relay.listen(0, '127.0.0.1', resolve);
});

// The app connects through the relay, and checks every 2 seconds (instead of 30) while offline.
module.exports.env = () => ({ PGHOST: '127.0.0.1', PGPORT: String(relay.address().port), FLEET_RECONNECT_MS: '2000' });

module.exports.teardown = () => new Promise((resolve) => {
  down = false;
  cutEverything();
  if (!relay) return resolve();
  relay.close(() => resolve());
});
