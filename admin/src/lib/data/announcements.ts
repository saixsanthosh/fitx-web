import "server-only";
import { requireAdmin } from "@/lib/admin-auth";
import type { AnnouncementStatus, AnnouncementTone } from "@/lib/announcement-input";
import { emailsFor } from "@/lib/data/members";
import { isUuid } from "@/lib/data/people";
import { logServerError } from "@/lib/log";
import { isMissingFunction, isMissingTable } from "@/lib/schema";
import { createAdminSupabase } from "@/lib/supabase/admin";

export type AnnouncementRow = {
  id: string;
  title: string;
  body: string;
  tone: AnnouncementTone;
  linkUrl: string | null;
  linkLabel: string | null;
  status: AnnouncementStatus;
  startsAt: string | null;
  endsAt: string | null;
  publishedAt: string | null;
  createdByEmail: string | null;
  updatedAt: string;
  /** Accounts that dismissed it; null when the count could not be read. */
  dismissals: number | null;
};

export type AnnouncementsResult =
  | { state: "ready"; rows: AnnouncementRow[] }
  | { state: "service_key_missing" | "migration_pending" | "query_failed" };

const COLUMNS = "id,title,body,tone,link_url,link_label,status,starts_at,ends_at,published_at,created_by,updated_at";

function toRow(row: Record<string, unknown>, emails: Map<string, string>, dismissals: Map<string, number> | null): AnnouncementRow {
  const id = String(row.id);
  return {
    id,
    title: String(row.title),
    body: String(row.body),
    tone: row.tone as AnnouncementTone,
    linkUrl: typeof row.link_url === "string" ? row.link_url : null,
    linkLabel: typeof row.link_label === "string" ? row.link_label : null,
    status: row.status as AnnouncementStatus,
    startsAt: typeof row.starts_at === "string" ? row.starts_at : null,
    endsAt: typeof row.ends_at === "string" ? row.ends_at : null,
    publishedAt: typeof row.published_at === "string" ? row.published_at : null,
    createdByEmail: typeof row.created_by === "string" ? (emails.get(row.created_by) ?? null) : null,
    updatedAt: String(row.updated_at),
    dismissals: dismissals ? (dismissals.get(id) ?? 0) : null,
  };
}

async function dismissalCounts(ids: string[]): Promise<Map<string, number> | null> {
  const admin = createAdminSupabase();
  if (!admin || !ids.length) return new Map();
  const { data, error } = await admin.rpc("fitx_admin_announcement_dismissals", { p_ids: ids });
  if (error) {
    if (!isMissingFunction(error)) logServerError("data.announcement_dismissals", error);
    return null;
  }
  return new Map(((Array.isArray(data) ? data : []) as Array<{ announcement_id: string; dismissals: unknown }>).map((row) => [row.announcement_id, Number(row.dismissals) || 0]));
}

export async function listAnnouncements(): Promise<AnnouncementsResult> {
  await requireAdmin("announcements.manage");
  const admin = createAdminSupabase();
  if (!admin) return { state: "service_key_missing" };
  const { data, error } = await admin.from("announcements").select(COLUMNS).order("created_at", { ascending: false }).limit(100);
  if (error) {
    if (isMissingTable(error)) return { state: "migration_pending" };
    logServerError("data.announcements", error);
    return { state: "query_failed" };
  }
  const rows = (data ?? []) as Record<string, unknown>[];
  const [emails, dismissals] = await Promise.all([
    emailsFor(rows.map((row) => row.created_by as string | null)),
    dismissalCounts(rows.map((row) => String(row.id))),
  ]);
  return { state: "ready", rows: rows.map((row) => toRow(row, emails, dismissals)) };
}

export type AnnouncementResult = { state: "ready"; row: AnnouncementRow } | { state: "not_found" | "service_key_missing" | "migration_pending" | "query_failed" };

export async function getAnnouncement(id: string): Promise<AnnouncementResult> {
  await requireAdmin("announcements.manage");
  if (!isUuid(id)) return { state: "not_found" };
  const admin = createAdminSupabase();
  if (!admin) return { state: "service_key_missing" };
  const { data, error } = await admin.from("announcements").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) {
    if (isMissingTable(error)) return { state: "migration_pending" };
    logServerError("data.announcement", error);
    return { state: "query_failed" };
  }
  if (!data) return { state: "not_found" };
  const row = data as Record<string, unknown>;
  const [emails, dismissals] = await Promise.all([emailsFor([row.created_by as string | null]), dismissalCounts([id])]);
  return { state: "ready", row: toRow(row, emails, dismissals) };
}
