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

export function validateSupportReply(input: unknown): { ok: true; value: { requestId: string; body: string } } | { ok: false; error: string } {
  const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const requestId = typeof record.requestId === "string" && UUID.test(record.requestId) ? record.requestId.toLowerCase() : null;
  const body = text(record.body);
  if (!requestId) return { ok: false, error: "That conversation could not be found." };
  if (!body || characterCount(body) > SUPPORT_LIMITS.replyMax) return { ok: false, error: `Write 1 to ${SUPPORT_LIMITS.replyMax.toLocaleString("en-IN")} characters.` };
  return { ok: true, value: { requestId, body } };
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

/** Error codes the support routes return, in the words the Help page shows. */
export const SUPPORT_ERROR_MESSAGES: Record<string, string> = {
  rate_limited: "You have sent several messages recently. Please wait a little before sending another.",
  invalid: "Check the length of what you wrote and try again.",
  unavailable: "Help requests are not switched on yet.",
  feature_unavailable: "Messages are paused for now. Please try again later.",
  closed: "This conversation is closed. Start a new message instead.",
  not_found: "That conversation could not be found.",
  signed_out: "Your session ended. Sign in again to send this.",
  failed: "Your message could not be sent. Please try again.",
};
