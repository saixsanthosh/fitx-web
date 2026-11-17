// The PostgREST part of the e2e Supabase stand-in. Every request runs inside one transaction as the role
// the JWT names (anon, authenticated with request.jwt.claims, or service_role), so grants, column
// privileges, row level security, triggers and security definer functions are the database's own.
// The SQL mirrors what PostgREST 12 generates closely enough for supabase-js: json_agg over a subselect,
// embedded resources as correlated subqueries, RETURNING only the columns a mutation is asked for
// (RETURNING 1 otherwise), json_populate_recordset for bodies and json_to_record for RPC arguments.
import { lit, qi } from "./pg-wire.mjs";

const IDENT = /^[A-Za-z_][A-Za-z0-9_$]*$/;
const CAST = /^[A-Za-z_][A-Za-z0-9_ ]*(\[\])?$/;
const ROOT_RESERVED = new Set(["select", "on_conflict", "columns"]);

export class RestError extends Error {
  constructor(status, code, message, details = null, hint = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.hint = hint;
  }

  body() {
    return { code: this.code, details: this.details, hint: this.hint, message: this.message };
  }
}

const parseError = (what) => new RestError(400, "PGRST100", `"failed to parse ${what}"`, null, null);

function ident(name) {
  if (typeof name !== "string" || !IDENT.test(name)) throw parseError(`identifier (${name})`);
  return qi(name);
}

/** PostgREST's HTTP status for a Postgres error (src/PostgREST/Error.hs, roughly). */
export function statusForPg(code, role) {
  if (code === "42501") return role === "anon" ? 401 : 403;
  if (code === "42883" || code === "42P01") return 404;
  if (code === "23503" || code === "23505") return 409;
  if (code === "25006") return 405;
  if (code === "P0001") return 400;
  if (/^PT\d{3}$/.test(code)) return Number(code.slice(2));
  if (/^(08|53)/.test(code)) return 503;
  if (/^54/.test(code)) return 413;
  if (/^(28|0L|0P)/.test(code)) return 403;
  if (/^(09|25|2D|38|39|3B|40|55|57|58|F0|HV|P0|XX)/.test(code)) return 500;
  return 400;
}

export function restErrorFromPg(error, role) {
  const code = error.code ?? "XX000";
  return new RestError(statusForPg(code, role), code, error.message ?? "database error", error.detail ?? null, error.hint ?? null);
}

// ------------------------------------------------------------------------------------------ schema cache

export class SchemaCache {
  constructor(pool) {
    this.pool = pool;
  }

  async load() {
    const data = await this.pool.json(`select json_build_object(
      'relations', (select coalesce(json_agg(json_build_object('name', c.relname, 'kind', c.relkind)), '[]')
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r','v','m','p','f')),
      'columns', (select coalesce(json_agg(json_build_object('table', c.relname, 'name', a.attname, 'type', format_type(a.atttypid, a.atttypmod)) order by c.relname, a.attnum), '[]')
        from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r','v','m','p','f') and a.attnum > 0 and not a.attisdropped),
      'keys', (select coalesce(json_agg(json_build_object('table', c.relname, 'type', con.contype, 'columns',
          (select json_agg(a.attname order by k.ord) from unnest(con.conkey) with ordinality k(num, ord)
             join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.num))), '[]')
        from pg_constraint con join pg_class c on c.oid = con.conrelid join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and con.contype in ('p','u')),
      'fks', (select coalesce(json_agg(json_build_object('name', con.conname, 'table', src.relname, 'target', dst.relname,
          'columns', (select json_agg(a.attname order by k.ord) from unnest(con.conkey) with ordinality k(num, ord)
             join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.num),
          'targetColumns', (select json_agg(a.attname order by k.ord) from unnest(con.confkey) with ordinality k(num, ord)
             join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.num))), '[]')
        from pg_constraint con
        join pg_class src on src.oid = con.conrelid join pg_namespace sn on sn.oid = src.relnamespace
        join pg_class dst on dst.oid = con.confrelid join pg_namespace dn on dn.oid = dst.relnamespace
        where con.contype = 'f' and sn.nspname = 'public' and dn.nspname = 'public'),
      'functions', (select coalesce(json_agg(json_build_object('name', p.proname, 'retset', p.proretset,
          'rettype', format_type(p.prorettype, null), 'argnames', p.proargnames, 'argmodes', p.proargmodes,
          'types', (select json_agg(format_type(x, null) order by o) from unnest(coalesce(p.proallargtypes, p.proargtypes::oid[])) with ordinality u(x, o)),
          'ndefaults', p.pronargdefaults, 'volatility', p.provolatile)), '[]')
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prokind = 'f')
    )::text`);
    this.tables = new Map();
    for (const relation of data.relations) this.tables.set(relation.name, { name: relation.name, kind: relation.kind, columns: new Map(), pk: [], unique: [] });
    for (const column of data.columns) this.tables.get(column.table)?.columns.set(column.name, column.type);
    for (const key of data.keys) {
      const table = this.tables.get(key.table);
      if (!table) continue;
      if (key.type === "p") table.pk = key.columns;
      else table.unique.push(key.columns);
    }
    this.fks = data.fks;
    this.functions = new Map();
    for (const fn of data.functions) {
      const names = fn.argnames ?? [];
      const modes = fn.argmodes ?? null;
      const inputs = [];
      (fn.types ?? []).forEach((type, index) => {
        const mode = modes ? modes[index] : "i";
        if (mode === "i" || mode === "b" || mode === "v") inputs.push({ name: names[index] ?? "", type });
      });
      inputs.forEach((arg, index) => { arg.hasDefault = index >= inputs.length - fn.ndefaults; });
      const list = this.functions.get(fn.name) ?? [];
      list.push({ ...fn, inputs });
      this.functions.set(fn.name, list);
    }
    return this;
  }

  table(name) {
    const table = this.tables.get(name);
    if (!table) {
      throw new RestError(404, "PGRST205", `Could not find the table 'public.${name}' in the schema cache`, null, null);
    }
    return table;
  }

  /** How `child` embeds into `parent`: many-to-one (object), one-to-many or many-to-many (array). */
  relationship(parent, child, hints) {
    if (!this.tables.has(child)) {
      throw new RestError(400, "PGRST200", `Could not find a relationship between '${parent}' and '${child}' in the schema cache`,
        `Searched for a foreign key relationship between '${parent}' and '${child}' in the schema 'public', but no matches were found.`, null);
    }
    const matches = (fk) => !hints.length || hints.some((hint) => fk.name === hint || (fk.columns.length === 1 && fk.columns[0] === hint));
    const candidates = [];
    for (const fk of this.fks) {
      if (fk.table === parent && fk.target === child && matches(fk)) candidates.push({ cardinality: "one", fk, parentColumns: fk.columns,
        join: (p, c) => fk.columns.map((column, i) => `${c}.${qi(fk.targetColumns[i])} = ${p}.${qi(column)}`).join(" and ") });
      if (fk.table === child && fk.target === parent && parent !== child && matches(fk)) candidates.push({ cardinality: "many", fk, parentColumns: fk.targetColumns,
        join: (p, c) => fk.columns.map((column, i) => `${c}.${qi(column)} = ${p}.${qi(fk.targetColumns[i])}`).join(" and ") });
    }
    if (!candidates.length) {
      // Many-to-many through a junction table with a foreign key to each side.
      for (const junction of this.tables.keys()) {
        if (hints.length && !hints.includes(junction)) continue;
        const toParent = this.fks.find((fk) => fk.table === junction && fk.target === parent);
        const toChild = this.fks.find((fk) => fk.table === junction && fk.target === child && fk !== toParent);
        if (!toParent || !toChild || junction === parent || junction === child) continue;
        candidates.push({ cardinality: "many", parentColumns: toParent.targetColumns,
          join: (p, c) => `exists (select 1 from public.${qi(junction)} _j where ${toChild.columns.map((column, i) => `_j.${qi(column)} = ${c}.${qi(toChild.targetColumns[i])}`).join(" and ")} and ${toParent.columns.map((column, i) => `_j.${qi(column)} = ${p}.${qi(toParent.targetColumns[i])}`).join(" and ")})` });
      }
    }
    if (!candidates.length) {
      throw new RestError(400, "PGRST200", `Could not find a relationship between '${parent}' and '${child}' in the schema cache`,
        `Searched for a foreign key relationship between '${parent}' and '${child}' in the schema 'public', but no matches were found.`, null);
    }
    if (candidates.length > 1) {
      throw new RestError(300, "PGRST201", `Could not embed because more than one relationship was found for '${parent}' and '${child}'`, null,
        `Try changing '${child}' to one of the following: ${candidates.map((candidate) => `'${child}!${candidate.fk?.name ?? "junction"}'`).join(", ")}.`);
    }
    return candidates[0];
  }

  /** The overload of `name` that takes exactly these named arguments (the rest have defaults). */
  findFunction(name, keys) {
    const fn = (this.functions.get(name) ?? []).find((candidate) =>
      keys.every((key) => candidate.inputs.some((arg) => arg.name === key)) &&
      candidate.inputs.every((arg) => arg.hasDefault || keys.includes(arg.name)));
    if (!fn) {
      const signature = [...keys].sort().join(", ");
      throw new RestError(404, "PGRST202", `Could not find the function public.${name}(${signature}) in the schema cache`,
        `Searched for the function public.${name}${keys.length ? ` with parameter${keys.length === 1 ? "" : "s"} ${signature}` : " without parameters"} or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache.`, null);
    }
    return fn;
  }
}

// ------------------------------------------------------------------------------------------ parsing

/** Splits on `sep` outside parentheses and double quotes. */
function splitTopLevel(input, sep = ",") {
  const parts = [];
  let depth = 0;
  let quoted = false;
  let current = "";
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (ch === "\\" && quoted && i + 1 < input.length) {
      current += ch + input[i + 1];
      i += 1;
      continue;
    }
    if (ch === '"') quoted = !quoted;
    if (!quoted) {
      if (ch === "(") depth += 1;
      else if (ch === ")") depth -= 1;
    }
    if (ch === sep && depth === 0 && !quoted) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part.length);
}

function unquote(value) {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1).replace(/\\(["\\])/g, "$1");
  return value;
}

/** "data->a->>b" -> { column: "data", path: [{ op: "->", key: "a" }, { op: "->>", key: "b" }] } */
function parseJsonPath(input) {
  const start = input.indexOf("->");
  if (start < 0) return { column: input, path: [] };
  const column = input.slice(0, start);
  const path = [];
  const re = /->(>?)((?:[^-]|-(?!>))+)/g;
  let match;
  let consumed = start;
  while ((match = re.exec(input.slice(start))) !== null) {
    path.push({ op: match[1] ? "->>" : "->", key: match[2] });
    consumed = start + re.lastIndex;
  }
  if (consumed !== input.length) throw parseError(`json path (${input})`);
  return { column, path };
}

/** PostgREST select syntax: columns, alias:column, column::cast, json paths, embeds with !hints. */
export function parseSelect(raw) {
  const items = [];
  for (const part of splitTopLevel(raw || "*")) {
    let text = part;
    if (text.startsWith("...")) throw new RestError(400, "PGRST100", "spread embeds are not supported by the e2e stand-in");
    const paren = text.indexOf("(");
    if (paren >= 0 && text.endsWith(")")) {
      let head = text.slice(0, paren);
      const inner = text.slice(paren + 1, -1);
      let alias = null;
      const colon = head.indexOf(":");
      if (colon >= 0) {
        alias = head.slice(0, colon);
        head = head.slice(colon + 1);
      }
      const [relation, ...hints] = head.split("!");
      if (!relation) throw parseError(`embed (${text})`);
      if (relation === "count" || relation.endsWith(".count")) throw new RestError(400, "PGRST123", "aggregates are not supported by the e2e stand-in");
      items.push({ kind: "embed", alias, relation, hints, items: parseSelect(inner || "*") });
      continue;
    }
    if (text === "*") {
      items.push({ kind: "star" });
      continue;
    }
    let alias = null;
    const aliased = /^([^:]+):(?!:)(.*)$/.exec(text);
    if (aliased) {
      alias = aliased[1];
      text = aliased[2];
    }
    let cast = null;
    const castAt = text.indexOf("::");
    if (castAt >= 0) {
      cast = text.slice(castAt + 2);
      text = text.slice(0, castAt);
      if (!CAST.test(cast)) throw parseError(`cast (${cast})`);
    }
    const { column, path } = parseJsonPath(text);
    items.push({ kind: "field", alias, column, path, cast });
  }
  return items;
}

const emptyNode = () => ({ filters: [], logic: [], order: null, limit: null, offset: null, children: new Map() });

/** Groups query parameters by the embed they apply to: "rel.col=eq.1", "rel.order=...", "or=(...)"... */
export function paramTree(params, skip = new Set()) {
  const root = emptyNode();
  for (const [key, value] of params) {
    if (skip.has(key)) continue;
    const segments = key.split(".");
    let leaf;
    if (segments.length >= 2 && segments.at(-2) === "not" && (segments.at(-1) === "or" || segments.at(-1) === "and")) {
      leaf = `not.${segments.pop()}`;
      segments.pop();
    } else {
      leaf = segments.pop();
    }
    let node = root;
    for (const segment of segments) {
      if (!node.children.has(segment)) node.children.set(segment, emptyNode());
      node = node.children.get(segment);
    }
    if (node === root && ROOT_RESERVED.has(leaf)) continue;
    if (leaf === "order") node.order = value;
    else if (leaf === "limit") node.limit = value;
    else if (leaf === "offset") node.offset = value;
    else if (leaf === "or" || leaf === "and" || leaf === "not.or" || leaf === "not.and") node.logic.push({ op: leaf, value });
    else node.filters.push({ column: leaf, value });
  }
  return root;
}

function integer(value, what) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw parseError(what);
  return number;
}

// ------------------------------------------------------------------------------------------ SQL building

function fieldSql(alias, { column, path, cast }) {
  let sql = `${alias}.${ident(column)}`;
  for (const segment of path) sql += `${segment.op}${/^-?\d+$/.test(segment.key) ? segment.key : lit(segment.key)}`;
  if (path.length) sql = `(${sql})`;
  if (cast) sql = `(${sql})::${cast}`;
  return sql;
}

function listItems(operand) {
  const inner = operand.replace(/^[({]/, "").replace(/[)}]$/, "");
  return splitTopLevel(inner).map(unquote);
}

const arrayLiteral = (items) => `{${items.map((item) => `"${String(item).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;

const SIMPLE_OPS = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=", like: "like", ilike: "ilike", match: "~", imatch: "~*", cs: "@>", cd: "<@", ov: "&&", sl: "<<", sr: ">>", nxr: "&<", nxl: "&>", adj: "-|-" };
const FTS = { fts: "to_tsquery", plfts: "plainto_tsquery", phfts: "phraseto_tsquery", wfts: "websearch_to_tsquery" };

function condition(alias, columnPath, value, { quotedOperand = false } = {}) {
  const { column, path } = parseJsonPath(columnPath);
  const col = fieldSql(alias, { column, path, cast: null });
  let text = value;
  let negate = false;
  if (text.startsWith("not.")) {
    negate = true;
    text = text.slice(4);
  }
  const dot = text.indexOf(".");
  if (dot < 0) throw parseError(`filter (${columnPath}=${value})`);
  let op = text.slice(0, dot);
  let operand = text.slice(dot + 1);
  let modifier = null;
  let config = null;
  const modified = /^([a-z]+)\((any|all)\)$/.exec(op);
  if (modified) [, op, modifier] = modified;
  const configured = /^(fts|plfts|phfts|wfts)\(([A-Za-z_]+)\)$/.exec(op);
  if (configured) [, op, config] = configured;
  if (quotedOperand && op !== "in") operand = unquote(operand);
  let sql;
  if (op === "is") {
    const word = operand.toLowerCase();
    if (word === "null") sql = `${col} is null`;
    else if (word === "not_null") sql = `${col} is not null`;
    else if (word === "true" || word === "false" || word === "unknown") sql = `${col} is ${word}`;
    else throw parseError(`filter (is.${operand})`);
  } else if (op === "isdistinct") {
    sql = `${col} is distinct from ${lit(operand)}`;
  } else if (op === "in") {
    sql = `${col} = any(${lit(arrayLiteral(listItems(operand)))})`;
  } else if (FTS[op]) {
    sql = `${col} @@ ${FTS[op]}(${config ? `${lit(config)}::regconfig, ` : ""}${lit(operand)})`;
  } else if (SIMPLE_OPS[op]) {
    let operandValue = operand;
    if (op === "like" || op === "ilike") operandValue = operandValue.replace(/\*/g, "%");
    if (modifier) {
      const items = listItems(operandValue).map((item) => (op === "like" || op === "ilike" ? item.replace(/\*/g, "%") : item));
      sql = `${col} ${SIMPLE_OPS[op]} ${modifier}(${lit(arrayLiteral(items))})`;
    } else {
      if ((op === "cs" || op === "cd" || op === "ov") && operandValue.startsWith("(") && operandValue.endsWith(")")) operandValue = `{${operandValue.slice(1, -1)}}`;
      sql = `${col} ${SIMPLE_OPS[op]} ${lit(operandValue)}`;
    }
  } else {
    throw parseError(`filter operator (${op})`);
  }
  return negate ? `not (${sql})` : sql;
}

function logicSql(alias, op, value) {
  const negate = op.startsWith("not.");
  const kind = negate ? op.slice(4) : op;
  const text = value.trim();
  if (!text.startsWith("(") || !text.endsWith(")")) throw parseError(`logic tree (${op}=${value})`);
  const parts = splitTopLevel(text.slice(1, -1)).map((part) => {
    const nested = /^(not\.)?(and|or)(\(.*\))$/s.exec(part);
    if (nested) return logicSql(alias, `${nested[1] ?? ""}${nested[2]}`, nested[3]);
    const dot = part.indexOf(".");
    if (dot < 0) throw parseError(`logic tree element (${part})`);
    return condition(alias, part.slice(0, dot), part.slice(dot + 1), { quotedOperand: true });
  });
  if (!parts.length) return negate ? "false" : "true";
  const joined = `(${parts.join(kind === "or" ? " or " : " and ")})`;
  return negate ? `not ${joined}` : joined;
}

function whereParts(alias, node) {
  return [
    ...node.filters.map(({ column, value }) => condition(alias, column, value)),
    ...node.logic.map(({ op, value }) => logicSql(alias, op, value)),
  ];
}

function orderSql(alias, raw) {
  if (!raw) return "";
  const terms = splitTopLevel(raw).map((term) => {
    const segments = term.split(".");
    const columnPath = segments.shift();
    let direction = "asc";
    let nulls = "";
    for (const segment of segments) {
      if (segment === "asc" || segment === "desc") direction = segment;
      else if (segment === "nullsfirst") nulls = " nulls first";
      else if (segment === "nullslast") nulls = " nulls last";
      else throw parseError(`order (${raw})`);
    }
    const { column, path } = parseJsonPath(columnPath);
    return `${fieldSql(alias, { column, path, cast: null })} ${direction}${nulls}`;
  });
  return ` order by ${terms.join(", ")}`;
}

class Builder {
  constructor(schema) {
    this.schema = schema;
    this.count = 0;
  }

  alias() {
    this.count += 1;
    return `t${this.count}`;
  }

  /** Select items over `alias` (a row of `table`), the parent columns they read, and inner-join conditions. */
  select(table, items, alias, node) {
    const info = this.schema.table(table);
    const columns = [];
    const needed = new Set();
    const inner = [];
    let star = false;
    for (const item of items) {
      if (item.kind === "star") {
        columns.push(`${alias}.*`);
        star = true;
      } else if (item.kind === "field") {
        const name = item.alias ?? (item.path.length ? item.path.at(-1).key : item.column);
        columns.push(`${fieldSql(alias, item)} as ${qi(name)}`);
        needed.add(item.column);
      } else {
        const hints = item.hints.filter((hint) => hint !== "inner" && hint !== "left");
        const relation = this.schema.relationship(info.name, item.relation, hints);
        const childAlias = this.alias();
        const childNode = node.children.get(item.alias ?? item.relation) ?? node.children.get(item.relation) ?? emptyNode();
        const child = this.select(item.relation, item.items, childAlias, childNode);
        for (const column of relation.parentColumns) needed.add(column);
        const conditions = [relation.join(alias, childAlias), ...child.inner, ...whereParts(childAlias, childNode)];
        const from = `from public.${qi(item.relation)} ${childAlias} where ${conditions.join(" and ")}`;
        const wrapped = `_${childAlias}`;
        const limit = childNode.limit !== null ? ` limit ${integer(childNode.limit, "limit")}` : "";
        const offset = childNode.offset !== null ? ` offset ${integer(childNode.offset, "offset")}` : "";
        const sql = relation.cardinality === "one"
          ? `(select row_to_json(${wrapped}) from (select ${child.columns.join(", ")} ${from} limit 1) ${wrapped})`
          : `(select coalesce(json_agg(${wrapped}), '[]'::json) from (select ${child.columns.join(", ")} ${from}${orderSql(childAlias, childNode.order)}${limit}${offset}) ${wrapped})`;
        columns.push(`${sql} as ${qi(item.alias ?? item.relation)}`);
        if (item.hints.includes("inner")) inner.push(`exists (select 1 ${from})`);
      }
    }
    if (!columns.length) columns.push(`${alias}.*`);
    return { columns, needed, inner, star: star || !items.length };
  }
}

// ------------------------------------------------------------------------------------------ requests

function preferences(header) {
  const prefer = {};
  for (const part of String(header ?? "").split(",")) {
    const [key, value] = part.trim().split("=");
    if (key) prefer[key.trim()] = (value ?? "").trim();
  }
  return prefer;
}

function stripNulls(value) {
  if (Array.isArray(value)) return value.map(stripNulls);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null));
  return value;
}

function rangeOf(node, rangeHeader) {
  let limit = node.limit !== null ? integer(node.limit, "limit") : null;
  let offset = node.offset !== null ? integer(node.offset, "offset") : 0;
  const header = /^(?:items=)?(\d+)-(\d*)$/.exec(String(rangeHeader ?? "").trim());
  if (header) {
    offset = Number(header[1]);
    if (header[2]) limit = Number(header[2]) - offset + 1;
  }
  return { limit, offset };
}

/**
 * Handles /rest/v1/<table> and /rest/v1/rpc/<function>. `run(sqlStatements, { readOnly })` executes inside the
 * request's role transaction and returns the data rows; `finish(commit)` ends that transaction.
 */
export async function handleRest(schema, tx, request) {
  const { method, resource, params, headers, body } = request;
  const prefer = preferences(headers.prefer);
  const accept = String(headers.accept ?? "");
  const single = accept.includes("vnd.pgrst.object");
  const strip = accept.includes("nulls=stripped");
  const profile = headers["accept-profile"] ?? headers["content-profile"];
  if (profile && profile !== "public") throw new RestError(406, "PGRST106", "The schema must be one of the following: public", null, null);

  const respond = async (status, rows, { count = null, offset = 0, minimal = false, isArray = true } = {}) => {
    const out = { status, headers: {} };
    if (isArray) {
      const n = Array.isArray(rows) ? rows.length : 0;
      out.headers["content-range"] = n ? `${offset}-${offset + n - 1}/${count ?? "*"}` : `*/${count ?? "*"}`;
    }
    if (single && isArray) {
      const n = Array.isArray(rows) ? rows.length : 0;
      if (n !== 1) {
        await tx.finish(false);
        throw new RestError(406, "PGRST116", "JSON object requested, multiple (or no) rows returned", `The result contains ${n} rows`, null);
      }
    }
    const commit = prefer.tx !== "rollback";
    await tx.finish(commit);
    if (minimal) return out;
    let data = single && isArray ? rows[0] : rows;
    if (strip) data = stripNulls(data);
    out.body = data;
    return out;
  };

  if (resource.startsWith("rpc/")) {
    const name = resource.slice(4);
    ident(name);
    const args = method === "GET" || method === "HEAD" ? {} : (body ?? {});
    if (typeof args !== "object" || Array.isArray(args)) throw new RestError(400, "PGRST102", "RPC arguments must be a JSON object");
    const fnCandidates = schema.functions.get(name) ?? [];
    if (method === "GET" || method === "HEAD") {
      const argNames = new Set(fnCandidates.flatMap((fn) => fn.inputs.map((arg) => arg.name)));
      for (const [key, value] of params) if (argNames.has(key)) args[key] = value;
    }
    const keys = Object.keys(args);
    const fn = schema.findFunction(name, keys);
    const defs = keys.map((key) => `${ident(key)} ${fn.inputs.find((arg) => arg.name === key).type}`).join(", ");
    const call = `public.${qi(name)}(${keys.map((key) => `${qi(key)} := _a.${qi(key)}`).join(", ")})`;
    const from = keys.length
      ? `json_to_record(${lit(JSON.stringify(args))}::json) as _a(${defs}) cross join lateral ${call} _pgrst_fn`
      : `public.${qi(name)}() _pgrst_fn`;
    let sql;
    if (fn.rettype === "void") sql = `select 'null' from ${from}`;
    else if (fn.retset) sql = `select coalesce(json_agg(_pgrst_fn), '[]'::json)::text from ${from}`;
    else sql = `select to_json(_pgrst_fn)::text from ${from}`;
    const [rows] = await tx.run([sql], { readOnly: method === "GET" || method === "HEAD" });
    const value = JSON.parse(rows?.[0]?.[0] ?? "null");
    if (fn.rettype === "void") {
      await tx.finish(prefer.tx !== "rollback");
      return { status: 204, headers: {} };
    }
    if (fn.retset) return respond(200, value, { minimal: method === "HEAD" });
    await tx.finish(prefer.tx !== "rollback");
    return { status: 200, headers: {}, body: strip ? stripNulls(value) : value };
  }

  ident(resource);
  const table = schema.table(resource);
  const items = parseSelect(params.get("select") ?? "*");
  const node = paramTree(params);
  const builder = new Builder(schema);
  const built = builder.select(table.name, items, "t0", node);
  const wantCount = /^(exact|planned|estimated)$/.test(prefer.count ?? "");

  if (method === "GET" || method === "HEAD") {
    const where = [...whereParts("t0", node), ...built.inner];
    const base = `from public.${qi(table.name)} t0${where.length ? ` where ${where.join(" and ")}` : ""}`;
    const { limit, offset } = rangeOf(node, headers.range);
    const page = `${orderSql("t0", node.order)}${limit !== null ? ` limit ${limit}` : ""}${offset ? ` offset ${offset}` : ""}`;
    const statements = [`select coalesce(json_agg(_r), '[]'::json)::text from (select ${built.columns.join(", ")} ${base}${page}) _r`];
    if (wantCount) statements.push(`select count(*)::text ${base}`);
    const [rows, counted] = await tx.run(statements, { readOnly: true });
    const data = JSON.parse(rows[0][0]);
    return respond(200, data, { count: wantCount ? Number(counted[0][0]) : null, offset, minimal: method === "HEAD" });
  }

  const representation = prefer.return === "representation";
  const returning = representation
    ? (built.star ? "t0.*" : [...built.needed].map((column) => `t0.${ident(column)}`).join(", ") || "1")
    : "1";
  const outer = representation
    ? `select coalesce(json_agg(_r), '[]'::json)::text, (select count(*) from _m)::text from (select ${built.columns.join(", ")} from _m t0) _r`
    : `select '[]', count(*)::text from _m`;

  const checkColumns = (columns) => {
    for (const column of columns) {
      if (!table.columns.has(column)) {
        throw new RestError(400, "PGRST204", `Could not find the '${column}' column of '${table.name}' in the schema cache`, null, null);
      }
    }
  };

  let mutation;
  if (method === "POST") {
    const rows = Array.isArray(body) ? body : [body ?? {}];
    const fromParam = params.get("columns");
    const columns = fromParam
      ? splitTopLevel(fromParam).map(unquote)
      : [...new Set(rows.flatMap((row) => Object.keys(row ?? {})))];
    checkColumns(columns);
    const list = columns.map(ident).join(", ");
    const resolution = prefer.resolution;
    let conflict = "";
    if (resolution === "merge-duplicates" || resolution === "ignore-duplicates") {
      const target = params.get("on_conflict") ? splitTopLevel(params.get("on_conflict")).map(unquote) : table.pk;
      if (!target.length) throw new RestError(400, "PGRST100", `table ${table.name} has no primary key for on_conflict`);
      const updates = columns.map((column) => `${ident(column)} = excluded.${ident(column)}`);
      conflict = resolution === "ignore-duplicates" || !updates.length
        ? ` on conflict (${target.map(ident).join(", ")}) do nothing`
        : ` on conflict (${target.map(ident).join(", ")}) do update set ${updates.join(", ")}`;
    }
    mutation = columns.length
      ? `insert into public.${qi(table.name)} as t0 (${list}) select ${list} from json_populate_recordset(null::public.${qi(table.name)}, ${lit(JSON.stringify(rows))}::json) _${conflict} returning ${returning}`
      : `insert into public.${qi(table.name)} as t0 default values${conflict} returning ${returning}`;
  } else if (method === "PATCH") {
    const values = body ?? {};
    const columns = Object.keys(values);
    checkColumns(columns);
    const where = whereParts("t0", node);
    if (!where.length) throw new RestError(400, "21000", "UPDATE requires a WHERE clause", null, null);
    if (!columns.length) {
      await tx.finish(false);
      return representation ? { status: 200, headers: {}, body: single ? null : [] } : { status: 204, headers: {} };
    }
    mutation = `update public.${qi(table.name)} as t0 set ${columns.map((column) => `${ident(column)} = _b.${ident(column)}`).join(", ")} from (select * from json_populate_record(null::public.${qi(table.name)}, ${lit(JSON.stringify(values))}::json)) _b where ${where.join(" and ")} returning ${returning}`;
  } else if (method === "DELETE") {
    const where = whereParts("t0", node);
    if (!where.length) throw new RestError(400, "21000", "DELETE requires a WHERE clause", null, null);
    mutation = `delete from public.${qi(table.name)} as t0 where ${where.join(" and ")} returning ${returning}`;
  } else {
    throw new RestError(405, "PGRST117", `Unsupported HTTP method: ${method}`);
  }

  const [rows] = await tx.run([`with _m as (${mutation}) ${outer}`], { readOnly: false });
  const data = JSON.parse(rows[0][0]);
  const affected = Number(rows[0][1]);
  const status = method === "POST" ? 201 : representation ? 200 : 204;
  if (!representation && single && affected !== 1) {
    await tx.finish(false);
    throw new RestError(406, "PGRST116", "JSON object requested, multiple (or no) rows returned", `The result contains ${affected} rows`, null);
  }
  if (!representation) {
    await tx.finish(prefer.tx !== "rollback");
    const out = { status, headers: {} };
    if (wantCount) out.headers["content-range"] = `*/${affected}`;
    return out;
  }
  return respond(status, data, { count: wantCount ? affected : null });
}
