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
