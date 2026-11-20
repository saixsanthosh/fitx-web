// Static checks of 20261121100033_fitx_admin_ops.sql and the admin-core screens: every function is security
// definer with an empty search_path and runs for service_role only, every new table has row level security,
// every audit action the migration writes is in the catalog, and the new screens check their permission.
// tests/platform/admin-ops-sql.test.mjs runs the migration itself on a local Postgres.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { importTypeScriptModule } from "./helpers/typescript-module.mjs";

const sql = await readFile(new URL("../../supabase/migrations/20261121100033_fitx_admin_ops.sql", import.meta.url), "utf8");
const audit = await importTypeScriptModule("src/lib/audit-catalog.ts");
const roles = await importTypeScriptModule("src/lib/roles.ts");
const sections = await importTypeScriptModule("src/components/admin-sections.ts");

const functions = [...sql.matchAll(/create or replace function public\.(\w+)\(([^)]*)\)\s*returns ([\s\S]*?)\nas \$function\$/g)].map((match) => ({ name: match[1], header: match[0] }));

test("every function is security definer, pins search_path and is revoked from the API roles", () => {
  assert.ok(functions.length >= 10, String(functions.length));
  for (const fn of functions) {
    assert.match(fn.header, /security definer/, fn.name);
    assert.match(fn.header, /set search_path = ''/, fn.name);
    assert.match(sql, new RegExp(`revoke all on function public\\.${fn.name}\\([^)]*\\) from public, anon, authenticated;`), `${fn.name} is not revoked`);
    const granted = [...sql.matchAll(new RegExp(`grant execute on function public\\.${fn.name}\\([^)]*\\) to (\\w+);`, "g"))].map((match) => match[1]);
    assert.ok(granted.every((role) => role === "service_role"), `${fn.name} is granted to ${granted.join(", ")}`);
    if (fn.header.includes("returns trigger")) assert.deepEqual(granted, [], `${fn.name} is a trigger function and needs no grant`);
    else assert.deepEqual(granted, ["service_role"], `${fn.name} needs a service_role grant`);
  }
});

test("operator writes check their permission first; new tables have row level security and member policies", () => {
  for (const [fn, permission] of [["fitx_admin_op_save_platform_settings", "settings.manage"], ["fitx_admin_op_send_notifications", "notifications.send"], ["fitx_admin_op_support_mark_seen", "support.view"]]) {
    const body = sql.slice(sql.indexOf(`function public.${fn}(`));
    assert.match(body.slice(0, body.indexOf("$function$;")), new RegExp(`if not public\\.fitx_admin_op_can\\(p_operator_id, '${permission.replace(".", "\\.")}'\\) then`), fn);
  }
  for (const table of ["platform_settings", "member_notifications"]) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table} \\(`), table);
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security;`), table);
    assert.match(sql, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated, service_role;`), table);
  }
  assert.match(sql, /grant update \(dismissed_at\) on table public\.member_notifications to authenticated;/);
  assert.doesNotMatch(sql, /grant (insert|delete|update) on table public\.platform_settings/);
  assert.doesNotMatch(sql, /grant select[^;]*created_by_operator_id[^;]*to authenticated/);
  assert.doesNotMatch(sql, /grant select[^;]*staff_seen_at[^;]*to authenticated/);
  assert.match(sql, /add column if not exists staff_seen_at timestamptz;/);
});

test("every audit action the migration writes is in the catalog, marked as written by the database", () => {
  const written = [...sql.matchAll(/fitx_admin_op_log_event\(p_operator_id, '([a-z_]+)'/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(written)].sort(), ["notification_sent", "platform_settings_updated", "support_request_read"]);
  for (const action of written) {
    assert.ok(audit.isAuditAction(action), action);
    assert.equal(audit.AUDIT_ACTIONS[action].source, "database", action);
  }
  for (const type of ["platform_settings", "notification_batch"]) assert.ok(audit.AUDIT_RESOURCE_TYPES.includes(type), type);
  for (const action of ["users_bulk_suspended", "admin_sessions_revoked"]) assert.equal(audit.AUDIT_ACTIONS[action].source, "server", action);
});

test("the ten sections link every admin-core screen, each behind its own permission", async () => {
  const routes = sections.ADMIN_SECTIONS.flatMap((section) => section.routes.map((route) => route.href));
  for (const route of ["/overview", "/users", "/support", "/notifications", "/announcements", "/access-control", "/audit", "/security", "/settings"]) {
    assert.ok(routes.includes(route), route);
    assert.ok(Object.hasOwn(roles.PAGE_PERMISSIONS, route), route);
  }
  const pages = {
    "overview/page.tsx": "overview.view",
    "users/page.tsx": "people.view",
    "support/page.tsx": "support.view",
    "notifications/page.tsx": "notifications.send",
    "security/page.tsx": "security.view",
    "settings/page.tsx": "settings.view",
    "access-control/page.tsx": "access.view",
  };
  for (const [file, permission] of Object.entries(pages)) {
    const source = await readFile(new URL(`../src/app/(control)/${file}`, import.meta.url), "utf8");
    assert.ok(source.includes(`requireAdmin("${permission}")`), `${file} checks ${permission}`);
  }
  const actions = await readFile(new URL("../src/app/(control)/settings/actions.ts", import.meta.url), "utf8");
  assert.match(actions, /requireAdmin\("settings\.manage"\)/);
  const users = await readFile(new URL("../src/app/(control)/users/actions.ts", import.meta.url), "utf8");
  assert.match(users, /export async function suspendSelected\(formData: FormData\) \{\n  const actor = await requireAdmin\("people\.suspend"\);/);
  assert.match(users, /if \(formData\.get\("confirm"\) !== "yes"\)/);
  assert.match(users, /ids\.length > BULK_SUSPEND_MAX/);
  assert.match(users, /export async function searchUsers\(formData: FormData\) \{\n  const actor = await requireAdmin\("people\.view"\);/);
  // The search form posts (a GET form would put emails and phone numbers in the URL, so in request logs).
  const usersPage = await readFile(new URL("../src/app/(control)/users/page.tsx", import.meta.url), "utf8");
  assert.match(usersPage, /<form action=\{searchUsers\}[^>]*role="search"/);
  assert.doesNotMatch(usersPage, /action="\/users"/);
});

test("the console never paints inline styles (the CSP blocks them) and keeps raw colours in the theme file", async () => {
  const { readdir } = await import("node:fs/promises");
  const root = new URL("../src/", import.meta.url);
  for (const name of await readdir(root, { recursive: true })) {
    if (!/\.(tsx|css)$/.test(name) || name.endsWith("globals.css")) continue;
    const source = await readFile(new URL(name, root), "utf8");
    if (name.endsWith(".tsx")) assert.doesNotMatch(source, /\sstyle=\{/, `${name} uses an inline style`);
    if (/^components\/(console|theme|settings|notifications|users|security|support)\//.test(name) || name.startsWith("app/login/") || name === "components/admin-shell.module.css") {
      assert.doesNotMatch(source.replace(/\/\*[\s\S]*?\*\//g, ""), /#[0-9a-fA-F]{3,8}\b|rgba?\(/, `${name} has a raw colour`);
    }
  }
});

test("links in lists and filter tabs are 44 px targets, and small coral text on the dark stage passes AA", async () => {
  const css = await readFile(new URL("../src/app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.row-link \{[^}]*min-height: 44px;/);
  assert.match(css, /\.filter-tabs a \{[^}]*min-height: 44px;/);
  const content = await readFile(new URL("../src/components/content/content.module.css", import.meta.url), "utf8");
  assert.match(content, /\.rowLink \{[^}]*min-height: 44px;/, "Workouts and Nutrition list links");
  // Light, dark and system dark each declare --stage and --coral-on-stage; 9 px text needs 4.5:1 against the stage.
  const luminance = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const stages = [...css.matchAll(/--stage: (#[0-9a-f]{6});/g)].map((match) => match[1]);
  const corals = [...css.matchAll(/--coral-on-stage: (#[0-9a-f]{6});/g)].map((match) => match[1]);
  assert.equal(stages.length, 3);
  assert.equal(corals.length, 3);
  stages.forEach((stage, index) => {
    const [light, dark] = [luminance(stage), luminance(corals[index])].sort((a, b) => b - a);
    assert.ok((light + 0.05) / (dark + 0.05) >= 4.5, `${corals[index]} on ${stage}`);
  });
  const shell = await readFile(new URL("../src/components/admin-shell.module.css", import.meta.url), "utf8");
  assert.match(shell, /\.brandWord small \{\n  color: var\(--coral-on-stage\);/);
  const login = await readFile(new URL("../src/app/login/login.module.css", import.meta.url), "utf8");
  assert.match(login, /\.stageBrand em \{ color: var\(--coral-on-stage\); \}/);
});
