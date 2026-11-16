// Recognises "this part of the database is not installed yet", so screens can say which migration
// is needed instead of failing. No imports.

export const MIGRATIONS = {
  roles: "20261118180001_fitx_admin_roles",
  audit: "20261118180002_fitx_admin_audit_log",
  metrics: "20261118180003_fitx_admin_metrics",
  people: "20261118180004_fitx_admin_people",
  support: "20261118180005_fitx_support",
  announcements: "20261118180006_fitx_announcements",
} as const;

export type MigrationKey = keyof typeof MIGRATIONS;

type ErrorLike = { code?: unknown } | null | undefined;

function codeOf(error: unknown) {
  const code = (error as ErrorLike)?.code;
  return typeof code === "string" ? code : "";
}

/** A table or view is missing: Postgres 42P01, PostgREST PGRST205 (or PGRST204 for a missing column). */
export function isMissingTable(error: unknown): boolean {
  return ["42P01", "PGRST205", "PGRST204", "42703"].includes(codeOf(error));
}

/** A database function is missing or has a different signature: PostgREST PGRST202, Postgres 42883. */
export function isMissingFunction(error: unknown): boolean {
  return ["PGRST202", "42883"].includes(codeOf(error));
}

export function isMissingSchema(error: unknown): boolean {
  return isMissingTable(error) || isMissingFunction(error);
}

/** Postgres permission errors raised by the Admin functions (42501). */
export function isPermissionError(error: unknown): boolean {
  return codeOf(error) === "42501";
}
