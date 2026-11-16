import { isMissingColumnError, isMissingFunctionError } from "@/lib/supabase/errors";

type ErrorLike = { code?: unknown } | null | undefined;

/** A table is not there yet (a migration not applied): Postgres 42P01, PostgREST PGRST205. */
export function isMissingTableError(error: unknown): boolean {
  const code = (error as ErrorLike)?.code;
  return code === "42P01" || code === "PGRST205";
}

/** Any "this database is older than the app" error: a missing table, column or function. */
export function isMissingSchemaError(error: unknown): boolean {
  return isMissingTableError(error) || isMissingColumnError(error) || isMissingFunctionError(error);
}

export { isMissingColumnError, isMissingFunctionError };

/** Thrown when a feature needs a migration that has not been applied yet. */
export class FeatureUnavailableError extends Error {
  constructor(message = "This needs the next FITX update.") {
    super(message);
    this.name = "FeatureUnavailableError";
  }
}

/** Thrown for any other failed request, carrying the Supabase error for logs. */
export class DataError extends Error {
  cause: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "DataError";
    this.cause = cause;
  }
}
