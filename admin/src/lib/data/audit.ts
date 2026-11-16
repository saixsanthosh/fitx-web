import "server-only";
import { requireAdmin } from "@/lib/admin-auth";
import type { AuditFilters } from "@/lib/audit-catalog";
import { normaliseEmail } from "@/lib/admin-email";
import { emailsFor } from "@/lib/data/members";
import { isUuid } from "@/lib/data/people";
import { logServerError } from "@/lib/log";
import { isMissingFunction, isMissingTable } from "@/lib/schema";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { istDateToIso } from "@/lib/time";

export const AUDIT_PAGE_SIZE = 50;
export const AUDIT_EXPORT_LIMIT = 5000;

export type AuditRow = {
  id: number;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  details: unknown;
  createdAt: string;
};

export type AuditResult =
  | { state: "ready"; rows: AuditRow[]; total: number; page: number; hasNext: boolean; actorNote: string | null }
  | { state: "service_key_missing" | "migration_pending" | "query_failed" };

type AdminClient = NonNullable<ReturnType<typeof createAdminSupabase>>;

/** Resolves the actor filter (an email or an account ID) to an account ID. */
async function resolveActor(admin: AdminClient, actor: string): Promise<{ id: string | null; note: string | null }> {
  if (!actor) return { id: null, note: null };
  if (isUuid(actor)) return { id: actor.toLowerCase(), note: null };
  const email = normaliseEmail(actor);
  if (!email) return { id: "00000000-0000-0000-0000-000000000000", note: "Enter an account email or ID for the actor." };
  const { data, error } = await admin.rpc("fitx_admin_find_user_by_email", { p_email: email });
  if (error) {
    if (!isMissingFunction(error)) logServerError("data.audit_actor", error);
    return { id: "00000000-0000-0000-0000-000000000000", note: "Searching by actor email needs migration 20261118180001. Use the account ID instead." };
  }
  const match = (Array.isArray(data) ? data : [])[0] as { user_id?: string } | undefined;
  return match?.user_id
    ? { id: match.user_id, note: null }
    : { id: "00000000-0000-0000-0000-000000000000", note: "No FITX account uses that email." };
}

async function queryAudit(admin: AdminClient, filters: AuditFilters, offset: number, limit: number, actorId: string | null) {
  let query = admin
    .from("fitx_admin_audit_logs")
    .select("id,actor_id,action,resource_type,resource_id,details,created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + limit - 1);
  if (filters.action) query = query.eq("action", filters.action);
  if (actorId) query = query.eq("actor_id", actorId);
  if (filters.resourceType) query = query.eq("resource_type", filters.resourceType);
  if (filters.resourceId) query = query.eq("resource_id", filters.resourceId);
  const fromIso = istDateToIso(filters.from);
  const toIso = istDateToIso(filters.to, { endOfDay: true });
  if (fromIso) query = query.gte("created_at", fromIso);
  if (toIso) query = query.lt("created_at", toIso);
  return query;
}

function toRows(data: unknown[], emails: Map<string, string>): AuditRow[] {
  return (data as Array<Record<string, unknown>>).map((row) => {
    const actorId = typeof row.actor_id === "string" ? row.actor_id : null;
    return {
      id: Number(row.id),
      actorId,
      actorEmail: actorId ? (emails.get(actorId) ?? null) : null,
      action: String(row.action),
      resourceType: String(row.resource_type),
      resourceId: typeof row.resource_id === "string" ? row.resource_id : null,
      details: row.details,
      createdAt: String(row.created_at),
    };
  });
}

export async function listAuditEvents(filters: AuditFilters): Promise<AuditResult> {
  await requireAdmin("audit.view");
  const admin = createAdminSupabase();
  if (!admin) return { state: "service_key_missing" };

  const actor = await resolveActor(admin, filters.actor);
  const offset = (filters.page - 1) * AUDIT_PAGE_SIZE;
  const { data, error, count } = await queryAudit(admin, filters, offset, AUDIT_PAGE_SIZE, actor.id);
  if (error) {
    if (isMissingTable(error)) return { state: "migration_pending" };
    logServerError("data.audit_events", error);
    return { state: "query_failed" };
  }
  const rows = data ?? [];
  const emails = await emailsFor(rows.map((row) => row.actor_id as string | null));
  const total = count ?? rows.length;
  return { state: "ready", rows: toRows(rows, emails), total, page: filters.page, hasNext: offset + rows.length < total, actorNote: actor.note };
}

/** Up to AUDIT_EXPORT_LIMIT rows matching the filters, newest first, for the CSV export. */
export async function exportAuditEvents(filters: AuditFilters): Promise<{ state: "ready"; rows: AuditRow[]; total: number } | { state: "service_key_missing" | "migration_pending" | "query_failed" }> {
  await requireAdmin("audit.export");
  const admin = createAdminSupabase();
  if (!admin) return { state: "service_key_missing" };

  const actor = await resolveActor(admin, filters.actor);
  const collected: Record<string, unknown>[] = [];
  let total = 0;
  // PostgREST returns at most 1,000 rows per request, so read in pages.
  for (let offset = 0; offset < AUDIT_EXPORT_LIMIT; offset += 1000) {
    const { data, error, count } = await queryAudit(admin, filters, offset, Math.min(1000, AUDIT_EXPORT_LIMIT - offset), actor.id);
    if (error) {
      if (isMissingTable(error)) return { state: "migration_pending" };
      logServerError("data.audit_export", error);
      return { state: "query_failed" };
    }
    total = count ?? total;
    collected.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const emails = await emailsFor(collected.map((row) => row.actor_id as string | null));
  return { state: "ready", rows: toRows(collected, emails), total };
}
