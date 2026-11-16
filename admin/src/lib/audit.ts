import "server-only";
import type { AuditAction, AuditResourceType } from "@/lib/audit-catalog";
import { logServerError, logServerWarning } from "@/lib/log";
import { isMissingFunction, MIGRATIONS } from "@/lib/schema";
import { createAdminSupabase } from "@/lib/supabase/admin";

export type AuditWrite = { ok: true } | { ok: false; reason: "migration_pending" | "not_configured" | "failed" };

/**
 * Writes one row to the append-only audit log through fitx_admin_log_event. Details hold codes,
 * counts, statuses and reasons typed by an admin; never message text, passwords or tokens.
 */
export async function logAdminEvent(event: {
  actorId: string | null;
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId?: string | null;
  details?: Record<string, unknown>;
}): Promise<AuditWrite> {
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, reason: "not_configured" };

  const { error } = await admin.rpc("fitx_admin_log_event", {
    p_actor_id: event.actorId,
    p_action: event.action,
    p_resource_type: event.resourceType,
    p_resource_id: event.resourceId ?? null,
    p_details: event.details ?? {},
  });
  if (!error) return { ok: true };
  if (isMissingFunction(error)) {
    logServerWarning("audit.log_event", `${event.action} was not recorded: apply migration ${MIGRATIONS.audit}`);
    return { ok: false, reason: "migration_pending" };
  }
  logServerError("audit.log_event", error);
  return { ok: false, reason: "failed" };
}
