// Every action the Admin audit log records, with the words the Audit screen shows. No imports.
// Actions written inside database functions are marked "database"; the rest go through
// fitx_admin_log_event from the Admin server.

export const AUDIT_ACTIONS = {
  admin_sign_in: { label: "Signed in to Admin", group: "Sign-in", source: "server" },
  admin_sign_in_denied: { label: "Admin sign-in refused", group: "Sign-in", source: "server" },
  admin_signed_out: { label: "Signed out of Admin", group: "Sign-in", source: "server" },
  admin_session_expired: { label: "Admin session expired", group: "Sign-in", source: "server" },
  admin_mfa_enrolled: { label: "Authenticator app set up", group: "Sign-in", source: "server" },
  admin_mfa_verified: { label: "Authenticator code accepted", group: "Sign-in", source: "server" },
  admin_mfa_failed: { label: "Authenticator code refused", group: "Sign-in", source: "server" },
  admin_mfa_reset_requested: { label: "Authenticator reset requested", group: "Access", source: "server" },
  admin_mfa_reset: { label: "Authenticator app reset", group: "Access", source: "server" },
  admin_member_updated: { label: "Admin access changed", group: "Access", source: "database" },
  admin_member_bootstrapped: { label: "First super-admin set up", group: "Access", source: "database" },
  users_listed: { label: "People list viewed", group: "People", source: "server" },
  user_viewed: { label: "Account details viewed", group: "People", source: "server" },
  user_sessions_revoked: { label: "Signed out everywhere", group: "People", source: "database" },
  user_suspend_requested: { label: "Suspension requested", group: "People", source: "server" },
  user_suspended: { label: "Account suspended", group: "People", source: "server" },
  user_suspend_failed: { label: "Suspension failed", group: "People", source: "server" },
  user_unsuspend_requested: { label: "Unsuspension requested", group: "People", source: "server" },
  user_unsuspended: { label: "Account unsuspended", group: "People", source: "server" },
  user_unsuspend_failed: { label: "Unsuspension failed", group: "People", source: "server" },
  user_password_reset_requested: { label: "Password reset requested", group: "People", source: "server" },
  user_password_reset_sent: { label: "Password reset email sent", group: "People", source: "server" },
  user_password_reset_failed: { label: "Password reset failed", group: "People", source: "server" },
  user_delete_requested: { label: "Account deletion requested", group: "People", source: "server" },
  user_deleted: { label: "Account deleted", group: "People", source: "server" },
  user_delete_failed: { label: "Account deletion failed", group: "People", source: "server" },
  support_request_updated: { label: "Help request updated", group: "Support", source: "database" },
  support_reply_sent: { label: "Help reply sent", group: "Support", source: "database" },
  announcement_created: { label: "Announcement created", group: "Announcements", source: "database" },
  announcement_updated: { label: "Announcement edited", group: "Announcements", source: "database" },
  announcement_published: { label: "Announcement published", group: "Announcements", source: "database" },
  announcement_unpublished: { label: "Announcement back to draft", group: "Announcements", source: "database" },
  announcement_archived: { label: "Announcement archived", group: "Announcements", source: "database" },
  exercise_visibility_updated: { label: "Exercise visibility changed", group: "Content", source: "database" },
  audit_exported: { label: "Audit log exported", group: "Audit", source: "server" },
} as const;

export type AuditAction = keyof typeof AUDIT_ACTIONS;

export const AUDIT_RESOURCE_TYPES = [
  "admin_session",
  "admin_member",
  "user",
  "support_request",
  "announcement",
  "exercise",
  "audit_log",
] as const;
export type AuditResourceType = (typeof AUDIT_RESOURCE_TYPES)[number];

export function isAuditAction(value: unknown): value is AuditAction {
  return typeof value === "string" && Object.hasOwn(AUDIT_ACTIONS, value);
}

export function auditActionLabel(action: string): string {
  return isAuditAction(action) ? AUDIT_ACTIONS[action].label : action.replaceAll("_", " ");
}

export type AuditFilters = {
  action: AuditAction | null;
  /** An account email or ID. */
  actor: string;
  resourceType: AuditResourceType | null;
  resourceId: string;
  /** IST calendar days, "YYYY-MM-DD"; both ends included. */
  from: string;
  to: string;
  page: number;
};

type SearchParams = Record<string, string | string[] | undefined>;

function firstValue(params: SearchParams, key: string): string {
  const value = params[key];
  return typeof value === "string" ? value : Array.isArray(value) ? (value[0] ?? "") : "";
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function parseAuditFilters(params: SearchParams): AuditFilters {
  const action = firstValue(params, "action");
  const resourceType = firstValue(params, "resource");
  const from = firstValue(params, "from");
  const to = firstValue(params, "to");
  const page = Number(firstValue(params, "page") || "1");
  return {
    action: isAuditAction(action) ? action : null,
    actor: firstValue(params, "actor").trim().slice(0, 254),
    resourceType: (AUDIT_RESOURCE_TYPES as readonly string[]).includes(resourceType) ? (resourceType as AuditResourceType) : null,
    resourceId: firstValue(params, "resource_id").trim().slice(0, 200),
    from: DAY.test(from) ? from : "",
    to: DAY.test(to) ? to : "",
    page: Number.isInteger(page) && page >= 1 && page <= 10000 ? page : 1,
  };
}

/** The filters as a query string for links (paging, export). Empty values are left out. */
export function auditFilterQuery(filters: AuditFilters, overrides: Partial<AuditFilters> = {}): string {
  const merged = { ...filters, ...overrides };
  const query = new URLSearchParams();
  if (merged.action) query.set("action", merged.action);
  if (merged.actor) query.set("actor", merged.actor);
  if (merged.resourceType) query.set("resource", merged.resourceType);
  if (merged.resourceId) query.set("resource_id", merged.resourceId);
  if (merged.from) query.set("from", merged.from);
  if (merged.to) query.set("to", merged.to);
  if (merged.page > 1) query.set("page", String(merged.page));
  const text = query.toString();
  return text ? `?${text}` : "";
}

/** A short, readable summary of an audit row's details: "status: open → resolved", "reason: …". */
export function summariseAuditDetails(details: unknown): string {
  if (!details || typeof details !== "object" || Array.isArray(details)) return "";
  const record = details as Record<string, unknown>;
  const show = (value: unknown) => (value === null || value === undefined || value === "" ? "—" : typeof value === "object" ? JSON.stringify(value) : String(value));
  const parts: string[] = [];
  const before = record.before && typeof record.before === "object" ? (record.before as Record<string, unknown>) : null;
  const after = record.after && typeof record.after === "object" ? (record.after as Record<string, unknown>) : null;
  if (after) {
    for (const key of Object.keys(after)) {
      const from = before ? show(before[key]) : "—";
      const to = show(after[key]);
      if (!before || from !== to) parts.push(`${key.replaceAll("_", " ")}: ${before ? `${from} → ` : ""}${to}`);
    }
  }
  for (const [key, value] of Object.entries(record)) {
    if (key === "before" || key === "after") continue;
    parts.push(`${key.replaceAll("_", " ")}: ${show(value)}`);
  }
  return parts.join(" · ").slice(0, 300);
}
