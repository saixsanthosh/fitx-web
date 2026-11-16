import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { EXPORT_TABLES } from "@/lib/account/export";

// "Download my data" reads every table in EXPORT_TABLES with the member's own session. A table, column
// or select list the database does not have, or a column members may not read, is an error that stops
// the whole export, so each entry is checked here against the migrations themselves.

/** Per-user tables that are not exported, and why. */
const LEFT_OUT: Record<string, string> = {
  ai_coach_usage_events: "request counts for the coach's daily limit, kept 7 days; members cannot read the table",
  fitx_rate_limits: "food search counters, kept 2 days; members cannot read the table",
  fitx_admin_members: "FITX Admin staff roles, not member data",
};

const DIR = path.resolve(process.cwd(), "supabase/migrations");
// Seed parts only insert rows; skipping them keeps this fast.
const SQL = readdirSync(DIR)
  .filter((name) => name.endsWith(".sql") && !/_seed_part_|_free_exercise_db_part_/.test(name))
  .sort()
  .map((name) => readFileSync(path.join(DIR, name), "utf8").replace(/--.*$/gm, ""))
  .join("\n;\n");

type Table = { columns: Set<string>; keys: string[][]; references: Set<string>; accountColumns: Set<string> };
const TABLES = new Map<string, Table>();

const names = (list: string) => list.split(",").map((name) => name.trim().replace(/"/g, "")).filter(Boolean);

/** Walks `text` from `from`, skipping 'quoted' strings, and calls `visit` with each character and its bracket depth. */
function walk(text: string, from: number, visit: (char: string, depth: number, index: number) => boolean | void) {
  let depth = 0;
  for (let i = from; i < text.length; i += 1) {
    const char = text[i];
    if (char === "'") {
      const end = text.indexOf("'", i + 1);
      i = end === -1 ? text.length : end;
      continue;
    }
    if (char === "(" || char === "[") depth += 1;
    else if (char === ")" || char === "]") depth -= 1;
    if (visit(char, depth, i)) return i;
  }
  return -1;
}

function closingParen(text: string, open: number) {
  return walk(text, open, (char, depth) => char === ")" && depth === 0);
}

/** Comma-separated parts outside any brackets or quotes. */
function topLevel(text: string) {
  const parts: string[] = [];
  let start = 0;
  walk(text, 0, (char, depth, index) => {
    if (char === "," && depth === 0) {
      parts.push(text.slice(start, index).trim());
      start = index + 1;
    }
  });
  parts.push(text.slice(start).trim());
  return parts.filter(Boolean);
}

for (const match of SQL.matchAll(/create table (?:if not exists )?public\.(\w+)\s*\(/gi)) {
  const open = match.index + match[0].length - 1;
  const table = TABLES.get(match[1]) ?? { columns: new Set<string>(), keys: [], references: new Set<string>(), accountColumns: new Set<string>() };
  for (const part of topLevel(SQL.slice(open + 1, closingParen(SQL, open)))) {
    for (const reference of part.matchAll(/references public\.(\w+)/gi)) table.references.add(reference[1]);
    const key = /(?:primary key|unique)\s*\(([^)]*)\)/i.exec(part);
    if (key) table.keys.push(names(key[1]));
    const foreign = /^(?:constraint \w+ )?foreign key\s*\(([^)]*)\)\s*references auth\.users\b/i.exec(part);
    if (foreign) for (const column of names(foreign[1])) table.accountColumns.add(column);
    if (/^(constraint|primary|foreign|unique|check|exclude)\b/i.test(part)) continue;
    const column = /^"?(\w+)"?/.exec(part)![1];
    table.columns.add(column);
    if (!key && /\b(primary key|unique)\b/i.test(part)) table.keys.push([column]);
    if (/\breferences auth\.users\b/i.test(part)) table.accountColumns.add(column);
  }
  TABLES.set(match[1], table);
}
for (const match of SQL.matchAll(/alter table (?:only )?(?:if exists )?public\.(\w+)\s+([^;]*);/gi)) {
  const table = TABLES.get(match[1]);
  if (!table) continue;
  for (const column of match[2].matchAll(/add column (?:if not exists )?"?(\w+)"?/gi)) table.columns.add(column[1]);
  for (const key of match[2].matchAll(/add constraint \w+ (?:primary key|unique)\s*\(([^)]*)\)/gi)) table.keys.push(names(key[1]));
}

/** What `authenticated` may select, statement by statement: Supabase's default grant, nothing, the whole table, or some columns. */
type Access = "default" | "none" | "table" | Set<string>;
const ACCESS = new Map<string, Access>();
for (const match of SQL.matchAll(/\b(grant|revoke)\s+([^;]*?)\s+on\s+(?:table\s+)?([^;]*?)\s+(?:to|from)\s+([^;]*?);/gi)) {
  const [, verb, privileges, targets, roles] = match;
  if (!/\bauthenticated\b/i.test(roles)) continue;
  const someColumns = /\bselect\s*\(([^)]*)\)/i.exec(privileges);
  if (!someColumns && !/\b(select|all)\b/i.test(privileges)) continue;
  for (const target of targets.split(",")) {
    const table = /^public\.(\w+)$/.exec(target.trim())?.[1];
    if (!table) continue;
    const current = ACCESS.get(table) ?? "default";
    if (verb.toLowerCase() === "revoke") ACCESS.set(table, "none");
    else if (!someColumns) ACCESS.set(table, "table");
    else if (current === "none") ACCESS.set(table, new Set(names(someColumns[1])));
    else if (current instanceof Set) ACCESS.set(table, new Set([...current, ...names(someColumns[1])]));
  }
}

/** A select list: plain columns and embedded tables ("*" means every column). */
function parseSelect(list: string) {
  const plain: string[] = [];
  const embeds: Array<{ table: string; columns: string[] }> = [];
  for (const part of topLevel(list)) {
    const embed = /^(\w+)\((.*)\)$/.exec(part);
    if (embed) embeds.push({ table: embed[1], columns: names(embed[2]) });
    else if (part !== "*") plain.push(part);
  }
  return { plain, embeds };
}

test("the migrations were read", () => {
  assert.ok(TABLES.size > 40, `found ${TABLES.size} tables`);
  assert.ok(TABLES.get("planner_events")?.columns.has("local_date"), "columns added later are found");
});

test("every exported table, owner, order and selected column exists, and members may read them", () => {
  for (const spec of EXPORT_TABLES) {
    const table = TABLES.get(spec.table);
    assert.ok(table, `${spec.table}: no migration creates it`);
    const order = typeof spec.order === "string" ? [spec.order] : [...spec.order];
    const { plain, embeds } = parseSelect(spec.columns ?? "*");
    const read = [spec.owner, ...order, ...plain];
    for (const column of read) assert.ok(table.columns.has(column), `${spec.table}.${column} does not exist`);
    assert.ok(table.accountColumns.has(spec.owner), `${spec.table}.${spec.owner} is not the account id`);
    // Paging needs an order that is unique among the owner's rows.
    const keyed = new Set([spec.owner, ...order]);
    assert.ok(table.keys.some((key) => key.every((column) => keyed.has(column))), `${spec.table}: ordering by ${order.join(", ")} is not unique`);

    const access = ACCESS.get(spec.table) ?? "default";
    assert.notEqual(access, "none", `${spec.table}: members may not read it`);
    if (access instanceof Set) {
      assert.ok(spec.columns, `${spec.table}: members may read only some columns, so the export must list them`);
      for (const column of read) assert.ok(access.has(column), `${spec.table}.${column}: members may not read this column`);
    }
    for (const embed of embeds) {
      const child = TABLES.get(embed.table);
      assert.ok(child, `${embed.table}: no migration creates it`);
      assert.ok(child.references.has(spec.table), `${embed.table} has no foreign key to ${spec.table}, so it cannot be embedded`);
      const childAccess = ACCESS.get(embed.table) ?? "default";
      assert.notEqual(childAccess, "none", `${embed.table}: members may not read it`);
      for (const column of embed.columns) {
        assert.ok(child.columns.has(column), `${embed.table}.${column} does not exist`);
        if (childAccess instanceof Set) assert.ok(childAccess.has(column), `${embed.table}.${column}: members may not read this column`);
      }
    }
  }
});

test("every per-user table is exported, or left out on purpose", () => {
  const exported = new Set(EXPORT_TABLES.map((spec) => spec.table));
  const perUser = [...TABLES].filter(([, table]) => table.accountColumns.has("user_id") || table.accountColumns.has("id")).map(([name]) => name);
  assert.deepEqual(perUser.filter((name) => !exported.has(name) && !(name in LEFT_OUT)), [], "add these to EXPORT_TABLES or to LEFT_OUT with a reason");
  for (const name of Object.keys(LEFT_OUT)) assert.ok(perUser.includes(name), `${name} is no longer a per-user table`);
  assert.equal(ACCESS.get("ai_coach_usage_events"), "none");
  assert.equal(ACCESS.get("fitx_rate_limits"), "none");
});

test("each table is exported once, under its own label", () => {
  assert.equal(new Set(EXPORT_TABLES.map((spec) => spec.table)).size, EXPORT_TABLES.length);
  assert.equal(new Set(EXPORT_TABLES.map((spec) => spec.label)).size, EXPORT_TABLES.length);
});
