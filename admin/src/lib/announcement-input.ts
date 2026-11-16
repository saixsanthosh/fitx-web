// Validation for announcements typed in Admin. No imports, so tests can load this file directly.
// supabase/migrations/20261118180006_fitx_announcements.sql enforces the same rules again.

export const ANNOUNCEMENT_TONES = ["info", "success", "warning"] as const;
export type AnnouncementTone = (typeof ANNOUNCEMENT_TONES)[number];
export const ANNOUNCEMENT_STATUSES = ["draft", "published", "archived"] as const;
export type AnnouncementStatus = (typeof ANNOUNCEMENT_STATUSES)[number];

export const ANNOUNCEMENT_TONE_LABELS: Record<AnnouncementTone, string> = {
  info: "Information",
  success: "Good news",
  warning: "Important notice",
};

export const ANNOUNCEMENT_LIMITS = { title: 120, body: 600, linkUrl: 300, linkLabel: 40 } as const;

export type AnnouncementValue = {
  title: string;
  body: string;
  tone: AnnouncementTone;
  linkUrl: string | null;
  linkLabel: string | null;
  startsAt: string | null;
  endsAt: string | null;
};

/** Length in characters (code points), as Postgres char_length counts it; an emoji is 1, not 2. */
export function characterCount(value: string): number {
  return Array.from(value).length;
}

/** A link inside FITX ("/workouts", not "//elsewhere") or any https:// address. */
export function isSafeAnnouncementLink(url: string): boolean {
  if (characterCount(url) > ANNOUNCEMENT_LIMITS.linkUrl || /\s/.test(url)) return false;
  if (url.startsWith("/")) return url === "/" || !/^\/[/\\]/.test(url);
  if (!url.startsWith("https://")) return false;
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

export function validateAnnouncement(input: {
  title: unknown;
  body: unknown;
  tone: unknown;
  linkUrl: unknown;
  linkLabel: unknown;
  /** ISO timestamps already converted from the IST form fields; null when left empty. */
  startsAt: string | null;
  endsAt: string | null;
}): { ok: true; value: AnnouncementValue } | { ok: false; error: string } {
  // Control characters other than tab and newline are dropped; Postgres text cannot hold NUL.
  const text = (value: unknown) => (typeof value === "string" ? value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim() : "");
  const title = text(input.title);
  const body = text(input.body);
  const linkUrl = text(input.linkUrl);
  const linkLabel = text(input.linkLabel);
  const tone = (ANNOUNCEMENT_TONES as readonly string[]).includes(text(input.tone)) ? (text(input.tone) as AnnouncementTone) : null;

  const titleLength = characterCount(title);
  if (titleLength < 3 || titleLength > ANNOUNCEMENT_LIMITS.title) return { ok: false, error: `The title needs 3 to ${ANNOUNCEMENT_LIMITS.title} characters.` };
  if (!body || characterCount(body) > ANNOUNCEMENT_LIMITS.body) return { ok: false, error: `The message needs 1 to ${ANNOUNCEMENT_LIMITS.body} characters.` };
  if (!tone) return { ok: false, error: "Choose a style for the announcement." };
  if (Boolean(linkUrl) !== Boolean(linkLabel)) return { ok: false, error: "A link needs both an address and a button label." };
  if (linkUrl && !isSafeAnnouncementLink(linkUrl)) return { ok: false, error: "Links must start with / (a FITX page) or https://." };
  if (characterCount(linkLabel) > ANNOUNCEMENT_LIMITS.linkLabel) return { ok: false, error: `The button label can have at most ${ANNOUNCEMENT_LIMITS.linkLabel} characters.` };
  if (input.startsAt && input.endsAt && Date.parse(input.endsAt) <= Date.parse(input.startsAt)) {
    return { ok: false, error: "The end time must be after the start time." };
  }
  return {
    ok: true,
    value: { title, body, tone, linkUrl: linkUrl || null, linkLabel: linkLabel || null, startsAt: input.startsAt, endsAt: input.endsAt },
  };
}

/** Whether a published announcement is showing now, scheduled, or over. */
export function announcementTiming(startsAt: string | null, endsAt: string | null, now = Date.now()): "live" | "scheduled" | "ended" {
  if (endsAt && Date.parse(endsAt) <= now) return "ended";
  if (startsAt && Date.parse(startsAt) > now) return "scheduled";
  return "live";
}

/** The status words and pill style the Admin list shows. */
export function announcementStatus(row: { status: string; startsAt: string | null; endsAt: string | null }, now = Date.now()): { text: string; tone: "status-good" | "status-neutral" } {
  if (row.status === "draft") return { text: "Draft", tone: "status-neutral" };
  if (row.status === "archived") return { text: "Archived", tone: "status-neutral" };
  const timing = announcementTiming(row.startsAt, row.endsAt, now);
  if (timing === "scheduled") return { text: "Scheduled", tone: "status-good" };
  if (timing === "ended") return { text: "Ended", tone: "status-neutral" };
  return { text: "Live", tone: "status-good" };
}
