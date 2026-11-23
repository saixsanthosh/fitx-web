/**
 * The Explore storage sweep (wave-2 brief 3.6 "Clean-up" and 3.9): files leave the social-media bucket only through the
 * Storage API (a SQL delete would orphan the object), so the database queues them in social_storage_trash (the hourly
 * job fitx_social_hourly: expired stories, orphans older than 6 h) and this sweep removes them, in pages of up to
 * 1,000, at most 5 pages a run. It is idempotent: a file already gone is simply forgotten. An "orphan" that something
 * refers to again by now is kept and forgotten (the hourly job queues it again if it becomes an orphan once more).
 * Pure logic over injected calls, so it is tested without a database.
 */

export const SWEEP = { pages: 5, pageSize: 1000, budgetMs: 45_000, checkChunk: 100 } as const;

export type TrashRow = { path: string; reason: string };

export type SweepDeps = {
  /** Runs fitx_social_hourly() (the row work, also when pg_cron is missing); null when it does not exist yet. */
  hourly(): Promise<Record<string, unknown> | null>;
  /** The oldest queued files; null when the trash table does not exist yet. */
  trash(limit: number): Promise<TrashRow[] | null>;
  /** Of `paths`, the ones a profile, post, story or community refers to now. */
  referenced(paths: string[]): Promise<Set<string>>;
  /** Removes files through the Storage API; throws when Storage refuses. */
  remove(paths: string[]): Promise<void>;
  /** Drops these rows from the trash. */
  forget(paths: string[]): Promise<void>;
  now(): number;
};

export type SweepSummary = {
  hourly: Record<string, unknown> | null;
  removed: number;
  kept: number;
  pages: number;
  /** True when files are still queued after this run (the next run carries on). */
  more: boolean;
  schema: boolean;
};

export async function runSweep(deps: SweepDeps, limits: { pages?: number; pageSize?: number; budgetMs?: number } = {}): Promise<SweepSummary> {
  const pages = limits.pages ?? SWEEP.pages;
  const pageSize = limits.pageSize ?? SWEEP.pageSize;
  const budgetMs = limits.budgetMs ?? SWEEP.budgetMs;
  const started = deps.now();
  const hourly = await deps.hourly();
  const summary: SweepSummary = { hourly, removed: 0, kept: 0, pages: 0, more: false, schema: true };
  for (let page = 0; page < pages; page += 1) {
    if (deps.now() - started > budgetMs) {
      summary.more = true;
      break;
    }
    const rows = await deps.trash(pageSize);
    if (rows === null) {
      summary.schema = false;
      break;
    }
    if (!rows.length) break;
    summary.pages += 1;
    const orphans = rows.filter((row) => row.reason === "orphan").map((row) => row.path);
    const inUse = orphans.length ? await deps.referenced(orphans) : new Set<string>();
    const removable = rows.map((row) => row.path).filter((path) => !inUse.has(path));
    if (removable.length) await deps.remove(removable);
    await deps.forget(rows.map((row) => row.path));
    summary.removed += removable.length;
    summary.kept += inUse.size;
    if (rows.length < pageSize) break;
    if (page === pages - 1) summary.more = true;
  }
  return summary;
}

/** Splits `items` into chunks of at most `size`. */
export function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += size) out.push(items.slice(start, start + size));
  return out;
}

/** True for a Supabase error that means the function or table is not there yet (the migration is not applied). */
export function isMissing(error: { code?: string } | null | undefined): boolean {
  return ["PGRST202", "42883", "PGRST205", "42P01"].includes(String(error?.code ?? ""));
}
