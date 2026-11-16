import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { importTypeScriptModule } from "./helpers/typescript-module.mjs";

const { ADMIN_ROLES, PERMISSIONS, ROLE_PERMISSIONS, LEGACY_ROLES, PAGE_PERMISSIONS, allowedPages, can, isAdminRole } =
  await importTypeScriptModule("src/lib/roles.ts");

const rolesSql = await readFile(new URL("../../supabase/migrations/20261118180001_fitx_admin_roles.sql", import.meta.url), "utf8");

/** Reads `when '<role>' then array[...]` from fitx_admin_role_permissions. */
function sqlRolePermissions() {
  const table = {};
  for (const match of rolesSql.matchAll(/when '([a-z_]+)' then array\[([^\]]*)\]::text\[\]/g)) {
    table[match[1]] = [...match[2].matchAll(/'([a-z.]+)'/g)].map((entry) => entry[1]);
  }
  return table;
}

test("the TypeScript role table matches fitx_admin_role_permissions in the migration", () => {
  const sql = sqlRolePermissions();
  assert.deepEqual(Object.keys(sql).sort(), [...ADMIN_ROLES].sort());
  for (const role of ADMIN_ROLES) {
    assert.deepEqual([...sql[role]].sort(), [...ROLE_PERMISSIONS[role]].sort(), role);
  }
});

test("the role check constraint and set_member accept exactly the five roles", () => {
  const listed = (pattern) => [...(rolesSql.match(pattern)?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((entry) => entry[1]).sort();
  assert.deepEqual(listed(/check \(role in \(([^)]*)\)\)/), [...ADMIN_ROLES].sort());
  assert.deepEqual(listed(/p_role not in \(([^)]*)\)/), [...ADMIN_ROLES].sort());
});

test("super-admins hold every permission and every permission belongs to some role", () => {
  assert.deepEqual([...ROLE_PERMISSIONS.super_admin].sort(), [...PERMISSIONS].sort());
  for (const permission of PERMISSIONS) {
    assert.ok(ADMIN_ROLES.some((role) => can(role, permission)), permission);
  }
});

test("the most sensitive permissions stay with super-admins", () => {
  for (const permission of ["people.delete", "audit.export", "access.manage"]) {
    assert.deepEqual(ADMIN_ROLES.filter((role) => can(role, permission)), ["super_admin"], permission);
  }
  assert.equal(can("viewer", "people.view"), false);
  assert.equal(can("content_editor", "people.view"), false);
  assert.equal(can("support_agent", "people.suspend"), false);
  assert.equal(can("support_agent", "support.reply"), true);
});

test("navigation shows only the pages a role may open", () => {
  assert.deepEqual(allowedPages("viewer"), ["/overview", "/reports"]);
  assert.deepEqual(allowedPages("content_editor"), ["/overview", "/training", "/nutrition", "/announcements"]);
  assert.deepEqual(allowedPages("support_agent"), ["/overview", "/users", "/support"]);
  assert.equal(allowedPages("super_admin").length, Object.keys(PAGE_PERMISSIONS).length);
});

test("role names are validated and the legacy roles are a subset", () => {
  assert.equal(isAdminRole("support_agent"), true);
  assert.equal(isAdminRole("owner"), false);
  assert.equal(isAdminRole(null), false);
  assert.ok(LEGACY_ROLES.every((role) => ADMIN_ROLES.includes(role)));
});
