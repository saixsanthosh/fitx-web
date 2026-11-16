// Server log lines for Vercel's function logs. They carry error codes and short
// messages only: emails, IDs, tokens and keys are masked before anything is printed.

const MAX_MESSAGE_LENGTH = 200;

export function redact(text: string): string {
  return text
    .replace(/[^\s@"'<>()]+@[^\s@"'<>()]+\.[a-z]{2,}/gi, "[email]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[id]")
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]*/g, "[token]")
    .replace(/\bsb_(?:secret|publishable)_[\w-]+/gi, "[key]")
    .replace(/\b[\w-]{32,}\b/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_MESSAGE_LENGTH);
}

/** Summarises a Supabase, PostgREST or JavaScript error as safe key=value pairs. */
export function describeError(error: unknown): string {
  if (error === null || error === undefined) return "";
  if (typeof error !== "object") return `message="${redact(String(error))}"`;

  const record = error as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of ["name", "code", "status"] as const) {
    const value = record[key];
    if ((typeof value === "string" && value) || typeof value === "number") {
      parts.push(`${key}=${redact(String(value))}`);
    }
  }
  if (typeof record.message === "string" && record.message) {
    parts.push(`message="${redact(record.message)}"`);
  }
  return parts.join(" ");
}

export function logServerError(scope: string, error?: unknown) {
  const detail = describeError(error);
  console.error(`[fitx-admin] ${scope} failed${detail ? `: ${detail}` : ""}`);
}

export function logServerWarning(scope: string, detail: string) {
  console.warn(`[fitx-admin] ${scope}: ${redact(detail)}`);
}
