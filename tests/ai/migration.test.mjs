// Checks on the coach migration. The static checks always run. The live checks apply all migrations to
// a throwaway local Postgres and test RLS, limits and "Add to My Food Plan" as two members; they run
// when FITX_TEST_POSTGRES=1 and PostgreSQL is installed (see tests/ai/sql/run-local-postgres.sh).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const sql = readFileSync(new URL("../../supabase/migrations/20261118150000_fitx_ai_coach.sql", import.meta.url), "utf8");
const code = sql.replace(/--[^\n]*/g, "");
const tables = [...code.matchAll(/create table if not exists public\.(\w+)/g)].map((match) => match[1]);

test("every new table has row-level security and nothing is granted to anon", () => {
  assert.deepEqual(tables.sort(), ["ai_coach_actions", "ai_coach_consents", "ai_coach_limits", "ai_coach_messages", "ai_coach_safety_notes", "ai_coach_threads", "ai_coach_usage_events"]);
  for (const table of tables) assert.match(code, new RegExp(`alter table public\\.${table} enable row level security`), table);
  assert.doesNotMatch(code, /grant[^;]*\bto\s+[^;]*\banon\b/i);
  for (const table of tables) assert.match(code, new RegExp(`revoke all on table[^;]*public\\.${table}[^;]*from public, anon, authenticated`), table);
});

test("policies are owner-only with (select auth.uid())", () => {
  const policies = [...code.matchAll(/create policy (\w+) on public\.(\w+)[^;]*;/g)];
  assert.equal(policies.length, 5);
  for (const [statement] of policies) {
    assert.match(statement, /to authenticated/);
    assert.match(statement, /using \(\(select auth\.uid\(\)\) = user_id\) with check \(\(select auth\.uid\(\)\) = user_id\)/);
  }
});

test("security definer functions pin search_path to '' and are not callable by anon", () => {
  const functions = [...code.matchAll(/create or replace function public\.(\w+)\(([^)]*)\)([\s\S]*?)\$\$;?/g)];
  assert.deepEqual(functions.map(([, name]) => name).sort(), [
    "ai_coach_apply_action", "ai_coach_delete_my_data", "ai_coach_quota_status", "ai_coach_release_quota", "ai_coach_take_quota",
  ]);
  for (const [, name, , header] of functions) {
    assert.match(header, /set search_path = ''/, name);
    if (/security definer/.test(header)) assert.match(code, new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon`), name);
  }
  // The quota table is only written by definer functions; members cannot update their own counts.
  assert.doesNotMatch(code, /grant [^;]*on table public\.ai_coach_usage_events/);
  assert.doesNotMatch(code, /grant [^;]*on table public\.ai_coach_limits/);
});

test("the eating-disorder pause outlives its conversation, and only “Delete my coach data” removes it", () => {
  const table = code.match(/create table if not exists public\.ai_coach_safety_notes \(([\s\S]*?)\n\);/)?.[1] ?? "";
  assert.match(table, /user_id uuid not null references auth\.users \(id\) on delete cascade/);
  assert.doesNotMatch(table, /ai_coach_threads|ai_coach_messages|content/, "no link to a conversation and none of the member's words");
  assert.match(code, /grant select, insert on table public\.ai_coach_safety_notes to authenticated;/);
  assert.doesNotMatch(code, /grant [^;]*\b(update|delete)\b[^;]*on table public\.ai_coach_safety_notes/);
  const remove = code.match(/function public\.ai_coach_delete_my_data\([\s\S]*?end \$\$/)?.[0] ?? "";
  assert.match(remove, /security definer/);
  assert.match(remove, /delete from public\.ai_coach_safety_notes n where n\.user_id = uid;/);
  // Usage rows that no longer count go too; the last 24 hours stay, so deleting coach data never resets the limit.
  assert.match(remove, /delete from public\.ai_coach_usage_events e where e\.user_id = uid and e\.created_at < pg_catalog\.now\(\) - interval '24 hours';/);
  for (const statement of remove.match(/delete from [^;]*;/g) ?? []) assert.match(statement, /\.user_id = uid\b/, `${statement} keeps to the caller's rows`);
});

test("data sharing is off unless the member chooses it, and the limit is a rolling 24 hours", () => {
  assert.match(code, /share_personal_data boolean not null default false/);
  for (const fn of ["ai_coach_take_quota", "ai_coach_quota_status"]) {
    const body = code.match(new RegExp(`function public\\.${fn}\\([\\s\\S]*?end \\$\\$`))?.[0] ?? "";
    assert.match(body, /created_at > pg_catalog\.now\(\) - interval '24 hours'/, fn);
    assert.doesNotMatch(body, /timezone|local_day/, `${fn} does not depend on the member's editable time zone`);
  }
});

test("Add to My Food Plan fills Nutrition v2's columns when they exist, and re-adds an archived food", () => {
  const apply = code.match(/function public\.ai_coach_apply_action\([\s\S]*?end \$\$/)?.[0] ?? "";
  for (const column of ["origin", "value_basis", "image_url", "source_ref", "archived_at"]) assert.match(apply, new RegExp(`'${column}' = any\\(food_columns\\)`), column);
  assert.match(apply, /f\.archived_at is null/);
});

test("additive only: no existing table is altered or dropped", () => {
  assert.doesNotMatch(code, /\balter table public\.(?!ai_coach_)/);
  assert.doesNotMatch(code, /\bdrop (table|column)\b/);
});

test("live Postgres checks (FITX_TEST_POSTGRES=1)", { skip: process.env.FITX_TEST_POSTGRES !== "1" && "set FITX_TEST_POSTGRES=1 with PostgreSQL installed" }, () => {
  const output = execFileSync("zsh", [fileURLToPath(new URL("./sql/run-local-postgres.sh", import.meta.url))], { encoding: "utf8" });
  assert.match(output, /ALL SQL CHECKS PASSED/);
});
