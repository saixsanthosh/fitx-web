import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { importTypeScriptModule } from "./helpers/typescript-module.mjs";

const { ADMIN_ROLES, PERMISSIONS, ROLE_PERMISSIONS, LEGACY_ROLES, PAGE_PERMISSIONS, allowedPages, can, isAdminRole, isConsolePath } =
  await importTypeScriptModule("src/lib/roles.ts");

const migrations = new URL("../../supabase/migrations/", import.meta.url);
const legacyRolesSql = await readFile(new URL("20261118180001_fitx_admin_roles.sql", migrations), "utf8");
// fitx_admin_role_permissions as the newest migration that defines it leaves it.
const definers = [];
for (const name of (await readdir(migrations)).filter((file) => file.endsWith(".sql")).sort()) {
  const sql = await readFile(new URL(name, migrations), "utf8");
  if (/create or replace function public\.fitx_admin_role_permissions\(/.test(sql)) definers.push({ name, sql });
}
const rolesSql = definers.at(-1).sql;
const v2Sql = await readFile(new URL("20261121100030_fitx_admin_v2.sql", migrations), "utf8");

/** Reads `when '<role>' then array[...]` from fitx_admin_role_permissions. */
function sqlRolePermissions() {
  const table = {};
  for (const match of rolesSql.matchAll(/when '([a-z_]+)' then array\[([^\]]*)\]::text\[\]/g)) {
    table[match[1]] = [...match[2].matchAll(/'([a-z.]+)'/g)].map((entry) => entry[1]);
  }
  return table;
}

test("the TypeScript role table matches fitx_admin_role_permissions in the newest migration (20261121100030)", () => {
  assert.equal(definers.at(-1).name, "20261121100030_fitx_admin_v2.sql");
  const sql = sqlRolePermissions();
  assert.deepEqual(Object.keys(sql).sort(), [...ADMIN_ROLES].sort());
  for (const role of ADMIN_ROLES) {
    assert.deepEqual([...sql[role]].sort(), [...ROLE_PERMISSIONS[role]].sort(), role);
  }
});

test("the role checks accept exactly the five roles, for members and for operators", () => {
  const listed = (sql, pattern) => [...(sql.match(pattern)?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((entry) => entry[1]).sort();
  assert.deepEqual(listed(legacyRolesSql, /check \(role in \(([^)]*)\)\)/), [...ADMIN_ROLES].sort());
  assert.deepEqual(listed(legacyRolesSql, /p_role not in \(([^)]*)\)/), [...ADMIN_ROLES].sort());
  assert.deepEqual(listed(v2Sql, /role text not null check \(role in \(([^)]*)\)\)/), [...ADMIN_ROLES].sort());
  assert.deepEqual(listed(v2Sql, /p_role not in \(([^)]*)\)/), [...ADMIN_ROLES].sort());
  assert.deepEqual(listed(v2Sql, /next_role not in \(([^)]*)\)/), [...ADMIN_ROLES].sort());
});

test("operator permission checks use the same role table", () => {
  const opCan = v2Sql.slice(v2Sql.indexOf("create or replace function public.fitx_admin_op_can("));
  assert.match(opCan.slice(0, 600), /o\.is_active\s+and p_permission = any \(public\.fitx_admin_role_permissions\(o\.role\)\)/);
});

test("the new permissions are granted as the contract says", () => {
  assert.equal(PERMISSIONS.length, 21);
  for (const permission of ["nutrition.manage", "billing.manage", "notifications.send", "settings.manage", "security.view"]) assert.ok(PERMISSIONS.includes(permission), permission);
  const adminLacks = PERMISSIONS.filter((permission) => !can("admin", permission)).sort();
  assert.deepEqual(adminLacks, ["access.manage", "audit.export", "billing.manage", "people.delete", "settings.manage"]);
  assert.deepEqual([...ROLE_PERMISSIONS.content_editor].sort(), ["announcements.manage", "content.manage", "notifications.send", "nutrition.manage", "overview.view"]);
  assert.deepEqual([...ROLE_PERMISSIONS.support_agent].sort(), ["overview.view", "people.support", "people.view", "support.reply", "support.view"]);
  assert.deepEqual([...ROLE_PERMISSIONS.viewer].sort(), ["overview.view", "reports.view"]);
  assert.equal(PAGE_PERMISSIONS["/nutrition"], "nutrition.manage");
  assert.equal(PAGE_PERMISSIONS["/notifications"], "notifications.send");
  assert.equal(PAGE_PERMISSIONS["/security"], "security.view");
  assert.equal(PAGE_PERMISSIONS["/training"], "content.manage");
  assert.equal(Object.hasOwn(PAGE_PERMISSIONS, "/account"), false, "/account needs only a session");
  assert.equal(isConsolePath("/audit"), true);
  assert.equal(isConsolePath("https://evil.example"), false);
  assert.equal(isConsolePath("/account"), false);
});

test("super-admins hold every permission and every permission belongs to some role", () => {
  assert.deepEqual([...ROLE_PERMISSIONS.super_admin].sort(), [...PERMISSIONS].sort());
  for (const permission of PERMISSIONS) {
    assert.ok(ADMIN_ROLES.some((role) => can(role, permission)), permission);
  }
});

test("the most sensitive permissions stay with super-admins", () => {
  for (const permission of ["people.delete", "audit.export", "access.manage", "settings.manage", "billing.manage"]) {
    assert.deepEqual(ADMIN_ROLES.filter((role) => can(role, permission)), ["super_admin"], permission);
  }
  assert.equal(can("viewer", "people.view"), false);
  assert.equal(can("content_editor", "people.view"), false);
  assert.equal(can("support_agent", "people.suspend"), false);
  assert.equal(can("support_agent", "support.reply"), true);
});

test("navigation shows only the pages a role may open", () => {
  assert.deepEqual(allowedPages("viewer"), ["/overview", "/reports"]);
  assert.deepEqual(allowedPages("content_editor"), ["/overview", "/training", "/nutrition", "/announcements", "/notifications"]);
  assert.deepEqual(allowedPages("support_agent"), ["/overview", "/users", "/support"]);
  assert.equal(allowedPages("super_admin").length, Object.keys(PAGE_PERMISSIONS).length);
});

test("role names are validated and the legacy roles are a subset", () => {
  assert.equal(isAdminRole("support_agent"), true);
  assert.equal(isAdminRole("owner"), false);
  assert.equal(isAdminRole(null), false);
  assert.ok(LEGACY_ROLES.every((role) => ADMIN_ROLES.includes(role)));
});
