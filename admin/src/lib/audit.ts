import "server-only";
import type { AuditAction, AuditResourceType } from "@/lib/audit-catalog";
import { logServerError, logServerWarning } from "@/lib/log";
import { isMissingFunction, MIGRATIONS } from "@/lib/schema";
import { createAdminSupabase } from "@/lib/supabase/admin";

export type AuditWrite = { ok: true } | { ok: false; reason: "migration_pending" | "not_configured" | "failed" };

/**
 * Writes one row to the append-only audit log through fitx_admin_op_log_event, which copies the
 * operator's username in. `actor` is the signed-in operator, or null (a refused sign-in). Details hold
 * codes, counts and statuses; never message text, passwords, tokens or raw IPs.
 */
export async function logAdminEvent(event: {
  actor: { id: string } | null;
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId?: string | null;
  details?: Record<string, unknown>;
}): Promise<AuditWrite> {
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, reason: "not_configured" };

  const { error } = await admin.rpc("fitx_admin_op_log_event", {
    p_operator_id: event.actor?.id ?? null,
    p_action: event.action,
    p_resource_type: event.resourceType,
    p_resource_id: event.resourceId ?? null,
    p_details: event.details ?? {},
  });
  if (!error) return { ok: true };
  if (isMissingFunction(error)) {
    logServerWarning("audit.log_event", `${event.action} was not recorded: apply migration ${MIGRATIONS.adminV2}`);
    return { ok: false, reason: "migration_pending" };
  }
  logServerError("audit.log_event", error);
  return { ok: false, reason: "failed" };
}
