// The master list of extra columns any table can offer, and the query that fetches them. Kept free of
// Electron so it can be tested directly against a database.
//
// A table shows rows about one kind of thing ("subject"): a character or a Free Company. Each subject has a
// list of extra columns. A table asks for values only for the extra columns someone has actually added, so
// the everyday tables stay as fast as before. Rows that belong to a character (submarines, retainers) can use
// the character's columns through their owner.
//
// To add a column: add an entry to CHARACTER_COLUMNS or FC_COLUMNS below. `select` is a SQL expression over
// the aliases listed at the top of each section; `needs` names the extra tables it reads.

const FC_CHEST_CERULEUM_ITEM_ID = '10155'; // Ceruleum Tank

const MAX_IDS = 2000;
const ID_PATTERN = /^[0-9]{1,25}$/;

// ---- Character subject. Aliases: s = latest snapshot row, h = housing, k = city name,
//      rg = retainers' gil, sb = subs built, cc = ceruleum in the character's FC chest.
const CHARACTER_COLUMNS = [
  { key: 'x_world', label: 'World', group: 'Character', type: 'text', select: 's.world' },
  { key: 'x_account', label: 'Account', group: 'Character', type: 'text', select: 's.account_label' },
  { key: 'x_gil', label: 'Gil', group: 'Character', type: 'number', select: 's.gil' },
  { key: 'x_ceruleum', label: 'Ceruleum', group: 'Character', type: 'number', select: 's.ceruleum' },
  { key: 'x_repair_kits', label: 'Repair Kits', group: 'Character', type: 'number', select: 's.repair_kits' },
  { key: 'x_retainers', label: 'Retainers', group: 'Character', type: 'number', select: 's.retainer_count' },
  { key: 'x_retainer_gil', label: 'Retainer Gil (total)', group: 'Character', type: 'number', select: 'rg.gil', needs: ['rg'] },
  { key: 'x_submarines', label: 'Submarines', group: 'Character', type: 'number', select: 's.submarine_count' },
  { key: 'x_subs_built', label: 'Subs Built', group: 'Character', type: 'number', select: 'sb.n', needs: ['sb'] },
  { key: 'x_sub_slots', label: 'Sub Slots', group: 'Character', type: 'number', select: 's.num_sub_slots' },
  { key: 'x_last_synced', label: 'Last Synced', group: 'Character', type: 'date', select: 's.snapshot_at' },
  { key: 'x_house', label: 'House', group: 'Character', type: 'text', needs: ['h', 'k'],
    select: "CASE WHEN h.has_house THEN coalesce(k.city_name, 'City ' || h.house_city) || ' W' || h.house_ward || ' P' || h.house_plot END" },
  { key: 'x_fc_name', label: 'Free Company', group: 'Free Company', type: 'text', select: 'h.fc_name', needs: ['h'] },
  { key: 'x_fc_leader', label: 'FC Leader', group: 'Free Company', type: 'text', select: 'h.fc_master', needs: ['h'] },
  { key: 'x_fc_points', label: 'FC Points', group: 'Free Company', type: 'number', select: 'h.fc_points', needs: ['h'] },
  { key: 'x_fc_rank', label: 'FC Rank', group: 'Free Company', type: 'number', select: 'h.fc_rank', needs: ['h'] },
  { key: 'x_fc_members', label: 'FC Members', group: 'Free Company', type: 'number', select: 'h.total_members', needs: ['h'] },
  { key: 'x_fc_chest_ceruleum', label: 'Ceruleum in FC Chest', group: 'Free Company', type: 'number', select: 'cc.n', needs: ['cc'] },
];

// ---- Free Company subject. Aliases: f = latest housing row, m = tracked members' totals (characters whose
//      current Free Company this is), mr = those members' retainer gil, cc = ceruleum in the FC chest.
const FC_COLUMNS = [
  { key: 'x_fc_rank', label: 'Rank', group: 'Free Company', type: 'number', select: 'f.fc_rank', needs: ['f'] },
  { key: 'x_fc_founded', label: 'Founded', group: 'Free Company', type: 'date', select: 'f.fc_founding_date', needs: ['f'] },
  { key: 'x_account', label: 'Account', group: 'Free Company', type: 'text', select: 'm.account', needs: ['m'] },
  { key: 'x_members_tracked', label: 'Tracked Members', group: "Members' totals", type: 'number', select: 'm.n', needs: ['m'] },
  { key: 'x_members_gil', label: 'Gil (members total)', group: "Members' totals", type: 'number', select: 'm.gil', needs: ['m'] },
  { key: 'x_members_ceruleum', label: 'Ceruleum (members total)', group: "Members' totals", type: 'number', select: 'm.ceruleum', needs: ['m'] },
  { key: 'x_members_repair_kits', label: 'Repair Kits (members total)', group: "Members' totals", type: 'number', select: 'm.repair_kits', needs: ['m'] },
  { key: 'x_members_retainers', label: 'Retainers (members total)', group: "Members' totals", type: 'number', select: 'm.retainers', needs: ['m'] },
  { key: 'x_members_retainer_gil', label: 'Retainer Gil (members total)', group: "Members' totals", type: 'number', select: 'mr.gil', needs: ['mr'] },
  { key: 'x_members_submarines', label: 'Submarines (members total)', group: "Members' totals", type: 'number', select: 'm.subs', needs: ['m'] },
  { key: 'x_chest_ceruleum', label: 'Ceruleum (in FC chest)', group: 'FC chest', type: 'number', select: 'cc.n', needs: ['cc'] },
];

const SUBJECTS = { character: CHARACTER_COLUMNS, fc: FC_COLUMNS };

// What the interface may offer: keys, labels, groups and types (never SQL).
function catalogForInterface() {
  const out = {};
  for (const [subject, list] of Object.entries(SUBJECTS)) {
    out[subject] = list.map(({ key, label, group, type }) => ({ key, label, group, type }));
  }
  return out;
}

// Checks a request { subject, ids, columns } and returns { ok: true, subject, ids, columns } or { ok: false, error }.
function validateExtrasRequest(request) {
  if (!request || typeof request !== 'object') return { ok: false, error: 'Invalid request.' };
  const list = SUBJECTS[request.subject];
  if (!list) return { ok: false, error: 'Invalid subject.' };
  if (!Array.isArray(request.ids) || request.ids.length > MAX_IDS) return { ok: false, error: `ids must list up to ${MAX_IDS} ids.` };
  const ids = [...new Set(request.ids.map(String))];
  if (!ids.every((id) => ID_PATTERN.test(id))) return { ok: false, error: 'Invalid id.' };
  if (!Array.isArray(request.columns) || request.columns.length < 1 || request.columns.length > 40) {
    return { ok: false, error: 'columns must list 1 to 40 columns.' };
  }
  const known = new Map(list.map((c) => [c.key, c]));
  const columns = [];
  for (const key of request.columns) {
    if (!known.has(key)) return { ok: false, error: `Unknown column: ${String(key).slice(0, 40)}` };
    if (!columns.includes(key)) columns.push(key);
  }
  return { ok: true, subject: request.subject, ids, columns: columns.map((k) => known.get(k)) };
}

const JOINS_CHARACTER = {
  h: 'LEFT JOIN companion_character_housing h ON h.cid = s.cid',
  k: 'LEFT JOIN housing_key_city_lookup k ON k.city_id = h.house_city',
  rg: 'LEFT JOIN LATERAL (SELECT sum(rl.gil)::bigint AS gil FROM companion_retainer_lookup rl WHERE rl.owner_cid = s.cid) rg ON true',
  sb: 'LEFT JOIN LATERAL (SELECT count(*)::int AS n FROM companion_submarine_snapshot sub WHERE sub.cid = s.cid AND sub.level > 0) sb ON true',
  cc: `LEFT JOIN LATERAL (SELECT sum(fc.quantity)::bigint AS n FROM companion_fc_inventory_snapshot fc
         WHERE fc.fc_id = s.fc_id AND fc.item_id::text = '${FC_CHEST_CERULEUM_ITEM_ID}' AND fc.sorted_container BETWEEN 20000 AND 20004) cc ON true`,
};

const JOINS_FC = {
  f: `LEFT JOIN (SELECT DISTINCT ON (fc_id) fc_id, fc_rank, fc_founding_date FROM companion_character_housing
         WHERE fc_id = ANY($1::numeric[]) ORDER BY fc_id, updated_at DESC) f ON f.fc_id = ids.id`,
  m: `LEFT JOIN LATERAL (SELECT count(*)::int AS n, sum(gil)::bigint AS gil, sum(ceruleum)::bigint AS ceruleum,
         sum(repair_kits)::bigint AS repair_kits, sum(retainer_count)::bigint AS retainers,
         sum(submarine_count)::bigint AS subs, (array_agg(DISTINCT account_label))[1] AS account
         FROM cur WHERE cur.fc_id = ids.id) m ON true`,
  mr: `LEFT JOIN LATERAL (SELECT sum(rl.gil)::bigint AS gil FROM companion_retainer_lookup rl
         WHERE rl.owner_cid IN (SELECT cid FROM cur WHERE cur.fc_id = ids.id)) mr ON true`,
  cc: `LEFT JOIN LATERAL (SELECT sum(fc.quantity)::bigint AS n FROM companion_fc_inventory_snapshot fc
         WHERE fc.fc_id = ids.id AND fc.item_id::text = '${FC_CHEST_CERULEUM_ITEM_ID}' AND fc.sorted_container BETWEEN 20000 AND 20004) cc ON true`,
};

// `checked` is the result of validateExtrasRequest; `latestCharacter` is the fragment from db/index.js that yields
// the latest snapshot row per character. Returns { sql, params }.
function buildExtrasQuery(checked, latestCharacter) {
  const isFc = checked.subject === 'fc';
  const joins = isFc ? JOINS_FC : JOINS_CHARACTER;
  const needed = new Set();
  for (const column of checked.columns) for (const n of column.needs || []) needed.add(n);
  if (isFc && needed.has('mr')) needed.add('m');
  const joinSql = Object.keys(joins).filter((n) => needed.has(n)).map((n) => joins[n]).join('\n  ');
  const selects = checked.columns.map((c) => `${c.select} AS "${c.key}"`).join(', ');
  const cte = isFc
    ? `WITH cur AS MATERIALIZED (SELECT cid, fc_id, gil, ceruleum, repair_kits, retainer_count, submarine_count, account_label
         FROM ${latestCharacter} c WHERE c.fc_id IS NOT NULL AND c.fc_id = ANY($1::numeric[]))`
    : '';
  const from = isFc
    ? 'FROM unnest($1::numeric[]) AS ids(id)'
    : `FROM unnest($1::numeric[]) AS ids(id)\n  JOIN ${latestCharacter} s ON s.cid = ids.id`;
  const idExpr = 'ids.id::text';
  const cteNeeded = isFc && (needed.has('m') || needed.has('mr'));
  const sql = `${cteNeeded ? cte : ''}
  SELECT ${idExpr} AS id, ${selects}
  ${from}
  ${joinSql}`;
  return { sql, params: [checked.ids] };
}

// Turns database values into plain numbers, dates and text according to the column types.
function shapeExtrasResult(rows, checked) {
  const values = {};
  for (const row of rows) {
    const entry = {};
    for (const column of checked.columns) {
      const raw = row[column.key];
      if (raw === null || raw === undefined) entry[column.key] = null;
      else if (column.type === 'number') entry[column.key] = Number(raw);
      else if (column.type === 'date') entry[column.key] = new Date(raw).toISOString();
      else entry[column.key] = String(raw);
    }
    values[row.id] = entry;
  }
  return { success: true, values };
}

module.exports = {
  FC_CHEST_CERULEUM_ITEM_ID,
  MAX_IDS,
  catalogForInterface,
  validateExtrasRequest,
  buildExtrasQuery,
  shapeExtrasResult,
};
