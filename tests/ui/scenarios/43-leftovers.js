// Settings → Database → Leftovers from moving the database: with the master password it lists the copy a move kept
// here (never the database the app uses), and removes it after asking.
const KEPT = `${process.env.PGDATABASE || 'postgres'}_before_move_20261018_2302`;

module.exports = async (t) => {
  const { ev, waitFor, check, sleep } = t;
  await ev(`document.querySelector('.gear-button').click()`);
  await waitFor(`!!document.querySelector('.settings-tab')`, 'Settings');
  await ev(`[...document.querySelectorAll('.settings-tab')].find((b) => b.innerText === 'Database').click()`);
  const box = `document.querySelector('.leftovers')`;
  await waitFor(`!!${box}`, 'the Leftovers section', 15000);
  check(!(await ev(`!!${box}.querySelector('.leftovers-list')`)), 'nothing is looked for until asked');

  const type = async (selector, value) => ev(`(() => {
    const el = ${box}.querySelector('${selector}');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await type('.leftovers-password', process.env.PGPASSWORD || 'unused');
  // Nothing answers on port 1: said plainly, not as a network problem.
  await type('.leftovers-port', '1');
  await ev(`${box}.querySelector('.leftovers-look').click()`);
  await waitFor(`/isn't running on this PC/.test((${box}.querySelector('.leftovers-status') || {}).innerText || '')`, 'the not-running message', 30000);
  check(true, 'no PostgreSQL answering: "PostgreSQL isn\'t running on this PC, or it has been removed"');
  await type('.leftovers-port', String(process.env.PGPORT || 5432));
  await ev(`${box}.querySelector('.leftovers-look').click()`);
  await waitFor(`!!${box}.querySelector('.leftovers-list, .leftovers-none') || (${box}.querySelector('.leftovers-status') && !/Looking/.test(${box}.querySelector('.leftovers-status').innerText))`, 'the leftovers', 30000);
  const problem = await ev(`${box}.querySelector('.leftovers-status') ? ${box}.querySelector('.leftovers-status').innerText : ''`);
  check(!problem, `no problem looking: ${problem}`);
  const items = await ev(`[...${box}.querySelectorAll('.leftovers-list li')].map((li) => li.innerText)`);
  check(items.some((i) => i.includes(KEPT) && /the copy that was here when the database moved here/.test(i)), `the kept copy is listed: ${JSON.stringify(items)}`);
  check(!items.some((i) => i.startsWith(`${process.env.PGDATABASE} `) || i.startsWith(`${process.env.PGDATABASE}(`)), 'the database the app uses is not');

  await ev(`[...${box}.querySelectorAll('.leftovers-list li')].find((li) => li.innerText.includes('${KEPT}')).querySelector('.remove-labelled').click()`);
  await waitFor(`!!document.querySelector('.remove-confirm')`, 'the confirmation');
  await ev(`[...document.querySelectorAll('.remove-confirm button')].find((b) => b.innerText === 'Yes, remove').click()`);
  await waitFor(`/Removed/.test((${box}.querySelector('.leftovers-status') || {}).innerText || '')`, 'removed', 30000);
  await sleep(500);
  const still = await t.query(`SELECT 1 FROM pg_database WHERE datname = '${KEPT}'`);
  check(still.length === 0, 'the kept copy is gone from PostgreSQL');
  const live = await t.query(`SELECT 1 FROM pg_database WHERE datname = current_database()`);
  check(live.length === 1, 'the database the app uses is still there');
};

module.exports.env = () => ({ XIV_FLEET_TEST_LOCAL_POSTGRES: '1' });

module.exports.before = async (db) => {
  await db.query(`DROP DATABASE IF EXISTS ${KEPT}`);
  await db.query(`CREATE DATABASE ${KEPT}`);
};

module.exports.after = async (db) => {
  await db.query(`DROP DATABASE IF EXISTS ${KEPT}`);
};
