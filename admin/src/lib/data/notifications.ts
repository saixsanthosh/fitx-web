import "server-only";
import { hasPermission, requireAdmin, type AdminOperator } from "@/lib/admin-auth";
import type { AnnouncementValue } from "@/lib/announcement-input";
import { NOTICE_MAX_TYPED, type RecipientList } from "@/components/notifications/notice-rules";
import { logServerError } from "@/lib/log";
import { isMissingFunction, isMissingSchema, isPermissionError } from "@/lib/schema";
import { createAdminSupabase } from "@/lib/supabase/admin";

export type NoticeBatch = {
  batchId: string;
  title: string;
  body: string;
  tone: string;
  linkUrl: string | null;
  linkLabel: string | null;
  sentAt: string;
  recipients: number;
  dismissed: number;
  operator: string | null;
};

export type NoticeHistoryResult = { state: "ready"; batches: NoticeBatch[] } | { state: "service_key_missing" | "migration_pending" | "query_failed" };

/** Targeted notices sent, newest first (notifications.send). */
export async function listNoticeHistory(limit = 50): Promise<NoticeHistoryResult> {
  await requireAdmin("notifications.send");
  const admin = createAdminSupabase();
  if (!admin) return { state: "service_key_missing" };
  const { data, error } = await admin.rpc("fitx_admin_notification_history", { p_limit: limit });
  if (error) {
    if (isMissingSchema(error)) return { state: "migration_pending" };
    logServerError("data.notice_history", error);
    return { state: "query_failed" };
  }
  const rows = (Array.isArray(data) ? data : []) as Array<Record<string, unknown>>;
  return {
    state: "ready",
    batches: rows.map((row) => ({
      batchId: String(row.batch_id),
      title: String(row.title ?? ""),
      body: String(row.body ?? ""),
      tone: String(row.tone ?? "info"),
      linkUrl: typeof row.link_url === "string" ? row.link_url : null,
      linkLabel: typeof row.link_label === "string" ? row.link_label : null,
      sentAt: String(row.sent_at),
      recipients: Number(row.recipients) || 0,
      dismissed: Number(row.dismissed) || 0,
      operator: typeof row.operator_username === "string" ? row.operator_username : null,
    })),
  };
}

export type ResolvedRecipients = { ok: true; ids: string[]; unknown: string[] } | { ok: false; error: "too_many" | "lookup_failed" | "configuration" };

/** Account IDs for a pasted list: IDs as given, emails looked up one by one (at most NOTICE_MAX_TYPED). */
export async function resolveRecipients(list: RecipientList): Promise<ResolvedRecipients> {
  await requireAdmin("notifications.send");
  if (list.emails.length > NOTICE_MAX_TYPED) return { ok: false, error: "too_many" };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: "configuration" };
  const ids = new Set(list.ids);
  const unknown: string[] = [];
  for (const email of list.emails) {
    const { data, error } = await admin.rpc("fitx_admin_find_user_by_email", { p_email: email });
    if (error) {
      if (!isMissingFunction(error)) logServerError("data.notice_lookup", error);
      return { ok: false, error: "lookup_failed" };
    }
    const match = (Array.isArray(data) ? data : [])[0] as { user_id?: string } | undefined;
    if (match?.user_id) ids.add(String(match.user_id));
    else unknown.push(email);
  }
  return { ok: true, ids: [...ids], unknown };
}

export type SendResult = { ok: true; sent: number } | { ok: false; error: "forbidden" | "not_found" | "invalid" | "migration" | "configuration" | "failed" };

/** Sends one notice to chosen accounts; the database checks notifications.send again and audits. */
export async function sendNotice(actor: AdminOperator, ids: string[], notice: Pick<AnnouncementValue, "title" | "body" | "tone" | "linkUrl" | "linkLabel">): Promise<SendResult> {
  if (!hasPermission(actor, "notifications.send")) return { ok: false, error: "forbidden" };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: "configuration" };
  const { data, error } = await admin.rpc("fitx_admin_op_send_notifications", {
    p_operator_id: actor.id,
    p_user_ids: ids,
    p_title: notice.title,
    p_body: notice.body,
    p_tone: notice.tone,
    p_link_url: notice.linkUrl,
    p_link_label: notice.linkLabel,
  });
  if (error) {
    if (isMissingSchema(error)) return { ok: false, error: "migration" };
    if (isPermissionError(error)) return { ok: false, error: "forbidden" };
    if (error.code === "P0002") return { ok: false, error: "not_found" };
    if (error.code === "22023" || error.code === "23514") return { ok: false, error: "invalid" };
    logServerError("data.send_notice", error);
    return { ok: false, error: "failed" };
  }
  return { ok: true, sent: Number((data as { sent?: unknown } | null)?.sent) || 0 };
}

export type BroadcastResult = { ok: true; id: string } | { ok: false; error: "forbidden" | "migration" | "configuration" | "failed" };

/** An announcement to everyone signed in, saved and published in one step (announcements.manage). */
export async function publishAnnouncement(actor: AdminOperator, value: AnnouncementValue): Promise<BroadcastResult> {
  if (!hasPermission(actor, "announcements.manage")) return { ok: false, error: "forbidden" };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: "configuration" };
  const saved = await admin.rpc("fitx_admin_op_save_announcement", {
    p_operator_id: actor.id, p_id: null, p_title: value.title, p_body: value.body, p_tone: value.tone,
    p_link_url: value.linkUrl, p_link_label: value.linkLabel, p_starts_at: value.startsAt, p_ends_at: value.endsAt, p_confirm_live: false,
  });
  const failure = (error: { code?: string }) => (isMissingSchema(error) ? "migration" : isPermissionError(error) ? "forbidden" : "failed") as "migration" | "forbidden" | "failed";
  if (saved.error || typeof saved.data !== "string") {
    if (saved.error && failure(saved.error) === "failed") logServerError("data.broadcast_save", saved.error);
    return { ok: false, error: saved.error ? failure(saved.error) : "failed" };
  }
  const published = await admin.rpc("fitx_admin_op_set_announcement_status", { p_operator_id: actor.id, p_id: saved.data, p_status: "published" });
  if (published.error) {
    if (failure(published.error) === "failed") logServerError("data.broadcast_publish", published.error);
    return { ok: false, error: failure(published.error) };
  }
  return { ok: true, id: saved.data };
}
