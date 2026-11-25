/**
 * The title of an exercise's page: the exercise's own name (bug 78: every exercise page was "Exercise | FITX", so
 * tabs, history and the screen reader's page announcement could not tell them apart). Read on the server from the
 * catalogue with the publishable key: active catalogue rows are public, the same row the page reads in the browser.
 * Cached for ten minutes and limited to 1.5 s; a failure gives the plain "Exercise", never an error.
 */

/** Catalogue ids are letters, digits, underscores and hyphens; anything else is not looked up. */
const EXERCISE_ID = /^[A-Za-z0-9_-]{1,200}$/;
const TIMEOUT_MS = 1500;
const CACHE_SECONDS = 600;

export const GENERIC_EXERCISE_TITLE = "Exercise";
export const MISSING_EXERCISE_TITLE = "Exercise not found";

type TitleFetch = (url: string, init: RequestInit & { next?: { revalidate?: number } }) => Promise<Pick<Response, "ok" | "json">>;

/** The title from the catalogue's answer: the name, "Exercise not found" for no row, else the plain title. */
export function exerciseTitleFrom(rows: unknown): string {
  if (!Array.isArray(rows)) return GENERIC_EXERCISE_TITLE;
  if (!rows.length) return MISSING_EXERCISE_TITLE;
  const name = (rows[0] as { name?: unknown } | null)?.name;
  return typeof name === "string" && name.trim() ? name.trim().replace(/\s+/g, " ").slice(0, 120) : GENERIC_EXERCISE_TITLE;
}

export async function exercisePageTitle(id: string, options: { url?: string | null; key?: string | null; fetch?: TitleFetch } = {}): Promise<string> {
  if (!EXERCISE_ID.test(id)) return GENERIC_EXERCISE_TITLE;
  const url = options.url !== undefined ? options.url : process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = options.key !== undefined ? options.key : process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return GENERIC_EXERCISE_TITLE;
  try {
    const request = options.fetch ?? fetch;
    const response = await request(`${url.replace(/\/$/, "")}/rest/v1/exercise_library?select=name&is_active=eq.true&id=eq.${encodeURIComponent(id)}&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
      next: { revalidate: CACHE_SECONDS },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return GENERIC_EXERCISE_TITLE;
    return exerciseTitleFrom(await response.json());
  } catch {
    return GENERIC_EXERCISE_TITLE;
  }
}
