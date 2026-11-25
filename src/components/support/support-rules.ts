// Help request rules shared by the Help page and /api/support. No imports, so tests can load it
// directly. supabase/migrations/20261118180005_fitx_support.sql enforces the same limits again.

// "complaint" is accepted once migration 20261121100033_fitx_admin_ops widens the database check; until then
// the Help page leaves it out (helpCategories).
export const SUPPORT_CATEGORIES = ["question", "problem", "complaint", "feedback", "account", "other"] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

export const SUPPORT_CATEGORY_LABELS: Record<SupportCategory, string> = {
  question: "A question",
  problem: "Something is not working",
  complaint: "A complaint",
  feedback: "Feedback or an idea",
  account: "My account or sign-in",
  other: "Something else",
};

/** How a request's status reads to the person who sent it. */
export const SUPPORT_STATUS_LABELS: Record<string, string> = {
  open: "Received",
  in_progress: "Being looked at",
  waiting_on_user: "Waiting for your reply",
  resolved: "Resolved",
  closed: "Closed",
};

/** The categories the Help form offers: complaints only when the database accepts them. */
export function helpCategories(complaintsAccepted: boolean): readonly SupportCategory[] {
  return complaintsAccepted ? SUPPORT_CATEGORIES : SUPPORT_CATEGORIES.filter((category) => category !== "complaint");
}

export const SUPPORT_LIMITS = { subjectMin: 3, subjectMax: 120, bodyMin: 10, bodyMax: 4000, replyMax: 4000 } as const;

/**
 * How many messages the database takes from one account (fitx_submit_support_request: 3 requests an hour and 10 a day;
 * fitx_reply_support_request: 10 replies an hour), on top of the routes' own burst limit (ROUTE_LIMITS.support).
 */
export const SUPPORT_RATE = { requestsPerHour: 3, requestsPerDay: 10, repliesPerHour: 10 } as const;

/** Largest JSON body the support routes read, in bytes. */
export const SUPPORT_MAX_BODY_BYTES = 20_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Trimmed text with Windows line ends normalised and control characters other than tab and newline removed (Postgres text cannot hold NUL). */
function text(value: unknown): string {
  return typeof value === "string" ? value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim() : "";
}

/** Length in characters (code points), as Postgres char_length counts it; an emoji is 1, not 2. */
export function characterCount(value: string): number {
  return Array.from(value).length;
}

/** The page the person was on, as a plain in-app path (no query string, which could hold personal data). */
export function safePagePath(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\u0000-\u001f\\]/.test(value)) return null;
  const path = value.split(/[?#]/)[0];
  return path.length <= 200 ? path : null;
}

export type SupportRequestInput = { category: SupportCategory; subject: string; body: string; pagePath: string | null };

export function validateSupportRequest(input: unknown): { ok: true; value: SupportRequestInput } | { ok: false; error: string } {
  const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const category = (SUPPORT_CATEGORIES as readonly unknown[]).includes(record.category) ? (record.category as SupportCategory) : null;
  const subject = text(record.subject).replace(/\s+/g, " ");
  const body = text(record.body);
  const subjectLength = characterCount(subject);
  const bodyLength = characterCount(body);
  if (!category) return { ok: false, error: "Choose what your message is about." };
  if (subjectLength < SUPPORT_LIMITS.subjectMin || subjectLength > SUPPORT_LIMITS.subjectMax) {
    return { ok: false, error: `Give your message a subject of ${SUPPORT_LIMITS.subjectMin} to ${SUPPORT_LIMITS.subjectMax} characters.` };
  }
  if (bodyLength < SUPPORT_LIMITS.bodyMin || bodyLength > SUPPORT_LIMITS.bodyMax) {
    return { ok: false, error: `Write ${SUPPORT_LIMITS.bodyMin} to ${SUPPORT_LIMITS.bodyMax.toLocaleString("en-IN")} characters so we can help.` };
  }
  return { ok: true, value: { category, subject, body, pagePath: safePagePath(record.pagePath) } };
}

/** Why a reply can't be sent as typed (only spaces, nothing, or too long), in the server's own words; null when it can. */
export function replyTextProblem(value: unknown): string | null {
  const body = text(value);
  return !body || characterCount(body) > SUPPORT_LIMITS.replyMax ? `Write 1 to ${SUPPORT_LIMITS.replyMax.toLocaleString("en-IN")} characters.` : null;
}

export function validateSupportReply(input: unknown): { ok: true; value: { requestId: string; body: string } } | { ok: false; error: string } {
  const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const requestId = typeof record.requestId === "string" && UUID.test(record.requestId) ? record.requestId.toLowerCase() : null;
  if (!requestId) return { ok: false, error: "That conversation could not be found." };
  const problem = replyTextProblem(record.body);
  if (problem) return { ok: false, error: problem };
  return { ok: true, value: { requestId, body: text(record.body) } };
}

/** One message in a Help thread, as the Help page shows it. */
export type SupportMessageView = { id: string; fromTeam: boolean; body: string; createdAt: string };

/** The reply POST /api/support/reply saved, from its answer's `reply` field, or null when the answer has none. */
export function sentReply(value: unknown): SupportMessageView | null {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const { id, body, createdAt } = record;
  if (typeof id !== "string" || !UUID.test(id) || typeof body !== "string" || !body || typeof createdAt !== "string") return null;
  return { id, fromTeam: false, body, createdAt };
}

/**
 * A thread with the person's replies sent from this page that the page's own copy does not hold yet (the
 * refresh that brings them can be slow, or stall), and the status they gave it: as in
 * fitx_reply_support_request, a reply moves a request that waited for the person, or was resolved, back to
 * open. Once the page's copy has a reply (the same id), that copy is shown instead.
 */
export function withSentReplies(thread: { status: string; messages: SupportMessageView[] }, sent: readonly SupportMessageView[]) {
  const known = new Set(thread.messages.map((message) => message.id));
  const unsynced = sent.filter((message) => !known.has(message.id));
  if (!unsynced.length) return { status: thread.status, messages: thread.messages };
  return {
    status: thread.status === "waiting_on_user" || thread.status === "resolved" ? "open" : thread.status,
    messages: [...thread.messages, ...unsynced],
  };
}

export type SupportSendKind = "request" | "reply";
/** Which limit stopped a message: the routes' burst limit, or the database's hourly or daily one. */
export type SupportLimitWindow = "burst" | "hour" | "day";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * Which limit holds and when the next message can go, from the times the person's own recent messages were sent
 * (requests, or replies), counted as the database counts them: a request waits while 3 were sent in the last hour or
 * 10 in the last day, a reply while 10 were sent in the last hour. `reported` is the limit the database named; it is
 * kept, with no time, when the times don't show a limit (they could not be read, or the clocks differ).
 */
export function supportWait(kind: SupportSendKind, times: readonly string[], now: number, reported: "hour" | "day" = "hour"): { window: "hour" | "day"; at: number | null } {
  const newest = times.map((value) => Date.parse(value)).filter(Number.isFinite).sort((a, b) => b - a);
  const freeAt = (windowMs: number, limit: number) => {
    const inWindow = newest.filter((at) => at > now - windowMs);
    return inWindow.length >= limit ? inWindow[limit - 1] + windowMs : null;
  };
  if (kind === "reply") return { window: "hour", at: freeAt(HOUR_MS, SUPPORT_RATE.repliesPerHour) };
  const hour = freeAt(HOUR_MS, SUPPORT_RATE.requestsPerHour);
  const day = freeAt(DAY_MS, SUPPORT_RATE.requestsPerDay);
  if (day !== null && (hour === null || day >= hour)) return { window: "day", at: day };
  if (hour !== null) return { window: "hour", at: hour };
  return { window: reported, at: null };
}

/** "at 2:32 pm IST", or "on 27 Nov at 9:15 am IST" on another day: India Standard Time, as the Help page shows times. */
export function supportTimeText(at: number, now: number): string {
  const time = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(at);
  const day = (value: number) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(value);
  return day(at) === day(now) ? `at ${time} IST` : `on ${day(at)} at ${time} IST`;
}

/** What the Help page says when a limit stops a message: the real limit and when the next one can go. */
export function supportLimitMessage(kind: SupportSendKind, window: SupportLimitWindow, at: number | null, now: number): string {
  if (window === "burst") {
    const seconds = at === null ? null : Math.max(1, Math.ceil((at - now) / 1000));
    return `You've sent several messages in the last minute. ${seconds === null ? "Your next one can go in a minute." : `Your next one can go in ${seconds} ${seconds === 1 ? "second" : "seconds"}.`}`;
  }
  const rule = kind === "reply"
    ? `You can send up to ${SUPPORT_RATE.repliesPerHour} replies an hour.`
    : window === "day" ? `You can send up to ${SUPPORT_RATE.requestsPerDay} messages a day.` : `You can send up to ${SUPPORT_RATE.requestsPerHour} messages an hour.`;
  const when = at !== null ? `Your next one can go ${supportTimeText(at, now)}.` : `Your next one can go within ${window === "day" ? "a day" : "an hour"}.`;
  return `${rule} ${when}`;
}

/** The body of a support route's 429: which limit, when the next message can go (ISO, or null), and the words to show. */
export function supportLimitBody(kind: SupportSendKind, window: SupportLimitWindow, at: number | null, now: number) {
  return { error: "rate_limited", window, retryAt: at === null ? null : new Date(at).toISOString(), message: supportLimitMessage(kind, window, at, now) };
}

/** Error codes the support routes return, in the words the Help page shows. */
export const SUPPORT_ERROR_MESSAGES: Record<string, string> = {
  rate_limited: `You've reached the limit for messages to the FITX team: up to ${SUPPORT_RATE.requestsPerHour} messages an hour and ${SUPPORT_RATE.requestsPerDay} a day, and ${SUPPORT_RATE.repliesPerHour} replies an hour. Please try again later.`,
  invalid: "Check the length of what you wrote and try again.",
  unavailable: "Help requests are not switched on yet.",
  feature_unavailable: "Messages are paused for now. Please try again later.",
  closed: "This conversation is closed. Start a new message instead.",
  not_found: "That conversation could not be found.",
  signed_out: "Your session ended. Sign in again to send this.",
  failed: "Your message could not be sent. Please try again.",
};
