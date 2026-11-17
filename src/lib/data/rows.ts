/**
 * Small helpers for reading rows page by page under PostgREST's row cap, and for turning the member's calendar
 * days into instants. Shared by the Home, Progress and Goals loaders.
 */

type Answer = { data: unknown; error: unknown };

export type PagedRows<T> = {
  rows: T[];
  error: unknown | null;
  /** True when the page limit stopped the read before the last row. */
  capped: boolean;
};

/**
 * Reads `run(from, to)` page by page until a short page, at most `maxPages` pages. `run` must build a fresh
 * request each time (a PostgREST builder runs once).
 */
export async function pagedRows<T>(run: (from: number, to: number) => PromiseLike<Answer>, options: { pageSize?: number; maxPages?: number } = {}): Promise<PagedRows<T>> {
  const pageSize = Math.max(1, options.pageSize ?? 1000);
  const maxPages = Math.max(1, options.maxPages ?? 10);
  const rows: T[] = [];
  for (let page = 0; page < maxPages; page += 1) {
    const from = page * pageSize;
    const { data, error } = await run(from, from + pageSize - 1);
    if (error) return { rows, error, capped: false };
    const list = Array.isArray(data) ? (data as T[]) : [];
    rows.push(...list);
    if (list.length < pageSize) return { rows, error: null, capped: false };
  }
  return { rows, error: null, capped: true };
}

/** Local midnight of a day key (YYYY-MM-DD) in the browser's zone, as an ISO instant. */
export function startOfDayIso(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day).toISOString();
}

export const toNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
};
