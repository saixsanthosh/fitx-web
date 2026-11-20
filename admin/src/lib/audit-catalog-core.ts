// Audit actions of the Admin sign-in, people, support, announcements and audit areas. No imports.
// Owned by the admin-core stream after admin-a; audit-catalog.ts merges it with audit-catalog-content.ts.
// Actions written inside database functions are marked "database"; the rest go through
// fitx_admin_op_log_event from the Admin server. Old actions stay so older audit rows keep their words.

export type AuditActionEntry = { label: string; group: string; source: "server" | "database" };

export const CORE_AUDIT_ACTIONS = {
  admin_login_succeeded: { label: "Signed in to Admin", group: "Sign-in", source: "server" },
  admin_login_failed: { label: "Admin sign-in refused", group: "Sign-in", source: "server" },
  admin_login_locked: { label: "Username locked after failed sign-ins", group: "Sign-in", source: "server" },
  admin_login_ip_limited: { label: "Too many sign-ins from one address", group: "Sign-in", source: "server" },
  admin_session_revoked: { label: "Admin session ended", group: "Sign-in", source: "server" },
  operator_created: { label: "Operator added", group: "Access", source: "database" },
  operator_updated: { label: "Operator changed", group: "Access", source: "database" },
  operator_password_reset: { label: "Operator password reset", group: "Access", source: "database" },
  operator_password_changed: { label: "Own password changed", group: "Access", source: "database" },
  admin_sign_in: { label: "Signed in to Admin with Google", group: "Sign-in", source: "server" },
  admin_sign_in_denied: { label: "Google sign-in to Admin refused", group: "Sign-in", source: "server" },
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
  audit_exported: { label: "Audit log exported", group: "Audit", source: "server" },
} as const satisfies Record<string, AuditActionEntry>;

export const CORE_AUDIT_RESOURCE_TYPES = ["admin_session", "admin_member", "admin_operator", "user", "support_request", "announcement", "audit_log"] as const;
