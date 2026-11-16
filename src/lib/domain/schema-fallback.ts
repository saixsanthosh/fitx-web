/**
 * Optional-column fallback for Supabase (PostgREST) requests.
 *
 * Some screens read or write columns that arrive in a later migration. If the
 * database has not received that migration yet, PostgREST rejects the whole
 * request instead of ignoring the unknown column:
 *
 * - reads, filters and returned columns fail with Postgres `42703`, for example
 *   `column workout_sets.duration_seconds does not exist`;
 * - insert and update payloads fail with PostgREST `PGRST204`, for example
 *   `Could not find the 'duration_seconds' column of 'workout_sets' in the schema cache`.
 *
 * A rejected PostgREST request runs in a single transaction and changes nothing,
 * so it is safe to send the same request again without the optional columns.
 *
 * This module has no imports so it runs unchanged in the app and under `node --test`.
 */

/** The parts of a PostgREST error this module reads. */
export type PostgrestErrorLike = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

/** What a missing-column error says about the column, when it says anything. */
export type MissingColumn = {
  /** The missing column, or null when the error does not name it. */
  column: string | null;
  /** The table the error names, or null when it names none. */
  table: string | null;
};

export type OptionalColumnsOutcome<R> = {
  /** The response of the request that ran last. */
  result: R;
  /** True when that request included the optional columns. */
  includedOptional: boolean;
  /** Set when the database reported one of the optional columns as missing. */
  missing: MissingColumn | null;
};

export const POSTGRES_UNDEFINED_COLUMN = "42703";
export const POSTGREST_UNKNOWN_COLUMN = "PGRST204";

// column workout_sets.duration_seconds does not exist
// column "duration_seconds" does not exist
// column "duration_seconds" of relation "workout_sets" does not exist
const UNDEFINED_COLUMN_MESSAGE = /\bcolumn\s+((?:"[^"]+"|[\w$]+)(?:\s*\.\s*(?:"[^"]+"|[\w$]+))*)(?:\s+of\s+relation\s+((?:"[^"]+"|[\w$]+)(?:\s*\.\s*(?:"[^"]+"|[\w$]+))*))?\s+does\s+not\s+exist/i;
// Could not find the 'duration_seconds' column of 'workout_sets' in the schema cache
const SCHEMA_CACHE_MESSAGE = /could\s+not\s+find\s+the\s+'([^']+)'\s+column\s+of\s+'([^']+)'\s+in\s+the\s+schema\s+cache/i;

function identifierParts(qualified: string): string[] {
  const parts: string[] = [];
  const pattern = /"([^"]+)"|([\w$]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(qualified))) parts.push(match[1] ?? match[2]);
  return parts;
}

function lastPart(qualified: string): string | null {
  const parts = identifierParts(qualified);
  return parts.length ? parts[parts.length - 1] : null;
}

/**
 * Reads a Supabase/PostgREST error and returns what it says about a missing
 * column, or null when the error is about something else (a network failure,
 * a permission problem, a constraint, a missing table).
 */
export function missingColumnFromError(error: unknown): MissingColumn | null {
  if (!error || typeof error !== "object") return null;
  const { code, message } = error as PostgrestErrorLike;
  const knownCode = code === POSTGRES_UNDEFINED_COLUMN || code === POSTGREST_UNKNOWN_COLUMN;
  // Another error code means another problem, even if the wording looks similar.
  if (code && !knownCode) return null;
  const text = typeof message === "string" ? message : "";

  const cacheMatch = SCHEMA_CACHE_MESSAGE.exec(text);
  if (cacheMatch) return { column: cacheMatch[1], table: lastPart(cacheMatch[2]) };

  const columnMatch = UNDEFINED_COLUMN_MESSAGE.exec(text);
  if (columnMatch) {
    const parts = identifierParts(columnMatch[1]);
    const column = parts.length ? parts[parts.length - 1] : null;
    const table = columnMatch[2] ? lastPart(columnMatch[2]) : parts.length > 1 ? parts[parts.length - 2] : null;
    return { column, table };
  }

  return knownCode ? { column: null, table: null } : null;
}

/**
 * True when `error` reports a missing column. With `optionalColumns`, the
 * missing column must be one of them; an error that does not name its column
 * still counts, because only a retry can tell.
 */
export function isMissingColumnError(error: unknown, optionalColumns?: readonly string[]): boolean {
  const missing = missingColumnFromError(error);
  if (!missing) return false;
  if (!optionalColumns || !missing.column) return true;
  const column = missing.column.toLowerCase();
  return optionalColumns.some((name) => name.toLowerCase() === column);
}

/**
 * Runs a Supabase request with its optional columns and, if the database says
 * one of them does not exist, runs it once more without them.
 *
 * `run(includeOptional)` must build a fresh request each time: the select list,
 * filters and payload either with or without the optional columns. Pass
 * `includeOptional: false` when an earlier request already found the columns
 * missing, so the first attempt goes straight to the reduced request.
 * Any other error is returned untouched and never retried.
 */
export async function withOptionalColumns<Request extends PromiseLike<{ error: unknown }>>(
  optionalColumns: readonly string[],
  run: (includeOptional: boolean) => Request,
  options: { includeOptional?: boolean } = {},
): Promise<OptionalColumnsOutcome<Awaited<Request>>> {
  // Typed through the request itself: Supabase builders are thenables with a generic `then`.
  const send = async (includeOptional: boolean) => (await run(includeOptional)) as Awaited<Request> & { error: unknown };
  if (options.includeOptional === false) {
    return { result: await send(false), includedOptional: false, missing: null };
  }
  const first = await send(true);
  if (!first.error || !isMissingColumnError(first.error, optionalColumns)) {
    return { result: first, includedOptional: true, missing: null };
  }
  const missing = missingColumnFromError(first.error);
  return { result: await send(false), includedOptional: false, missing };
}

/** A comma-separated select list, with the optional columns appended when included. */
export function columnList(columns: readonly string[], optionalColumns: readonly string[], includeOptional: boolean): string {
  return (includeOptional ? [...columns, ...optionalColumns] : [...columns]).join(",");
}

/**
 * A copy of `row` without the given keys. The keys are removed, not set to
 * undefined: supabase-js lists every key of a bulk insert in its `columns`
 * parameter, so an undefined key would still reach PostgREST.
 */
export function omitColumns<T extends Record<string, unknown>, K extends string>(row: T, columns: readonly K[]): Omit<T, K> {
  const copy: Record<string, unknown> = { ...row };
  for (const column of columns) delete copy[column];
  return copy as Omit<T, K>;
}

/** `row` as it should be sent: whole, or without the optional columns. */
export function payloadFor<T extends Record<string, unknown>, K extends string>(row: T, optionalColumns: readonly K[], includeOptional: boolean): T | Omit<T, K> {
  return includeOptional ? row : omitColumns(row, optionalColumns);
}

/** True when any row holds a value (not null or undefined) in one of the columns. */
export function hasValuesIn(rows: readonly Record<string, unknown>[], columns: readonly string[]): boolean {
  return rows.some((row) => columns.some((column) => row[column] !== null && row[column] !== undefined));
}
