// Help request rules shared by the Help page and /api/support. No imports, so tests can load it
// directly. supabase/migrations/20261118180005_fitx_support.sql enforces the same limits again.

export const SUPPORT_CATEGORIES = ["question", "problem", "feedback", "account", "other"] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

export const SUPPORT_CATEGORY_LABELS: Record<SupportCategory, string> = {
  question: "A question",
  problem: "Something is not working",
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

export const SUPPORT_LIMITS = { subjectMin: 3, subjectMax: 120, bodyMin: 10, bodyMax: 4000, replyMax: 4000 } as const;

/** Largest JSON body the support routes read, in bytes. */
export const SUPPORT_MAX_BODY_BYTES = 20_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(value: unknown): string {
  return typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim() : "";
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
  if (!category) return { ok: false, error: "Choose what your message is about." };
  if (subject.length < SUPPORT_LIMITS.subjectMin || subject.length > SUPPORT_LIMITS.subjectMax) {
    return { ok: false, error: `Give your message a subject of ${SUPPORT_LIMITS.subjectMin} to ${SUPPORT_LIMITS.subjectMax} characters.` };
  }
  if (body.length < SUPPORT_LIMITS.bodyMin || body.length > SUPPORT_LIMITS.bodyMax) {
    return { ok: false, error: `Write ${SUPPORT_LIMITS.bodyMin} to ${SUPPORT_LIMITS.bodyMax.toLocaleString("en-IN")} characters so we can help.` };
  }
  return { ok: true, value: { category, subject, body, pagePath: safePagePath(record.pagePath) } };
}

export function validateSupportReply(input: unknown): { ok: true; value: { requestId: string; body: string } } | { ok: false; error: string } {
  const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const requestId = typeof record.requestId === "string" && UUID.test(record.requestId) ? record.requestId.toLowerCase() : null;
  const body = text(record.body);
  if (!requestId) return { ok: false, error: "That conversation could not be found." };
  if (!body || body.length > SUPPORT_LIMITS.replyMax) return { ok: false, error: `Write 1 to ${SUPPORT_LIMITS.replyMax.toLocaleString("en-IN")} characters.` };
  return { ok: true, value: { requestId, body } };
}

/** Error codes the support routes return, in the words the Help page shows. */
export const SUPPORT_ERROR_MESSAGES: Record<string, string> = {
  rate_limited: "You have sent several messages recently. Please wait a little before sending another.",
  unavailable: "Help requests are not switched on yet.",
  closed: "This conversation is closed. Start a new message instead.",
  not_found: "That conversation could not be found.",
  signed_out: "Your session ended. Sign in again to send this.",
  failed: "Your message could not be sent. Please try again.",
};
