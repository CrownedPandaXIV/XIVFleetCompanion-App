// The fleet file (the plugin's "Just this PC": %APPDATA%\XIV Fleet Companion\fleet.db) opened so the app's own queries,
// written for PostgreSQL, run on it unchanged where they can. A client here answers query(sql, params) the way pg's does
// ({ rows, rowCount }), with the same kinds of values (see db/sqlite/result-types.js), so the pages need no second copy.
//
// What is translated on the way in (translate() below): $1 parameters, ::casts, = ANY($1) lists, now() and intervals
// (the file keeps times as Unix seconds), ILIKE, the ~ regular-expression match, substring(... FROM ...), the
// to_jsonb(row)->>'column' reads the app uses for columns old databases lacked, COLLATE "C", IS DISTINCT FROM and
// TRUNCATE. The few queries that need more than that (LATERAL, DISTINCT ON, unnest, array_agg) say so themselves
// with client.dialect === 'sqlite' and a version of their own.
//
// The game data (item names, sub parts, recipes...) isn't in the fleet file: the app keeps it in a file of its own,
// attached as "gd", so its tables are found by name like the fleet's own.
const fs = require('fs');
const path = require('path');
const { RESULT_TYPES } = require('./sqlite/result-types');

process.removeAllListeners('warning'); // node:sqlite's "experimental" notice, once
const { DatabaseSync } = require('node:sqlite');

// ---- Translation ----

const QUOTE = '\u0001';
const CAST_TYPES = {
  int: 'INTEGER', integer: 'INTEGER', int4: 'INTEGER', int8: 'INTEGER', bigint: 'INTEGER', smallint: 'INTEGER', int2: 'INTEGER',
  numeric: 'NUMERIC', float8: 'REAL', float4: 'REAL', real: 'REAL', 'double precision': 'REAL',
  text: 'TEXT', varchar: 'TEXT',
};
const INTERVAL_SECONDS = { second: 1, seconds: 1, sec: 1, secs: 1, minute: 60, minutes: 60, min: 60, mins: 60, hour: 3600, hours: 3600, day: 86400, days: 86400, week: 604800, weeks: 604800 };

// The text between `start` (an opening bracket) and its closing bracket.
function closing(sql, start) {
  let depth = 0;
  for (let i = start; i < sql.length; i++) {
    if (sql[i] === '(') depth++;
    else if (sql[i] === ')' && --depth === 0) return i;
  }
  throw new Error(`Unbalanced brackets in: ${sql}`);
}

// Where the expression ending just before `end` starts: a bracketed group (with its function name, if any), a quoted
// text, a parameter or a (dotted) name.
function operandStart(sql, end) {
  let i = end;
  if (sql[i - 1] === ')') {
    let depth = 0;
    for (i = end - 1; i >= 0; i--) {
      if (sql[i] === ')') depth++;
      else if (sql[i] === '(' && --depth === 0) break;
    }
    while (i > 0 && /[\w.]/.test(sql[i - 1])) i--;
    return i;
  }
  if (sql[i - 1] === QUOTE) {
    i = sql.lastIndexOf(QUOTE, i - 2);
    return i;
  }
  while (i > 0 && /[\w.?"]/.test(sql[i - 1])) i--;
  return i;
}

function rewriteCasts(sql) {
  let at;
  while ((at = sql.indexOf('::')) !== -1) {
    const m = /^::\s*(double precision|[a-z_0-9]+)(\s*\[\])?/i.exec(sql.slice(at));
    if (!m) throw new Error(`Unknown cast in: ${sql}`);
    const type = m[1].toLowerCase();
    const start = operandStart(sql, at);
    const operand = sql.slice(start, at);
    let replaced;
    if (m[2] || type === 'jsonb' || type === 'json' || type === 'boolean' || type === 'bool' || type === 'regclass') replaced = operand;
    else if (type === 'timestamptz' || type === 'timestamp') replaced = `pg_time(${operand})`;
    else if (type === 'date') replaced = `pg_date(${operand})`;
    else if (CAST_TYPES[type]) replaced = type === 'numeric' ? `pg_numeric(${operand})` : `CAST(${operand} AS ${CAST_TYPES[type]})`;
    else throw new Error(`Unknown cast ::${type} in: ${sql}`);
    sql = sql.slice(0, start) + replaced + sql.slice(at + m[0].length);
  }
  return sql;
}

// Splits at commas outside brackets.
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') depth--;
    else if (text[i] === ',' && depth === 0) { parts.push(text.slice(from, i)); from = i + 1; }
  }
  parts.push(text.slice(from));
  return parts.map((p) => p.trim());
}

// Where a keyword stands outside brackets in `text` (the last time when `last`), or -1.
function topLevel(text, keyword, { last = false } = {}) {
  const re = new RegExp(`\\b${keyword.replace(/ /g, '\\s+')}\\b`, 'gi');
  let found = -1;
  for (let m; (m = re.exec(text));) {
    let depth = 0;
    for (let i = 0; i < m.index; i++) { if (text[i] === '(') depth++; else if (text[i] === ')') depth--; }
    if (depth === 0) { found = m.index; if (!last) break; }
  }
  return found;
}

// The name a select-list item comes back under.
function outputName(item) {
  const as = /\bAS\s+("?)(\w+)\1\s*$/i.exec(item);
  if (as) return as[2];
  const bare = /(?:^|\.)(\w+)\s*$/.exec(item);
  if (bare && /^[\w.]+$/.test(item.trim())) return bare[1];
  throw new Error(`DISTINCT ON: give "${item}" a name`);
}

// SELECT DISTINCT ON (keys) columns FROM ... ORDER BY keys, ... (the first row of each group, in that order), with
// SQLite's numbered rows.
function rewriteDistinctOn(sql) {
  for (let m; (m = /SELECT\s+DISTINCT\s+ON\s*\(/i.exec(sql));) {
    const open = m.index + m[0].length - 1;
    const close = closing(sql, open);
    const keys = sql.slice(open + 1, close);
    let end = close + 1;
    for (let depth = 0; end < sql.length; end++) {
      if (sql[end] === '(') depth++;
      else if (sql[end] === ')' && --depth < 0) break;
    }
    const body = sql.slice(close + 1, end);
    const orderAt = topLevel(body, 'ORDER BY', { last: true });
    const fromAt = topLevel(body, 'FROM');
    if (orderAt < 0 || fromAt < 0) throw new Error(`DISTINCT ON without ORDER BY in: ${sql}`);
    const cols = body.slice(0, fromAt);
    const rest = body.slice(fromAt + 4, orderAt);
    const order = body.slice(orderAt).replace(/^ORDER\s+BY\s+/i, '').trim();
    const names = splitTopLevel(cols).map(outputName);
    const rewritten = `SELECT ${names.join(', ')} FROM (SELECT ${cols.trim()}, ROW_NUMBER() OVER (PARTITION BY ${keys} ORDER BY ${order}) AS pg_rn, `
      + `ROW_NUMBER() OVER (ORDER BY ${order}) AS pg_ord FROM ${rest.trim()}) WHERE pg_rn = 1 ORDER BY pg_ord`;
    sql = sql.slice(0, m.index) + rewritten + (end < sql.length ? ' ' : '') + sql.slice(end);
  }
  return sql;
}

// PostgreSQL sorts empty values (NULL) last going up and first going down; SQLite the other way round. Every ORDER
// BY term without its own NULLS FIRST / LAST is given PostgreSQL's.
function nullsAsPostgres(sql) {
  const re = /\bORDER\s+BY\b/gi;
  let out = '';
  let from = 0;
  for (let m; (m = re.exec(sql));) {
    const start = m.index + m[0].length;
    let end = start;
    for (let depth = 0; end < sql.length; end++) {
      const c = sql[end];
      if (c === '(') depth++;
      else if (c === ')') { if (--depth < 0) break; } else if (c === ';' && depth === 0) break;
      else if (depth === 0 && /\s/.test(c) && /^\s+(LIMIT|OFFSET|UNION|EXCEPT|INTERSECT|FETCH|ROWS|RANGE|GROUPS|WINDOW)\b/i.test(sql.slice(end))) break;
    }
    const terms = splitTopLevel(sql.slice(start, end)).map((t) => {
      if (!t || /\bNULLS\s+(FIRST|LAST)$/i.test(t)) return t;
      return /\bDESC$/i.test(t) ? `${t} NULLS FIRST` : `${t} NULLS LAST`;
    });
    out += `${sql.slice(from, start)} ${terms.join(', ')} `;
    from = end;
    re.lastIndex = end;
  }
  return out + sql.slice(from);
}

const cache = new Map();

// PostgreSQL's SQL as SQLite's. Quoted texts are set aside first, so nothing inside one is changed.
function translate(sql) {
  const known = cache.get(sql);
  if (known) return known;
  // Quoted texts set aside and comments left out, reading from the start (an apostrophe in a comment is not a quote).
  const texts = [];
  let out = '';
  for (let i = 0; i < sql.length;) {
    if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length && !(sql[j] === "'" && sql[j + 1] !== "'")) j += sql[j] === "'" ? 2 : 1;
      texts.push(sql.slice(i, j + 1));
      out += `${QUOTE}${texts.length - 1}${QUOTE}`;
      i = j + 1;
    } else if (sql.startsWith('--', i)) {
      while (i < sql.length && sql[i] !== '\n') i++;
    } else if (sql.startsWith('/*', i)) {
      const end = sql.indexOf('*/', i + 2);
      i = end < 0 ? sql.length : end + 2;
      out += ' ';
    } else {
      out += sql[i++];
    }
  }
  const text = (token) => texts[Number(token.slice(1, -1))].slice(1, -1).replace(/''/g, "'");
  const Q = `${QUOTE}\\d+${QUOTE}`;

  out = out.replace(/\$(\d+)/g, '?$1');
  // A list parameter: x = ANY($1) / x = ANY($1::int[]) -> x IN (the list's values)
  out = out.replace(/=\s*ANY\s*\(\s*\?(\d+)(?:\s*::\s*[\w ]+\[\])?\s*\)/gi, 'IN (SELECT value FROM json_each(?$1))');
  // unnest($1, $2) AS s(a, b): the lists side by side, as rows
  out = out.replace(/unnest\s*\(([^()]*)\)\s+AS\s+(\w+)\s*\(([^()]*)\)/gi, (whole, args, alias, cols) => {
    const lists = args.split(',').map((a) => /^\s*\?(\d+)(?:\s*::\s*([\w ]+)\[\])?\s*$/.exec(a));
    const names = cols.split(',').map((c) => c.trim());
    if (lists.some((l) => !l) || lists.length !== names.length) throw new Error(`unnest: only lists given as parameters, in: ${whole}`);
    const joins = lists.map((l, i) => (i === 0 ? `json_each(?${l[1]}) u0` : `LEFT JOIN json_each(?${l[1]}) u${i} ON u${i}.key = u0.key`)).join(' ');
    // (a list of times: as the file keeps them)
    const item = (l, i) => (/^timestamp/i.test(l[2] || '') ? `pg_time(u${i}.value)` : `u${i}.value`);
    return `(SELECT ${names.map((n, i) => `${item(lists[i], i)} AS ${n}`).join(', ')} FROM ${joins}) AS ${alias}`;
  });
  // A column read through the row's JSON (for databases that might not have it): the column itself.
  out = out.replace(new RegExp(`to_jsonb\\s*\\(\\s*(\\w+)\\s*\\)\\s*->>\\s*(${Q})`, 'gi'), (_, row, col) => `${row}.${text(col)}`);
  out = out.replace(/make_interval\s*\(\s*(days|hours|mins|secs)\s*=>\s*([^()]+?)\s*\)/gi,
    (_, unit, value) => `((${value}) * ${{ days: 86400, hours: 3600, mins: 60, secs: 1 }[unit.toLowerCase()]})`);
  out = out.replace(new RegExp(`interval\\s*(${Q})`, 'gi'), (whole, lit) => {
    const m = /^\s*(\d+(?:\.\d+)?)\s*([a-z]+)\s*$/i.exec(text(lit));
    if (!m || !INTERVAL_SECONDS[m[2].toLowerCase()]) throw new Error(`Unknown interval ${text(lit)}`);
    return String(Number(m[1]) * INTERVAL_SECONDS[m[2].toLowerCase()]);
  });
  out = out.replace(new RegExp(`substring\\s*\\(([^()]*?)\\s+FROM\\s+(${Q})\\s*\\)`, 'gi'), 'regexp_substr($1, $2)');
  // name ILIKE ALL($1): every pattern in the list matches (the patterns escape % and _ with \)
  out = out.replace(/([\w.]+)\s+ILIKE\s+ALL\s*\(\s*\?(\d+)(?:\s*::\s*text\s*\[\])?\s*\)/gi,
    (_, col, n) => `NOT EXISTS (SELECT 1 FROM json_each(?${n}) WHERE NOT (${col} LIKE value ESCAPE '\\'))`);
  out = out.replace(/\bILIKE\b/gi, 'LIKE');
  // array_agg(x ORDER BY ...): a JSON list (read back as a list, db/sqlite/result-types.js)
  out = out.replace(/\barray_agg\s*\(/gi, 'json_group_array(');
  out = out.replace(/\s!~\s/g, ' NOT REGEXP ').replace(/\s~\s/g, ' REGEXP ');
  out = out.replace(/COLLATE\s+"C"/gi, 'COLLATE BINARY');
  out = out.replace(/\bIS\s+NOT\s+DISTINCT\s+FROM\b/gi, 'IS').replace(/\bIS\s+DISTINCT\s+FROM\b/gi, 'IS NOT');
  // TRUNCATE: every row deleted (and numbering starts again by itself, as RESTART IDENTITY asks, once a table is empty)
  if (/^\s*TRUNCATE\b/i.test(out)) out = out.replace(/^\s*TRUNCATE\s+(?:TABLE\s+)?/i, 'DELETE FROM ').replace(/\s+RESTART\s+IDENTITY\b/i, '');
  // The column list (a view of SQLite's own, made when the file is opened)
  out = out.replace(/\binformation_schema\.columns\b/gi, 'temp.pg_columns');
  out = rewriteDistinctOn(out);
  // INSERT ... SELECT ... ON CONFLICT: SQLite needs a WHERE before ON CONFLICT to read it as the upsert
  {
    const conflict = /^\s*INSERT\b/i.test(out) ? topLevel(out, 'ON CONFLICT') : -1;
    if (conflict > 0) {
      const head = out.slice(0, conflict);
      const select = topLevel(head, 'SELECT', { last: true });
      if (select >= 0 && topLevel(head.slice(select), 'WHERE') < 0) out = `${head} WHERE true ${out.slice(conflict)}`;
    }
  }
  out = rewriteCasts(out);
  out = nullsAsPostgres(out);

  out = out.replace(new RegExp(Q, 'g'), (token) => texts[Number(token.slice(1, -1))]);
  cache.set(sql, out);
  return out;
}

// ---- Values ----

// A parameter as SQLite takes it: times as Unix seconds, yes/no as 1/0, lists as JSON (read with json_each).
function param(v) {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return v.getTime() / 1000;
  if (typeof v === 'boolean') return v ? 1 : 0;
  // (Dates are seen before JSON turns them into text: `this[k]` is the value itself)
  if (Array.isArray(v)) return JSON.stringify(v, function list(k, x) { const raw = this[k]; return typeof raw === 'bigint' ? raw.toString() : raw instanceof Date ? raw.getTime() / 1000 : x; });
  if (typeof v === 'object' && !(v instanceof Uint8Array)) return JSON.stringify(v);
  return v;
}

// pg's way of writing a numeric: no trailing ".0", whole numbers past JavaScript's safe range exact.
function numericText(v) {
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'number') return Number.isInteger(v) && Math.abs(v) < 1e21 ? BigInt(v).toString() : String(v);
  return String(v);
}

// One value as pg gives it for a column of this kind.
function value(v, kind) {
  if (v === null || v === undefined) return null;
  switch (kind) {
    // bigint and numeric too: pg gives them as text
    case 'text': return typeof v === 'string' ? v : v instanceof Uint8Array ? Buffer.from(v).toString() : numericText(v);
    // (game data is text in both, whatever the name)
    case 'number': return typeof v === 'string' ? v : Number(v);
    case 'bool': return typeof v === 'string' ? v === 'true' || v === '1' : Number(v) !== 0;
    // (to the millisecond, cut as pg cuts PostgreSQL's microseconds)
    case 'time': return new Date(Math.floor(Number(v) * 1000 + 1e-3));
    case 'json': return typeof v === 'string' ? JSON.parse(v) : v;
    // a JSON list (json_group_array), or the file's own lists: text, one per line (a setup's problems)
    case 'array': return typeof v !== 'string' ? v : v.startsWith('[') ? JSON.parse(v) : v === '' ? [] : v.split('\n');
    case 'bytes': return v instanceof Uint8Array ? Buffer.from(v) : v;
    default: break;
  }
  if (typeof v === 'bigint') return Number.isSafeInteger(Number(v)) ? Number(v) : v.toString();
  if (v instanceof Uint8Array) return Buffer.from(v);
  return v;
}

// ---- Functions PostgreSQL has and SQLite doesn't ----

function addFunctions(db, tableNames) {
  const fn = (name, impl, options = {}) => db.function(name, { deterministic: false, ...options }, impl);
  fn('now', () => Date.now() / 1000);
  fn('greatest', (...xs) => { const v = xs.filter((x) => x !== null); return v.length ? v.reduce((a, b) => (b > a ? b : a)) : null; }, { varargs: true });
  fn('least', (...xs) => { const v = xs.filter((x) => x !== null); return v.length ? v.reduce((a, b) => (b < a ? b : a)) : null; }, { varargs: true });
  const regexps = new Map();
  const regex = (pattern) => {
    let r = regexps.get(pattern);
    if (!r) { r = new RegExp(pattern); regexps.set(pattern, r); }
    return r;
  };
  // x REGEXP pattern calls regexp(pattern, x)
  fn('regexp', (pattern, x) => (x === null || pattern === null ? null : regex(pattern).test(String(x)) ? 1 : 0));
  // substring(x FROM pattern): the first bracketed part's match, else the whole match
  fn('regexp_substr', (x, pattern) => {
    if (x === null || pattern === null) return null;
    const m = regex(pattern).exec(String(x));
    return m ? (m.length > 1 ? m[1] ?? null : m[0]) : null;
  });
  // date_trunc('hour', time), on Unix seconds (in UTC, as the app's database sessions run)
  fn('date_trunc', (unit, t) => {
    if (t === null) return null;
    const step = { minute: 60, hour: 3600, day: 86400 }[String(unit).toLowerCase()];
    if (!step) throw new Error(`date_trunc: unknown unit ${unit}`);
    return Math.floor(Number(t) / step) * step;
  });
  // A time given as a time (Unix seconds) or as text (an ISO date): Unix seconds.
  fn('pg_time', (t) => {
    if (t === null || typeof t === 'number' || typeof t === 'bigint') return t === null ? null : Number(t);
    const ms = Date.parse(String(t));
    if (Number.isNaN(ms)) throw new Error(`Not a time: ${t}`);
    return ms / 1000;
  });
  fn('pg_date', (t) => (t === null ? null : Math.floor(Number(t) / 86400) * 86400));
  // ::numeric: a number, or NULL-safe text that is one (as PostgreSQL would refuse anything else)
  fn('pg_numeric', (x) => {
    if (x === null || typeof x === 'number' || typeof x === 'bigint') return x;
    const t = String(x).trim();
    if (!/^[+-]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i.test(t)) throw new Error(`invalid input syntax for type numeric: "${x}"`);
    return /^[+-]?\d+$/.test(t) && Number.isSafeInteger(Number(t)) ? Number(t) : /^[+-]?\d+$/.test(t) ? BigInt(t) : Number(t);
  });
  // to_regclass('name'): the name when the table or view is there
  fn('to_regclass', (name) => {
    if (name === null) return null;
    const bare = String(name).replace(/^public\./, '').replace(/"/g, '');
    return tableNames().has(bare) ? bare : null;
  });
}

// ---- The client ----

class SqliteClient {
  // file: the fleet file; gameData: the app's game data file (made if missing), or null.
  constructor(file, { gameData = null, readOnly = false, busyMs = 15000 } = {}) {
    this.dialect = 'sqlite';
    this.file = file;
    this.db = new DatabaseSync(file, { readOnly, timeout: busyMs });
    this.db.exec(`PRAGMA busy_timeout = ${busyMs}`);
    if (!readOnly) {
      // As the plugin opens it: readers and writers don't wait for each other.
      this.db.exec('PRAGMA journal_mode = WAL');
      this.db.exec('PRAGMA synchronous = NORMAL');
    }
    if (gameData) {
      fs.mkdirSync(path.dirname(path.resolve(gameData)), { recursive: true });
      this.db.prepare('ATTACH DATABASE ? AS gd').run(gameData);
    }
    let names = null;
    this.tableNames = () => {
      if (!names) {
        names = new Set();
        for (const schema of gameData ? ['main', 'gd'] : ['main']) {
          for (const r of this.db.prepare(`SELECT name FROM ${schema}.sqlite_master WHERE type IN ('table', 'view')`).all()) names.add(r.name);
        }
      }
      return names;
    };
    this.forgetTables = () => { names = null; };
    addFunctions(this.db, () => this.tableNames());
    this.db.function('current_schema', () => 'public');
    // PostgreSQL's information_schema.columns, for the queries that look up a table's columns.
    const schemas = gameData ? ['main', 'gd'] : ['main'];
    this.db.exec(`CREATE TEMP VIEW pg_columns AS
      SELECT 'public' AS table_schema, m.name AS table_name, p.name AS column_name, p.cid + 1 AS ordinal_position
      FROM (${schemas.map((sc) => `SELECT name, '${sc}' AS sc FROM ${sc}.sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite%'`).join(' UNION ALL ')}) m
      JOIN pragma_table_info p ON p.arg = m.name AND p.schema = m.sc`);
  }

  async connect() {}

  // pg's query(sql, params): { rows, rowCount, fields }. Several statements without parameters run one after another.
  async query(sql, params = []) {
    if (typeof sql === 'object' && sql) { params = sql.values || []; sql = sql.text; }
    // As PostgreSQL: ending a transaction that isn't open is no error.
    if (/^\s*(ROLLBACK|COMMIT)\s*;?\s*$/i.test(sql) && !this.db.isTransaction) return { rows: [], rowCount: 0, fields: [] };
    const lite = translate(sql);
    if (/^\s*(CREATE|DROP|ALTER)\b/i.test(lite)) this.forgetTables();
    if (!params.length && /;\s*\S/.test(lite.replace(/'(?:[^']|'')*'/g, ''))) { // (comments are gone by now)
      this.db.exec(lite);
      return { rows: [], rowCount: 0, fields: [] };
    }
    let stmt;
    try {
      stmt = this.db.prepare(lite);
    } catch (err) {
      err.message = `${err.message} (in: ${lite.replace(/\s+/g, ' ').trim().slice(0, 400)})`;
      throw err;
    }
    stmt.setReadBigInts(true);
    const args = params.map(param);
    const columns = stmt.columns();
    if (!columns.length) {
      const r = stmt.run(...args);
      return { rows: [], rowCount: Number(r.changes), fields: [] };
    }
    const raw = stmt.all(...args);
    const kinds = columns.map((c) => RESULT_TYPES[c.name] || null);
    const rows = raw.map((r) => {
      const row = {};
      columns.forEach((c, i) => { row[c.name] = value(r[c.name], kinds[i]); });
      return row;
    });
    return { rows, rowCount: rows.length, fields: columns.map((c) => ({ name: c.name })) };
  }

  async end() {
    try { this.db.close(); } catch { /* already closed */ }
  }
}

module.exports = { SqliteClient, translate, param, value };
