// Admin roles and what each may do. No imports, so tests can load this file directly.
// The same table lives in supabase/migrations/20261121100030_fitx_admin_v2.sql
// (fitx_admin_role_permissions, used by fitx_admin_op_can); admin/tests/roles.test.mjs fails if the two drift apart.
// Frozen after the admin-a stream: other streams import it.

export const ADMIN_ROLES = ["super_admin", "admin", "support_agent", "content_editor", "viewer"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

/** Roles that exist before migration 20261118180001 is applied. */
export const LEGACY_ROLES: readonly AdminRole[] = ["super_admin", "admin"];

export const PERMISSIONS = [
  "overview.view",
  "reports.view",
  "people.view",
  "people.support",
  "people.suspend",
  "people.delete",
  "support.view",
  "support.reply",
  "content.manage",
  "announcements.manage",
  "audit.view",
  "audit.export",
  "access.view",
  "access.manage",
  "settings.view",
  "billing.view",
  "nutrition.manage",
  "billing.manage",
  "notifications.send",
  "settings.manage",
  "security.view",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<AdminRole, readonly Permission[]> = {
  super_admin: [...PERMISSIONS],
  admin: [
    "overview.view", "reports.view", "people.view", "people.support", "people.suspend", "support.view",
    "support.reply", "content.manage", "announcements.manage", "audit.view", "access.view", "settings.view",
    "billing.view", "nutrition.manage", "notifications.send", "security.view",
  ],
  support_agent: ["overview.view", "people.view", "people.support", "support.view", "support.reply"],
  content_editor: ["overview.view", "content.manage", "announcements.manage", "nutrition.manage", "notifications.send"],
  viewer: ["overview.view", "reports.view"],
};

export const ROLE_LABELS: Record<AdminRole, string> = {
  super_admin: "Super-admin",
  admin: "Admin",
  support_agent: "Support agent",
  content_editor: "Content editor",
  viewer: "Viewer",
};

export const ROLE_DESCRIPTIONS: Record<AdminRole, string> = {
  super_admin: "Everything, including operators, account deletion, settings, billing changes and audit export.",
  admin: "Day-to-day operations: users, support, workouts, nutrition, notifications, reports, security and the audit log.",
  support_agent: "User lookup, password resets, signing people out, and the support queue.",
  content_editor: "Workouts, nutrition, announcements and notifications.",
  viewer: "Overview and reports only. Read-only.",
};

export function isAdminRole(role: unknown): role is AdminRole {
  return typeof role === "string" && (ADMIN_ROLES as readonly string[]).includes(role);
}

export function can(role: AdminRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function permissionsFor(role: AdminRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

/** Where each console page sits, and the permission it needs. The navigation shows only allowed pages. */
export const PAGE_PERMISSIONS = {
  "/overview": "overview.view",
  "/users": "people.view",
  "/support": "support.view",
  "/training": "content.manage",
  "/nutrition": "nutrition.manage",
  "/announcements": "announcements.manage",
  "/billing": "billing.view",
  "/reports": "reports.view",
  "/access-control": "access.view",
  "/audit": "audit.view",
  "/settings": "settings.view",
  "/notifications": "notifications.send",
  "/security": "security.view",
} as const satisfies Record<string, Permission>;

export type ConsolePath = keyof typeof PAGE_PERMISSIONS;

export function allowedPages(role: AdminRole): ConsolePath[] {
  return (Object.keys(PAGE_PERMISSIONS) as ConsolePath[]).filter((path) => can(role, PAGE_PERMISSIONS[path]));
}

/** True for a console page path (the sign-in form's `next` must be one). */
export function isConsolePath(value: unknown): value is ConsolePath {
  return typeof value === "string" && Object.hasOwn(PAGE_PERMISSIONS, value);
}
