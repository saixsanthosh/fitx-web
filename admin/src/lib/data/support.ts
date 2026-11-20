import "server-only";
import { requireAdmin } from "@/lib/admin-auth";
import { emailsFor, listSupportAssignees, usernamesFor } from "@/lib/data/members";
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

export type SupportFilters = { status: SupportStatus | "active" | "all"; category: SupportCategory | null; mine: boolean; unread: boolean; page: number };

export type SupportListRow = {
  id: string;
  subject: string;
  category: SupportCategory;
  status: SupportStatus;
  priority: SupportPriority;
  requesterEmail: string | null;
  requesterId: string;
  /** The assigned operator's username, or an old Google-era assignee's email. */
  assigneeLabel: string | null;
  createdAt: string;
  lastMessageAt: string;
  /** null until migration 20261121100033 is applied. */
  unread: boolean | null;
};

/** Inbox counts; the unread ones are null until migration 20261121100033 is applied. */
export type SupportInbox = {
  byStatus: Record<string, number>;
  openByCategory: Record<string, number> | null;
  unread: number | null;
  unreadByCategory: Record<string, number> | null;
};

export type SupportListResult =
  | { state: "ready"; rows: SupportListRow[]; counts: Record<string, number>; inbox: SupportInbox; total: number; hasNext: boolean; filters: SupportFilters }
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
    unread: first("unread") === "1",
    page: Number.isInteger(page) && page >= 1 && page <= 1000 ? page : 1,
  };
}

export async function listSupportRequests(filters: SupportFilters): Promise<SupportListResult> {
  const actor = await requireAdmin("support.view");
  const admin = createAdminSupabase();
  if (!admin) return { state: "service_key_missing" };

  const inbox = await readInbox(admin);
  if (inbox === "missing") return { state: "migration_pending" };
  if (inbox === "failed") return { state: "query_failed" };

  const offset = (filters.page - 1) * SUPPORT_PAGE_SIZE;
  const base = "id,user_id,category,subject,status,priority,assigned_to,assigned_operator_id,created_at,last_message_at";
  const build = (withUnread: boolean) => {
    let query = admin
      .from("support_requests")
      .select(withUnread ? `${base},staff_unread` : base, { count: "exact" })
      .order("last_message_at", { ascending: false })
      .range(offset, offset + SUPPORT_PAGE_SIZE - 1);
    if (filters.status === "active") query = query.in("status", ["open", "in_progress", "waiting_on_user"]);
    else if (filters.status !== "all") query = query.eq("status", filters.status);
    if (filters.category) query = query.eq("category", filters.category);
    if (filters.mine) query = query.eq("assigned_operator_id", actor.id);
    if (filters.unread && withUnread) query = query.eq("staff_unread", true);
    return query;
  };
  // Before 20261121100033 there is no unread column: the list still works, without the unread marks.
  let result = await build(inbox.unread !== null);
  if (result.error && inbox.unread !== null && isMissingTable(result.error)) result = await build(false);
  const { error, count } = result;
  const data = result.data as unknown as Array<Record<string, unknown>> | null;
  if (error) {
    if (isMissingTable(error)) return { state: "migration_pending" };
    logServerError("data.support_requests", error);
    return { state: "query_failed" };
  }
  const rows = data ?? [];
  const [emails, usernames] = await Promise.all([
    emailsFor(rows.flatMap((row) => [row.user_id as string, row.assigned_to as string | null])),
    usernamesFor(rows.map((row) => row.assigned_operator_id as string | null)),
  ]);
  const counts = inbox.byStatus;
  const total = count ?? rows.length;
  return {
    state: "ready",
    inbox,
    rows: rows.map((row) => ({
      id: String(row.id),
      subject: String(row.subject),
      category: row.category as SupportCategory,
      status: row.status as SupportStatus,
      priority: row.priority as SupportPriority,
      requesterId: String(row.user_id),
      requesterEmail: emails.get(String(row.user_id)) ?? null,
      assigneeLabel: row.assigned_operator_id ? (usernames.get(String(row.assigned_operator_id)) ?? null) : row.assigned_to ? (emails.get(String(row.assigned_to)) ?? null) : null,
      createdAt: String(row.created_at),
      lastMessageAt: String(row.last_message_at),
      unread: typeof row.staff_unread === "boolean" ? row.staff_unread : null,
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
  /** The assigned operator's ID. */
  assignedTo: string | null;
  /** Their username, or an old Google-era assignee's email. */
  assignedToLabel: string | null;
  createdAt: string;
  /** When the request last changed; the Details form sends it back so a stale page cannot overwrite newer changes. */
  updatedAt: string;
  messages: Array<{ id: string; authorKind: "user" | "staff"; authorLabel: string | null; body: string; createdAt: string }>;
  assignees: Array<{ operatorId: string; username: string }>;
};

export type SupportThreadResult = { state: "ready"; thread: SupportThread } | { state: "not_found" | "service_key_missing" | "migration_pending" | "query_failed" };

export async function getSupportThread(id: string): Promise<SupportThreadResult> {
  await requireAdmin("support.view");
  if (!isUuid(id)) return { state: "not_found" };
  const admin = createAdminSupabase();
  if (!admin) return { state: "service_key_missing" };

  const request = await admin
    .from("support_requests")
    .select("id,user_id,category,subject,body,status,priority,assigned_to,assigned_operator_id,page_path,created_at,updated_at")
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
    .select("id,author_id,author_operator_id,author_kind,body,created_at")
    .eq("request_id", id)
    .order("created_at", { ascending: true })
    .limit(500);
  if (messages.error) {
    logServerError("data.support_messages", messages.error);
    return { state: "query_failed" };
  }
  const row = request.data;
  const [emails, usernames] = await Promise.all([
    emailsFor([
      row.user_id as string,
      row.assigned_to as string | null,
      ...(messages.data ?? []).map((message) => message.author_id as string | null),
    ]),
    usernamesFor([row.assigned_operator_id as string | null, ...(messages.data ?? []).map((message) => message.author_operator_id as string | null)]),
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
      assignedTo: typeof row.assigned_operator_id === "string" ? row.assigned_operator_id : null,
      assignedToLabel: typeof row.assigned_operator_id === "string"
        ? (usernames.get(row.assigned_operator_id) ?? null)
        : typeof row.assigned_to === "string" ? (emails.get(row.assigned_to) ?? null) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      messages: (messages.data ?? []).map((message) => ({
        id: String(message.id),
        authorKind: message.author_kind === "staff" ? "staff" : "user",
        authorLabel: message.author_operator_id
          ? (usernames.get(String(message.author_operator_id)) ?? null)
          : message.author_id ? (emails.get(String(message.author_id)) ?? null) : null,
        body: String(message.body),
        createdAt: String(message.created_at),
      })),
      assignees: await listSupportAssignees(),
    },
  };
}

type AdminClient = NonNullable<ReturnType<typeof createAdminSupabase>>;

function counts(value: unknown): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [key, raw] of Object.entries((value && typeof value === "object" ? value : {}) as Record<string, unknown>)) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) result[key] = parsed;
  }
  return result;
}

/** Counts by status, open work by category and unread, from fitx_admin_support_inbox, else the older counts. */
async function readInbox(admin: AdminClient): Promise<SupportInbox | "missing" | "failed"> {
  const inbox = await admin.rpc("fitx_admin_support_inbox");
  if (!inbox.error) {
    const source = (inbox.data ?? {}) as Record<string, unknown>;
    return {
      byStatus: counts(source.by_status),
      openByCategory: counts(source.open_by_category),
      unread: Number(source.unread) || 0,
      unreadByCategory: counts(source.unread_by_category),
    };
  }
  if (!isMissingFunction(inbox.error)) {
    logServerError("data.support_inbox", inbox.error);
    return "failed";
  }
  const older = await admin.rpc("fitx_admin_support_counts");
  if (older.error) {
    if (isMissingFunction(older.error)) return "missing";
    logServerError("data.support_counts", older.error);
    return "failed";
  }
  return { byStatus: counts(older.data), openByCategory: null, unread: null, unreadByCategory: null };
}

/** Unread help requests, for the Support badge in the menu; null when unknown (no badge). */
export async function getSupportUnread(): Promise<number | null> {
  await requireAdmin("support.view");
  const admin = createAdminSupabase();
  if (!admin) return null;
  const inbox = await readInbox(admin);
  return typeof inbox === "object" ? inbox.unread : null;
}

/** Marks a request read when an operator opens it (audited by the database when it was unread). */
export async function markSupportRead(id: string): Promise<void> {
  const actor = await requireAdmin("support.view");
  if (!isUuid(id)) return;
  const admin = createAdminSupabase();
  if (!admin) return;
  const { error } = await admin.rpc("fitx_admin_op_support_mark_seen", { p_operator_id: actor.id, p_request_id: id });
  if (error && !isMissingFunction(error) && error.code !== "P0002") logServerError("data.support_mark_read", error);
}
