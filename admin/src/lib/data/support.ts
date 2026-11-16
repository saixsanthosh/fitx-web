import "server-only";
import { requireAdmin } from "@/lib/admin-auth";
import { emailsFor, listSupportAssignees } from "@/lib/data/members";
import { isUuid } from "@/lib/data/people";
import { logServerError } from "@/lib/log";
import { isMissingFunction, isMissingTable } from "@/lib/schema";
import { createAdminSupabase } from "@/lib/supabase/admin";
import {
  SUPPORT_CATEGORIES,
  SUPPORT_STATUSES,
  type SupportCategory,
  type SupportPriority,
  type SupportStatus,
} from "@/lib/support-catalog";

export const SUPPORT_PAGE_SIZE = 25;

export type SupportFilters = { status: SupportStatus | "active" | "all"; category: SupportCategory | null; mine: boolean; page: number };

export type SupportListRow = {
  id: string;
  subject: string;
  category: SupportCategory;
  status: SupportStatus;
  priority: SupportPriority;
  requesterEmail: string | null;
  requesterId: string;
  assigneeEmail: string | null;
  createdAt: string;
  lastMessageAt: string;
};

export type SupportListResult =
  | { state: "ready"; rows: SupportListRow[]; counts: Record<string, number>; total: number; hasNext: boolean; filters: SupportFilters }
  | { state: "service_key_missing" | "migration_pending" | "query_failed" };

type SearchParams = Record<string, string | string[] | undefined>;

export function parseSupportFilters(params: SearchParams): SupportFilters {
  const first = (key: string) => {
    const value = params[key];
    return typeof value === "string" ? value : Array.isArray(value) ? (value[0] ?? "") : "";
  };
  const status = first("status");
  const category = first("category");
  const page = Number(first("page") || "1");
  return {
    status: status === "all" || (SUPPORT_STATUSES as readonly string[]).includes(status) ? (status as SupportFilters["status"]) : "active",
    category: (SUPPORT_CATEGORIES as readonly string[]).includes(category) ? (category as SupportCategory) : null,
    mine: first("mine") === "1",
    page: Number.isInteger(page) && page >= 1 && page <= 1000 ? page : 1,
  };
}

export async function listSupportRequests(filters: SupportFilters): Promise<SupportListResult> {
  const { user } = await requireAdmin("support.view");
  const admin = createAdminSupabase();
  if (!admin) return { state: "service_key_missing" };

  const countsResult = await admin.rpc("fitx_admin_support_counts");
  if (countsResult.error) {
    if (isMissingFunction(countsResult.error)) return { state: "migration_pending" };
    logServerError("data.support_counts", countsResult.error);
    return { state: "query_failed" };
  }

  const offset = (filters.page - 1) * SUPPORT_PAGE_SIZE;
  let query = admin
    .from("support_requests")
    .select("id,user_id,category,subject,status,priority,assigned_to,created_at,last_message_at", { count: "exact" })
    .order("last_message_at", { ascending: false })
    .range(offset, offset + SUPPORT_PAGE_SIZE - 1);
  if (filters.status === "active") query = query.in("status", ["open", "in_progress", "waiting_on_user"]);
  else if (filters.status !== "all") query = query.eq("status", filters.status);
  if (filters.category) query = query.eq("category", filters.category);
  if (filters.mine) query = query.eq("assigned_to", user.id);

  const { data, error, count } = await query;
  if (error) {
    if (isMissingTable(error)) return { state: "migration_pending" };
    logServerError("data.support_requests", error);
    return { state: "query_failed" };
  }
  const rows = data ?? [];
  const emails = await emailsFor(rows.flatMap((row) => [row.user_id as string, row.assigned_to as string | null]));
  const counts: Record<string, number> = {};
  for (const [status, value] of Object.entries((countsResult.data as Record<string, unknown> | null) ?? {})) counts[status] = Number(value) || 0;
  const total = count ?? rows.length;
  return {
    state: "ready",
    rows: rows.map((row) => ({
      id: String(row.id),
      subject: String(row.subject),
      category: row.category as SupportCategory,
      status: row.status as SupportStatus,
      priority: row.priority as SupportPriority,
      requesterId: String(row.user_id),
      requesterEmail: emails.get(String(row.user_id)) ?? null,
      assigneeEmail: row.assigned_to ? (emails.get(String(row.assigned_to)) ?? null) : null,
      createdAt: String(row.created_at),
      lastMessageAt: String(row.last_message_at),
    })),
    counts,
    total,
    hasNext: offset + rows.length < total,
    filters,
  };
}

export type SupportThread = {
  id: string;
  subject: string;
  body: string;
  category: SupportCategory;
  status: SupportStatus;
  priority: SupportPriority;
  pagePath: string | null;
  requesterId: string;
  requesterEmail: string | null;
  assignedTo: string | null;
  assignedToEmail: string | null;
  createdAt: string;
  /** When the request last changed; the Details form sends it back so a stale page cannot overwrite newer changes. */
  updatedAt: string;
  messages: Array<{ id: string; authorKind: "user" | "staff"; authorEmail: string | null; body: string; createdAt: string }>;
  assignees: Array<{ userId: string; email: string | null }>;
};

export type SupportThreadResult = { state: "ready"; thread: SupportThread } | { state: "not_found" | "service_key_missing" | "migration_pending" | "query_failed" };

export async function getSupportThread(id: string): Promise<SupportThreadResult> {
  await requireAdmin("support.view");
  if (!isUuid(id)) return { state: "not_found" };
  const admin = createAdminSupabase();
  if (!admin) return { state: "service_key_missing" };

  const request = await admin
    .from("support_requests")
    .select("id,user_id,category,subject,body,status,priority,assigned_to,page_path,created_at,updated_at")
    .eq("id", id)
    .maybeSingle();
  if (request.error) {
    if (isMissingTable(request.error)) return { state: "migration_pending" };
    logServerError("data.support_thread", request.error);
    return { state: "query_failed" };
  }
  if (!request.data) return { state: "not_found" };

  const messages = await admin
    .from("support_messages")
    .select("id,author_id,author_kind,body,created_at")
    .eq("request_id", id)
    .order("created_at", { ascending: true })
    .limit(500);
  if (messages.error) {
    logServerError("data.support_messages", messages.error);
    return { state: "query_failed" };
  }
  const row = request.data;
  const emails = await emailsFor([
    row.user_id as string,
    row.assigned_to as string | null,
    ...(messages.data ?? []).map((message) => message.author_id as string | null),
  ]);
  return {
    state: "ready",
    thread: {
      id: String(row.id),
      subject: String(row.subject),
      body: String(row.body),
      category: row.category as SupportCategory,
      status: row.status as SupportStatus,
      priority: row.priority as SupportPriority,
      pagePath: typeof row.page_path === "string" ? row.page_path : null,
      requesterId: String(row.user_id),
      requesterEmail: emails.get(String(row.user_id)) ?? null,
      assignedTo: typeof row.assigned_to === "string" ? row.assigned_to : null,
      assignedToEmail: typeof row.assigned_to === "string" ? (emails.get(row.assigned_to) ?? null) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      messages: (messages.data ?? []).map((message) => ({
        id: String(message.id),
        authorKind: message.author_kind === "staff" ? "staff" : "user",
        authorEmail: message.author_id ? (emails.get(String(message.author_id)) ?? null) : null,
        body: String(message.body),
        createdAt: String(message.created_at),
      })),
      assignees: await listSupportAssignees(),
    },
  };
}
