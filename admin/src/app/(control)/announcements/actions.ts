"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { ANNOUNCEMENT_STATUSES, validateAnnouncement, type AnnouncementStatus } from "@/lib/announcement-input";
import { isUuid } from "@/lib/data/people";
import { logServerError } from "@/lib/log";
import { isMissingFunction, isPermissionError, MIGRATIONS } from "@/lib/schema";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { istInputToIso } from "@/lib/time";

export type AnnouncementFormState = { error?: string } | null;

function readTime(formData: FormData, name: string): { ok: true; value: string | null } | { ok: false } {
  const raw = formData.get(name);
  if (raw === null || raw === "") return { ok: true, value: null };
  const value = istInputToIso(raw);
  return value ? { ok: true, value } : { ok: false };
}

/** Creates a draft (no id) or saves changes; the database writes the audit row in the same step. */
export async function saveAnnouncement(_previous: AnnouncementFormState, formData: FormData): Promise<AnnouncementFormState> {
  const actor = await requireAdmin("announcements.manage");
  const rawId = formData.get("id");
  const id = isUuid(rawId) ? rawId.toLowerCase() : null;
  if (rawId && !id) return { error: "This announcement no longer exists." };

  const startsAt = readTime(formData, "starts_at");
  const endsAt = readTime(formData, "ends_at");
  if (!startsAt.ok || !endsAt.ok) return { error: "Enter the start and end as a date and time (IST), or leave them empty." };
  const checked = validateAnnouncement({
    title: formData.get("title"),
    body: formData.get("body"),
    tone: formData.get("tone"),
    linkUrl: formData.get("link_url"),
    linkLabel: formData.get("link_label"),
    startsAt: startsAt.value,
    endsAt: endsAt.value,
  });
  if (!checked.ok) return { error: checked.error };

  const admin = createAdminSupabase();
  if (!admin) return { error: "Server data access is not configured." };
  const value = checked.value;
  const { data, error } = await admin.rpc("fitx_admin_save_announcement", {
    p_actor_id: actor.user.id,
    p_id: id,
    p_title: value.title,
    p_body: value.body,
    p_tone: value.tone,
    p_link_url: value.linkUrl,
    p_link_label: value.linkLabel,
    p_starts_at: value.startsAt,
    p_ends_at: value.endsAt,
  });
  if (error) {
    if (isMissingFunction(error)) return { error: `Announcements need migration ${MIGRATIONS.announcements}.` };
    if (isPermissionError(error)) return { error: "Your role cannot change announcements." };
    if (error.code === "P0002") return { error: "This announcement no longer exists." };
    if (error.code === "23514") return { error: "The database refused these values. Check the lengths, the link and the times, then save again." };
    logServerError("announcements.save", error);
    return { error: "The announcement was not saved. The server log has the details." };
  }
  const savedId = typeof data === "string" ? data : id;
  revalidatePath("/announcements");
  redirect(savedId ? `/announcements/${savedId}?notice=saved` : "/announcements");
}

export async function setAnnouncementStatus(formData: FormData) {
  const actor = await requireAdmin("announcements.manage");
  const id = formData.get("id");
  const status = formData.get("status");
  if (!isUuid(id)) redirect("/announcements");
  if (typeof status !== "string" || !(ANNOUNCEMENT_STATUSES as readonly string[]).includes(status)) redirect(`/announcements/${id}?notice=invalid`);

  const admin = createAdminSupabase();
  if (!admin) redirect(`/announcements/${id}?notice=configuration`);
  const { error } = await admin.rpc("fitx_admin_set_announcement_status", { p_actor_id: actor.user.id, p_id: id, p_status: status as AnnouncementStatus });
  if (error) {
    if (isMissingFunction(error)) redirect(`/announcements/${id}?notice=migration`);
    if (isPermissionError(error)) redirect(`/announcements/${id}?notice=forbidden`);
    logServerError("announcements.status", error);
    redirect(`/announcements/${id}?notice=failed`);
  }
  revalidatePath("/announcements");
  revalidatePath(`/announcements/${id}`);
  redirect(`/announcements/${id}?notice=${status}`);
}
