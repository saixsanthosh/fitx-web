import "server-only";
import { requireAdmin } from "@/lib/admin-auth";
import type { AuditFilters } from "@/lib/audit-catalog";
import { emailsFor } from "@/lib/data/members";
import { isUuid } from "@/lib/data/people";
import { logServerError } from "@/lib/log";
import { isMissingFunction, isMissingTable } from "@/lib/schema";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { istDateToIso } from "@/lib/time";
import { normaliseUsername } from "@/lib/username";

export const AUDIT_PAGE_SIZE = 50;
export const AUDIT_EXPORT_LIMIT = 5000;

export type AuditRow = {
  id: number;
  /** A member account (the old Google Admin). */
  actorId: string | null;
  /** An operator. */
  actorOperatorId: string | null;
  /** The operator's username as written, else the member account's email. */
  actorLabel: string | null;
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

type ActorFilter = { column: "actor_id" | "actor_operator_id" | "actor_username"; value: string } | { column: "id_either"; value: string } | null;

const NOBODY = "00000000-0000-0000-0000-000000000000";

/** Resolves the actor filter: an operator username, an account email (old Google rows) or an ID. */
async function resolveActor(admin: AdminClient, actor: string): Promise<{ filter: ActorFilter; note: string | null }> {
  if (!actor) return { filter: null, note: null };
  if (isUuid(`${actor}`)) return { filter: { column: "id_either", value: actor.toLowerCase() }, note: null };
  if (actor.includes("@")) {
    const { data, error } = await admin.rpc("fitx_admin_find_user_by_email", { p_email: actor.trim() });
    if (error) {
      if (!isMissingFunction(error)) logServerError("data.audit_actor", error);
      return { filter: { column: "actor_id", value: NOBODY }, note: "That email could not be looked up. Use the account ID instead." };
    }
    const match = (Array.isArray(data) ? data : [])[0] as { user_id?: string } | undefined;
    return match?.user_id
      ? { filter: { column: "actor_id", value: match.user_id }, note: null }
      : { filter: { column: "actor_id", value: NOBODY }, note: "No FITX account uses that email." };
  }
  const username = normaliseUsername(actor);
  if (!username) return { filter: { column: "actor_id", value: NOBODY }, note: "Enter an operator username, an email or an ID for the actor." };
  return { filter: { column: "actor_username", value: username }, note: null };
}

/** Audit rows matching the filters; the caller adds ordering and paging. */
function filteredAudit(admin: AdminClient, filters: AuditFilters, actor: ActorFilter, withCount: boolean) {
  let query = admin
    .from("fitx_admin_audit_logs")
    .select("id,actor_id,actor_operator_id,actor_username,action,resource_type,resource_id,details,created_at", withCount ? { count: "exact" } : {});
  if (filters.action) query = query.eq("action", filters.action);
  if (actor?.column === "id_either") query = query.or(`actor_id.eq.${actor.value},actor_operator_id.eq.${actor.value}`);
  else if (actor) query = query.eq(actor.column, actor.value);
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
    const username = typeof row.actor_username === "string" ? row.actor_username : null;
    return {
      id: Number(row.id),
      actorId,
      actorOperatorId: typeof row.actor_operator_id === "string" ? row.actor_operator_id : null,
      actorLabel: username ?? (actorId ? (emails.get(actorId) ?? null) : null),
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
  const { data, error, count } = await filteredAudit(admin, filters, actor.filter, true)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + AUDIT_PAGE_SIZE - 1);
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

/** Up to AUDIT_EXPORT_LIMIT rows matching the filters, newest first (by ID), for the CSV export. */
export async function exportAuditEvents(filters: AuditFilters): Promise<{ state: "ready"; rows: AuditRow[]; total: number } | { state: "service_key_missing" | "migration_pending" | "query_failed" }> {
  await requireAdmin("audit.export");
  const admin = createAdminSupabase();
  if (!admin) return { state: "service_key_missing" };

  const failed = (error: { code?: string; message?: string }) => {
    if (isMissingTable(error)) return { state: "migration_pending" } as const;
    logServerError("data.audit_export", error);
    return { state: "query_failed" } as const;
  };
  // The export covers the log up to its newest row when the export starts. PostgREST returns at
  // most 1,000 rows per request, so each page continues below the last ID read: rows written while
  // the export runs can neither repeat rows nor push them out, as page offsets would.
  const newest = await admin.from("fitx_admin_audit_logs").select("id").order("id", { ascending: false }).limit(1);
  if (newest.error) return failed(newest.error);
  const actor = await resolveActor(admin, filters.actor);
  const collected: Record<string, unknown>[] = [];
  let total = 0;
  let below = newest.data?.length ? Number(newest.data[0].id) + 1 : 0;
  for (let page = 0; below > 0 && collected.length < AUDIT_EXPORT_LIMIT; page += 1) {
    const size = Math.min(1000, AUDIT_EXPORT_LIMIT - collected.length);
    const { data, error, count } = await filteredAudit(admin, filters, actor.filter, page === 0)
      .lt("id", below)
      .order("id", { ascending: false })
      .limit(size);
    if (error) return failed(error);
    const rows = data ?? [];
    if (page === 0) total = count ?? rows.length;
    collected.push(...rows);
    if (rows.length < size) break;
    below = Number(rows[rows.length - 1].id);
  }
  const emails = await emailsFor(collected.map((row) => row.actor_id as string | null));
  return { state: "ready", rows: toRows(collected, emails), total };
}

export type RecentAuditResult = { state: "ready"; rows: AuditRow[] } | { state: "service_key_missing" | "migration_pending" | "query_failed" };

/**
 * The newest audit rows, optionally only some actions: recent admin activity on the Dashboard (audit.view)
 * and the Admin sign-in history on Security (security.view).
 */
export async function recentAuditEvents({ limit, actions, permission }: { limit: number; actions?: readonly string[]; permission: "audit.view" | "security.view" }): Promise<RecentAuditResult> {
  await requireAdmin(permission);
  const admin = createAdminSupabase();
  if (!admin) return { state: "service_key_missing" };
  let query = admin
    .from("fitx_admin_audit_logs")
    .select("id,actor_id,actor_operator_id,actor_username,action,resource_type,resource_id,details,created_at")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(Math.min(Math.max(Math.trunc(limit) || 1, 1), 100));
  if (actions?.length) query = query.in("action", [...actions]);
  const { data, error } = await query;
  if (error) {
    if (isMissingTable(error)) return { state: "migration_pending" };
    logServerError("data.audit_recent", error);
    return { state: "query_failed" };
  }
  const rows = data ?? [];
  const emails = await emailsFor(rows.map((row) => row.actor_id as string | null));
  return { state: "ready", rows: toRows(rows, emails) };
}
