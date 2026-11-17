type ErrorLike = { code?: unknown } | null | undefined;

const codeOf = (error: unknown) => {
  const code = (error as ErrorLike)?.code;
  return typeof code === "string" ? code : null;
};

/** The database or its API does not know a column yet (a migration not applied): Postgres 42703, PostgREST PGRST204. */
export function isMissingColumnError(error: unknown): boolean {
  const code = codeOf(error);
  return code === "42703" || code === "PGRST204";
}

/** A database function does not exist yet: PostgREST PGRST202, Postgres 42883. */
export function isMissingFunctionError(error: unknown): boolean {
  const code = codeOf(error);
  return code === "PGRST202" || code === "42883";
}

/** A table does not exist yet (its migration is not applied): PostgREST PGRST205, Postgres 42P01. */
export function isMissingTableError(error: unknown): boolean {
  const code = codeOf(error);
  return code === "PGRST205" || code === "42P01";
}
