import "server-only";
import { requireAdmin } from "@/lib/admin-auth";
import { parseAllowlist } from "@/lib/admin-email";
import { logServerError } from "@/lib/log";
import { can, isAdminRole, type AdminRole } from "@/lib/roles";
import { isMissingFunction, isMissingTable } from "@/lib/schema";
import { createAdminSupabase } from "@/lib/supabase/admin";

export type MemberRow = {
  userId: string;
  email: string | null;
  role: AdminRole;
  isActive: boolean;
  createdAt: string;
  lastSignInAt: string | null;
  /** The email is on FITX_ADMIN_ALLOWED_EMAILS; without it the member cannot sign in. */
  onAllowlist: boolean;
  /** The account has a verified authenticator app; null when Auth could not be read. */
  hasAuthenticator: boolean | null;
};

export type MembersResult =
  | { state: "ready"; members: MemberRow[]; rolesMigrationApplied: boolean }
  | { state: "service_key_missing" | "migration_pending" | "query_failed" };

const MAX_MEMBERS = 50;

/** Admin members with email, sign-in, allowlist and authenticator status. */
export async function listMembers(): Promise<MembersResult> {
  await requireAdmin("access.view");
  const admin = createAdminSupabase();
  if (!admin) return { state: "service_key_missing" };

  let rows: Array<{ user_id: string; email: string | null; role: unknown; is_active: boolean; created_at: string; last_sign_in_at: string | null }>;
  let rolesMigrationApplied = true;
  const listed = await admin.rpc("fitx_admin_list_members");
  if (!listed.error) {
    rows = (Array.isArray(listed.data) ? listed.data : []) as typeof rows;
  } else if (isMissingFunction(listed.error)) {
    rolesMigrationApplied = false;
    const fallback = await admin
      .from("fitx_admin_members")
      .select("user_id,role,is_active,created_at")
      .order("created_at", { ascending: false })
      .limit(MAX_MEMBERS);
    if (fallback.error) {
      if (isMissingTable(fallback.error)) return { state: "migration_pending" };
      logServerError("data.list_members", fallback.error);
      return { state: "query_failed" };
    }
    rows = (fallback.data ?? []).map((row) => ({ ...row, email: null, last_sign_in_at: null }));
  } else {
    logServerError("data.list_members", listed.error);
    return { state: "query_failed" };
  }

  const allowlist = parseAllowlist(process.env.FITX_ADMIN_ALLOWED_EMAILS);
  const members = await Promise.all(
    rows.slice(0, MAX_MEMBERS).filter((row) => isAdminRole(row.role)).map(async (row): Promise<MemberRow> => {
      const account = await admin.auth.admin.getUserById(row.user_id);
      const user = account.data.user;
      if (account.error) logServerError("data.member_account", account.error);
      const email = row.email ?? user?.email ?? null;
      return {
        userId: row.user_id,
        email,
        role: row.role as AdminRole,
        isActive: Boolean(row.is_active),
        createdAt: row.created_at,
        lastSignInAt: row.last_sign_in_at ?? user?.last_sign_in_at ?? null,
        onAllowlist: email ? allowlist.has(email.toLowerCase()) : false,
        hasAuthenticator: user ? (user.factors ?? []).some((factor) => factor.status === "verified") : null,
      };
    }),
  );
  return { state: "ready", members, rolesMigrationApplied };
}

/** Active members who may work on support requests, for the assignee list. */
export async function listSupportAssignees(): Promise<Array<{ userId: string; email: string | null }>> {
  await requireAdmin("support.view");
  const admin = createAdminSupabase();
  if (!admin) return [];
  const { data, error } = await admin.rpc("fitx_admin_list_members");
  if (error) {
    if (!isMissingFunction(error)) logServerError("data.support_assignees", error);
    return [];
  }
  return ((Array.isArray(data) ? data : []) as Array<{ user_id: string; email: string | null; role: unknown; is_active: boolean }>)
    .filter((row) => row.is_active && isAdminRole(row.role) && can(row.role, "support.view"))
    .map((row) => ({ userId: row.user_id, email: row.email }));
}

/** Emails for account IDs (audit actors, requesters). Empty when the roles migration is not applied. */
export async function emailsFor(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  await requireAdmin();
  const unique = [...new Set(ids.filter((id): id is string => typeof id === "string"))].slice(0, 500);
  const result = new Map<string, string>();
  if (!unique.length) return result;
  const admin = createAdminSupabase();
  if (!admin) return result;
  const { data, error } = await admin.rpc("fitx_admin_user_emails", { p_user_ids: unique });
  if (error) {
    if (!isMissingFunction(error)) logServerError("data.user_emails", error);
    return result;
  }
  for (const row of (Array.isArray(data) ? data : []) as Array<{ user_id: string; email: string | null }>) {
    if (row.email) result.set(row.user_id, row.email);
  }
  return result;
}
