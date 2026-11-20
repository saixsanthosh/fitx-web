import "server-only";
import { requireAdmin } from "@/lib/admin-auth";
import { logServerError } from "@/lib/log";
import { can, isAdminRole } from "@/lib/roles";
import { isMissingFunction, isMissingTable } from "@/lib/schema";
import { createAdminSupabase } from "@/lib/supabase/admin";

/** Active operators who may work on support requests, for the assignee list. */
export async function listSupportAssignees(): Promise<Array<{ operatorId: string; username: string }>> {
  await requireAdmin("support.view");
  const admin = createAdminSupabase();
  if (!admin) return [];
  const { data, error } = await admin.from("admin_operators").select("id,username,role,is_active").eq("is_active", true).order("username").limit(200);
  if (error) {
    if (!isMissingTable(error)) logServerError("data.support_assignees", error);
    return [];
  }
  return (data ?? [])
    .filter((row) => isAdminRole(row.role) && can(row.role, "support.view"))
    .map((row) => ({ operatorId: String(row.id), username: String(row.username) }));
}

/** Usernames for operator IDs (support assignees and staff replies). */
export async function usernamesFor(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  await requireAdmin();
  const unique = [...new Set(ids.filter((id): id is string => typeof id === "string"))].slice(0, 500);
  const result = new Map<string, string>();
  if (!unique.length) return result;
  const admin = createAdminSupabase();
  if (!admin) return result;
  const { data, error } = await admin.from("admin_operators").select("id,username").in("id", unique);
  if (error) {
    if (!isMissingTable(error)) logServerError("data.operator_usernames", error);
    return result;
  }
  for (const row of data ?? []) result.set(String(row.id), String(row.username));
  return result;
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
