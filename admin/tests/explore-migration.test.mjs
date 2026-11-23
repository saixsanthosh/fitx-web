// Static checks of 20261124100020_fitx_admin_explore.sql (#54): it creates no table, every function is
// service_role only with an empty search_path, every operator function checks explore.moderate first, every audit
// action it writes is catalogued as written by the database, and its undo drops exactly what it adds.
// admin/tests/database/explore-checks.sql runs it on a local database.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { importTypeScriptModule } from "./helpers/typescript-module.mjs";

const sql = await readFile(new URL("../../supabase/migrations/20261124100020_fitx_admin_explore.sql", import.meta.url), "utf8");
const audit = await importTypeScriptModule("src/lib/audit-catalog.ts");
const explore = await importTypeScriptModule("src/lib/audit-catalog-explore.ts");
const core = await importTypeScriptModule("src/lib/audit-catalog-core.ts");
const runner = await readFile(new URL("./database/run-database-checks.sh", import.meta.url), "utf8");

const body = sql.replace(/^--.*$/gm, "");
const functions = [...body.matchAll(/create or replace function public\.(\w+)\(([\s\S]*?)\)\s*returns ([\s\S]*?)\nas \$function\$/g)].map((match) => ({ name: match[1], header: match[0] }));
const definition = (name) => body.slice(body.indexOf(`function public.${name}(`), body.indexOf("$function$;", body.indexOf(`function public.${name}(`)));

test("it creates no table and ends by reloading the API schema", () => {
  assert.doesNotMatch(body, /create table/i);
  assert.doesNotMatch(body, /\bdrop (table|column|policy)\b/i);
  assert.match(sql.trimEnd(), /notify pgrst, 'reload schema';$/);
  assert.match(sql, /^-- Undo /m);
  assert.deepEqual(functions.map((fn) => fn.name).sort(), [
    "fitx_admin_explore_meter", "fitx_admin_explore_reason_words", "fitx_admin_op_close_challenge", "fitx_admin_op_moderate",
    "fitx_admin_op_save_challenge", "fitx_admin_op_save_challenge_template", "fitx_admin_op_save_community", "fitx_admin_op_save_platform_settings",
    "fitx_admin_op_set_community_role", "fitx_admin_role_permissions",
  ]);
});

test("every function pins search_path and runs for service_role only; operator functions are security definer", () => {
  for (const fn of functions) {
    assert.match(fn.header, /set search_path = ''/, fn.name);
    if (fn.name.startsWith("fitx_admin_op_") || fn.name === "fitx_admin_explore_meter") assert.match(fn.header, /security definer/, fn.name);
    assert.match(body, new RegExp(`revoke all on function public\\.${fn.name}\\([^)]*\\) from public, anon, authenticated;`), `${fn.name} is not revoked`);
    const granted = [...body.matchAll(new RegExp(`grant execute on function public\\.${fn.name}\\([^)]*\\) to (\\w+);`, "g"))].map((match) => match[1]);
    assert.deepEqual(granted, ["service_role"], fn.name);
  }
});

test("each operator function checks its permission before anything else", () => {
  for (const fn of functions.filter((entry) => entry.name.startsWith("fitx_admin_op_"))) {
    const text = definition(fn.name);
    const permission = fn.name === "fitx_admin_op_save_platform_settings" ? "settings\\.manage" : "explore\\.moderate";
    const check = text.search(new RegExp(`if not public\\.fitx_admin_op_can\\(p_operator_id, '${permission}'\\) then\\s+raise exception using errcode = '42501'`));
    assert.ok(check > 0, `${fn.name} checks ${permission}`);
    const begin = text.indexOf("\nbegin\n");
    const firstStatement = text.slice(begin + 7).trimStart();
    assert.ok(firstStatement.startsWith("if not public.fitx_admin_op_can("), `${fn.name}: the permission check is the first statement`);
  }
});

test("every audit action the migration writes is catalogued as a database action, and the reverse", () => {
  // Audit actions: the second argument of fitx_admin_op_log_event, or the moderation function's action-to-audit case.
  const literal = new Set([
    ...[...body.matchAll(/fitx_admin_op_log_event\(p_operator_id, '([a-z_]+)'/g)].map((match) => match[1]),
    ...[...definition("fitx_admin_op_moderate").matchAll(/when '[a-z_]+' then '(explore_[a-z_]+)'/g)].map((match) => match[1]),
  ]);
  assert.ok(literal.size >= 16, String(literal.size));
  for (const action of literal) {
    assert.ok(audit.isAuditAction(action), `${action} is written by SQL but missing from the catalogue`);
    assert.equal(audit.AUDIT_ACTIONS[action].source, "database", action);
  }
  for (const [action, entry] of Object.entries(explore.EXPLORE_AUDIT_ACTIONS)) {
    if (entry.source === "database") assert.ok(literal.has(action), `${action} is catalogued as database but the migration never writes it`);
    else assert.ok(!body.includes(`'${action}'`), `${action} is a server action`);
  }
  for (const [, resource] of body.matchAll(/fitx_admin_op_log_event\(p_operator_id, '[a-z_]+', '([a-z_]+)'/g)) assert.ok(audit.AUDIT_RESOURCE_TYPES.includes(resource), resource);
  for (const resource of ["social_report", "social_post", "social_comment", "social_story", "social_profile", "social_community", "social_challenge"]) {
    assert.ok(audit.AUDIT_RESOURCE_TYPES.includes(resource), resource);
  }
  assert.equal(audit.AUDIT_ACTIONS.explore_report_viewed.source, "server");
  assert.ok(audit.READ_ONLY_AUDIT_ACTIONS.includes("explore_report_viewed"), "viewing a report stays off the Dashboard's recent activity");
  for (const action of core.READ_ONLY_AUDIT_ACTIONS) assert.ok(audit.READ_ONLY_AUDIT_ACTIONS.includes(action), action);
});

test("the audit rows hold codes and counts: the moderator's note never reaches them", () => {
  const moderate = definition("fitx_admin_op_moderate");
  const logCall = moderate.slice(moderate.indexOf("perform public.fitx_admin_op_log_event("));
  assert.match(logCall, /'note', v_note is not null/);
  assert.doesNotMatch(logCall.slice(0, logCall.indexOf(";")), /'note', v_note[,)]/);
  assert.doesNotMatch(logCall.slice(0, logCall.indexOf(";")), /p_note|body|caption/);
});

test("the undo drops every new function and restores the 21-permission role table; the runner re-runs the file last", () => {
  const undo = sql.slice(sql.indexOf("-- Undo"), sql.indexOf("\ndo $do$"));
  for (const fn of functions.filter((entry) => !["fitx_admin_role_permissions", "fitx_admin_op_save_platform_settings"].includes(entry.name))) {
    assert.match(undo, new RegExp(`public\\.${fn.name}\\(`), `the undo leaves ${fn.name}`);
  }
  const superAdmin = undo.match(/when 'super_admin' then array\[([^\]]*)\]/);
  assert.equal([...superAdmin[1].matchAll(/'([a-z.]+)'/g)].length, 21);
  assert.doesNotMatch(undo, /explore\.(view|moderate)/);
  assert.match(undo, /re-run 20261121100033_fitx_admin_ops\.sql/);
  assert.match(runner, /"\$ROOT"\/supabase\/migrations\/2026112110003\*_fitx_admin_\*\.sql "\$ROOT"\/supabase\/migrations\/20261124100020_fitx_admin_explore\.sql; do/);
});

test("the settings save keeps its signature and only gains the two Explore keys", () => {
  const save = definition("fitx_admin_op_save_platform_settings");
  assert.match(save, /feature_keys constant text\[\] := array\['ai_coach', 'home_workout', 'activity', 'subscriptions', 'support', 'explore', 'explore_video'\];/);
  assert.match(body, /fitx_admin_op_save_platform_settings\(\s*p_operator_id uuid,\s*p_features jsonb,\s*p_maintenance jsonb,\s*p_site jsonb,\s*p_expected_updated_at timestamptz default null\s*\)/);
});

test("the settings save keeps a saved switch the caller leaves out, so a save without the Explore keys never turns Explore on", () => {
  const save = definition("fitx_admin_op_save_platform_settings");
  assert.match(save, /pg_catalog\.jsonb_each\(case when pg_catalog\.jsonb_typeof\(previous\.features\) = 'object'/);
  assert.match(save, /where e\.key = any \(feature_keys\)[^;]*\|\| p_features;/);
  assert.match(save, /set features = v_features,/);
  assert.doesNotMatch(save, /set features = p_features/);
  assert.match(save, /'after', pg_catalog\.jsonb_build_object\('features', v_features,/);
});
