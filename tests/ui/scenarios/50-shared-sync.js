// A character synced by two setups of the plugin: its account label keeps going back and forth (the database logs
// each change), so the Summary and the PCs tab say so and how to fix it. Bex Kitteh 1 switches between Account 2 and
// Account R; Cal Kitteh 2 was relabelled once, which is not this.
const BEX = '18014498578000001';
const BEX2 = '18014498578000002';

module.exports = async (t) => {
  const { ev, waitFor, check, nav, shot } = t;
  const text = () => ev(`(document.querySelector('.shared-sync') || {}).innerText || ''`);

  await nav('Summary');
  await waitFor(`!!document.querySelector('.shared-sync')`, 'the warning on the Summary', 20000);
  const summary = await text();
  check(/^Bex Kitteh 1 \(\w+\): Account 2 and Account R\./.test(summary), 'names the character and both labels: ' + summary.split('\n')[0]);
  check(/Advanced → Character Synchronization/.test(summary) && /Prune deleted characters/.test(summary) && /JustBackup/.test(summary),
    "points to AutoRetainer's Character Synchronization first");
  check(/Only sync the characters I tick/.test(summary), 'and the plugin setting as the other way');
  check(/plugin 1\.0\.2 or newer on every setup, this stops by itself once the character logs in on its setup/.test(summary.replace(/\s+/g, ' ')), 'says newer plugins stop it by themselves');
  check(!/Cal Kitteh 2/.test(summary), 'a label changed once is not counted');
  await shot('shared-sync-summary');

  await nav('PCs');
  await waitFor(`!!document.querySelector('.pcs .shared-sync')`, 'the warning on the PCs tab', 20000);
  check(/^Bex Kitteh 1 /.test(await text()), 'the same on the PCs tab');
  await shot('shared-sync-pcs');
};

module.exports.before = async (db) => {
  await db.query(`DELETE FROM companion_character_changes WHERE field = 'account_label'`);
  await db.query(`INSERT INTO companion_character_changes (changed_at, cid, field, old_value, new_value) VALUES
    (now() - interval '30 hours', ${BEX}, 'account_label', 'Account 2', 'Account R'),
    (now() - interval '20 hours', ${BEX}, 'account_label', 'Account R', 'Account 2'),
    (now() - interval '2 hours', ${BEX}, 'account_label', 'Account 2', 'Account R'),
    (now() - interval '10 hours', ${BEX2}, 'account_label', 'Main', 'Account 2')`);
};

module.exports.after = async (db) => {
  await db.query(`DELETE FROM companion_character_changes WHERE field = 'account_label'`);
};
