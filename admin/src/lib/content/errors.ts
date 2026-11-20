// Turns a database error from a content function into words for the operator. No imports.
// The content functions raise 22023 (a rule), 23505 (taken), P0002 (not found), 42501 (role) and
// FXC01 to FXC04 (in use, catalogue item, too many files, fixed by Razorpay) with plain messages.

export const CONTENT_MIGRATION = "20261121100036_fitx_admin_content";

const SAFE_CODES = new Set(["22023", "23505", "P0002", "FXC01", "FXC02", "FXC03", "FXC04"]);

type ErrorLike = { code?: unknown; message?: unknown } | null | undefined;

export function isContentMigrationMissing(error: ErrorLike): boolean {
  const code = typeof error?.code === "string" ? error.code : "";
  return ["PGRST202", "42883", "PGRST205", "42P01"].includes(code);
}

export function contentErrorMessage(error: ErrorLike): string {
  const code = typeof error?.code === "string" ? error.code : "";
  const message = typeof error?.message === "string" ? error.message.trim() : "";
  if (code === "42501") return "Your role cannot make this change.";
  if (isContentMigrationMissing(error)) return `This needs the database update ${CONTENT_MIGRATION}.`;
  if (SAFE_CODES.has(code) && message && message.length <= 160 && !/[<>{}]/.test(message)) return message.endsWith(".") ? message : `${message}.`;
  if (code === "23514") return "A value is outside what the database allows.";
  return "The change could not be saved. Nothing was changed.";
}
