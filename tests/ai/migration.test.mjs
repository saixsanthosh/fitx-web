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
  assert.deepEqual(tables.sort(), ["ai_coach_actions", "ai_coach_consents", "ai_coach_limits", "ai_coach_messages", "ai_coach_threads", "ai_coach_usage_events"]);
  for (const table of tables) assert.match(code, new RegExp(`alter table public\\.${table} enable row level security`), table);
  assert.doesNotMatch(code, /grant[^;]*\bto\s+[^;]*\banon\b/i);
  for (const table of tables) assert.match(code, new RegExp(`revoke all on table[^;]*public\\.${table}[^;]*from public, anon, authenticated`), table);
});

test("policies are owner-only with (select auth.uid())", () => {
  const policies = [...code.matchAll(/create policy (\w+) on public\.(\w+)[^;]*;/g)];
  assert.equal(policies.length, 4);
  for (const [statement] of policies) {
    assert.match(statement, /to authenticated/);
    assert.match(statement, /using \(\(select auth\.uid\(\)\) = user_id\) with check \(\(select auth\.uid\(\)\) = user_id\)/);
  }
});

test("security definer functions pin search_path to '' and are not callable by anon", () => {
  const functions = [...code.matchAll(/create or replace function public\.(\w+)\(([^)]*)\)([\s\S]*?)\$\$;?/g)];
  assert.ok(functions.length >= 6);
  for (const [, name, , header] of functions) {
    assert.match(header, /set search_path = ''/, name);
    if (/security definer/.test(header)) assert.match(code, new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon`), name);
  }
  // The quota table is only written by definer functions; members cannot update their own counts.
  assert.doesNotMatch(code, /grant [^;]*on table public\.ai_coach_usage_events/);
  assert.doesNotMatch(code, /grant [^;]*on table public\.ai_coach_limits/);
});

test("additive only: no existing table is altered or dropped", () => {
  assert.doesNotMatch(code, /\balter table public\.(?!ai_coach_)/);
  assert.doesNotMatch(code, /\bdrop (table|column)\b/);
});

test("live Postgres checks (FITX_TEST_POSTGRES=1)", { skip: process.env.FITX_TEST_POSTGRES !== "1" && "set FITX_TEST_POSTGRES=1 with PostgreSQL installed" }, () => {
  const output = execFileSync("zsh", [fileURLToPath(new URL("./sql/run-local-postgres.sh", import.meta.url))], { encoding: "utf8" });
  assert.match(output, /ALL SQL CHECKS PASSED/);
});
