// A value that has no recorded history shows "No history yet" on its Summary tile, while the
// other tiles keep working. (The database is changed before the app starts and put back after.)
module.exports = async (t) => {
  const { ev, waitFor, shot, check } = t;
  const tiles = `[...document.querySelectorAll('.account-group')].filter(x=>[...x.querySelectorAll('button')].some(b=>b.innerText.trim()==='View trend'))`;
  await waitFor(`${tiles}.length===5 && ${tiles}.every(x=>!x.querySelector('button').disabled)`, 'the five tiles');
  const repair = await ev(`${tiles}.find(x=>x.children[0].innerText==='Repair kits').innerText`);
  check(/No history yet/.test(repair), 'a value with no history shows "No history yet": ' + JSON.stringify(repair.split('\n').slice(0, 3)));
  const gil = await ev(`${tiles}.find(x=>x.children[0].innerText==='Gil').innerText`);
  check(!/No history yet/.test(gil) && /\d/.test(gil), 'the other tiles still show their values');
  await shot('tile-without-history');
};

module.exports.before = (db) => db.query("update companion_metric_latest set metric='zz_repair_kits' where metric='repair_kits'");
module.exports.after = (db) => db.query("update companion_metric_latest set metric='repair_kits' where metric='zz_repair_kits'");
