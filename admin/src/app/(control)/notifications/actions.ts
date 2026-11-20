"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { validateAnnouncement } from "@/lib/announcement-input";
import { NOTICE_MAX_RECIPIENTS, NOTICE_MAX_TYPED, parseRecipients } from "@/components/notifications/notice-rules";
import { publishAnnouncement, resolveRecipients, sendNotice } from "@/lib/data/notifications";
import { ADMIN_OPS_MIGRATION } from "@/components/settings/settings-rules";
import { MIGRATIONS } from "@/lib/schema";
import { istInputToIso } from "@/lib/time";

export type NoticeFormState = { error?: string; sent?: string } | null;

function readTime(formData: FormData, name: string): string | null | undefined {
  const raw = formData.get(name);
  if (raw === null || raw === "") return null;
  return istInputToIso(raw) ?? undefined;
}

/**
 * Sends a notice: to everyone signed in (an announcement, published at once; needs announcements.manage)
 * or to chosen accounts (a targeted notice in their app banner). Both are audited by the database.
 */
export async function sendNotification(_previous: NoticeFormState, formData: FormData): Promise<NoticeFormState> {
  const actor = await requireAdmin("notifications.send");
  const audience = formData.get("audience") === "everyone" ? "everyone" : "chosen";
  const startsAt = audience === "everyone" ? readTime(formData, "starts_at") : null;
  const endsAt = audience === "everyone" ? readTime(formData, "ends_at") : null;
  if (startsAt === undefined || endsAt === undefined) return { error: "Enter the times as a date and time (IST), or leave them empty." };
  const checked = validateAnnouncement({
    title: formData.get("title"),
    body: formData.get("body"),
    tone: formData.get("tone"),
    linkUrl: formData.get("link_url"),
    linkLabel: formData.get("link_label"),
    startsAt,
    endsAt,
  });
  if (!checked.ok) return { error: checked.error };

  if (audience === "everyone") {
    const published = await publishAnnouncement(actor, checked.value);
    if (!published.ok) {
      return { error: published.error === "forbidden" ? "Your role cannot send to everyone." : published.error === "migration" ? `This needs migration ${MIGRATIONS.adminV2}.` : published.error === "configuration" ? "Server data access is not configured." : "Nothing was sent. The server log has the details." };
    }
    revalidatePath("/notifications");
    revalidatePath("/announcements");
    return { sent: "Published to everyone signed in." };
  }

  const list = parseRecipients(formData.get("recipients"));
  if (list.invalid.length) return { error: `Not an email or account ID: ${list.invalid.slice(0, 3).join(", ")}${list.invalid.length > 3 ? "…" : ""}` };
  if (!list.ids.length && !list.emails.length) return { error: "Add at least one email or account ID." };
  if (list.emails.length > NOTICE_MAX_TYPED) return { error: `Paste at most ${NOTICE_MAX_TYPED} emails, or select the accounts on Users.` };
  const resolved = await resolveRecipients(list);
  if (!resolved.ok) return { error: resolved.error === "configuration" ? "Server data access is not configured." : "The emails could not be looked up. Try again." };
  if (resolved.unknown.length) return { error: `No FITX account uses ${resolved.unknown.slice(0, 3).join(", ")}${resolved.unknown.length > 3 ? "…" : ""}. Nothing was sent.` };
  if (resolved.ids.length > NOTICE_MAX_RECIPIENTS) return { error: `At most ${NOTICE_MAX_RECIPIENTS} accounts at a time.` };

  const sent = await sendNotice(actor, resolved.ids, checked.value);
  if (!sent.ok) {
    const messages = {
      forbidden: "Your role cannot send notices.",
      not_found: "An account was not found. Nothing was sent.",
      invalid: "The database refused these values. Check the lengths and the link.",
      migration: `Targeted notices need migration ${ADMIN_OPS_MIGRATION}.`,
      configuration: "Server data access is not configured.",
      failed: "Nothing was sent. The server log has the details.",
    } as const;
    return { error: messages[sent.error] };
  }
  revalidatePath("/notifications");
  return { sent: `Sent to ${sent.sent.toLocaleString("en-IN")} ${sent.sent === 1 ? "account" : "accounts"}.` };
}
