// Ceruleum from FC credits (Supplies tab): how many ceruleum tanks each Free Company's company credits
// can buy (from the OIC Quartermaster at a Grand Company), and how many days of the fleet's ceruleum use
// those tanks cover, per Free Company, per account and for the whole fleet. No Electron or pg here, so it
// can be tested on its own (tests/fc-credits.test.js).

const DEFAULT_TANK_COST = 100;
const MAX_TANK_COST = 100000;

// How long `tanks` last at `perDay`: a number of days, Infinity when nothing is used, null when the use
// is not known yet.
function daysCovered(tanks, perDay) {
  if (perDay === null || perDay === undefined) return null;
  if (perDay <= 0) return Infinity;
  return tanks / perDay;
}

// fcs:        [{ fc_id, fc_name, fc_world, account_label, fc_points }] (the Free Companies tab's rows)
// characters: [{ fc_id, account_label, perDay (ceruleum used per day, or null), have }] (Supplies rows)
// chests:     Map fc_id -> ceruleum tanks in the FC chest
// tankCost:   company credits per tank
function creditPlan({ fcs, characters, chests = new Map(), tankCost = DEFAULT_TANK_COST }) {
  const cost = Number(tankCost) > 0 ? Number(tankCost) : DEFAULT_TANK_COST;
  const label = (value) => value || 'Ungrouped';
  // Use per day added up, or null when none of them is known (a single unknown one is left out).
  const addUse = (rows) => {
    const known = rows.filter((r) => typeof r.perDay === 'number');
    return known.length ? known.reduce((total, r) => total + r.perDay, 0) : null;
  };

  const fcRows = fcs.map((fc) => {
    const credits = Math.max(0, Number(fc.fc_points) || 0);
    const tanks = Math.floor(credits / cost);
    const members = characters.filter((c) => c.fc_id != null && String(c.fc_id) === String(fc.fc_id));
    const perDay = addUse(members);
    return {
      fc_id: String(fc.fc_id),
      fc_name: fc.fc_name,
      fc_world: fc.fc_world,
      account_label: label(fc.account_label),
      credits,
      tanks,
      chest: Number(chests.get(String(fc.fc_id))) || 0,
      perDay,
      days: daysCovered(tanks, perDay),
    };
  });

  const summarise = (fcList, people) => {
    const tanks = fcList.reduce((total, f) => total + f.tanks, 0);
    const perDay = addUse(people);
    return {
      fcCount: fcList.length,
      credits: fcList.reduce((total, f) => total + f.credits, 0),
      tanks,
      chest: fcList.reduce((total, f) => total + f.chest, 0),
      held: people.reduce((total, c) => total + (Number(c.have) || 0), 0),
      perDay,
      days: daysCovered(tanks, perDay),
    };
  };

  const labels = [...new Set([...fcRows.map((f) => f.account_label), ...characters.map((c) => label(c.account_label))])]
    .sort((a, b) => a.localeCompare(b));
  const accounts = labels.map((l) => ({
    label: l,
    ...summarise(fcRows.filter((f) => f.account_label === l), characters.filter((c) => label(c.account_label) === l)),
  })).filter((a) => a.fcCount > 0);

  return { tankCost: cost, fcs: fcRows, accounts, fleet: summarise(fcRows, characters) };
}

module.exports = { DEFAULT_TANK_COST, MAX_TANK_COST, daysCovered, creditPlan };
