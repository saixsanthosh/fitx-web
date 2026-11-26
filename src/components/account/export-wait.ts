/**
 * How long "Download my data" waits on FITX (fix round 3d, the same mistake as Profile's saves): before, a request that
 * never answered left "Collecting your data…" up, and the button on "Preparing…", until the page was reloaded.
 *
 * A big account on a slow connection can take a while, so there is no limit on the whole download: it stops only when
 * EXPORT_STALL_LIMIT_MS pass with nothing new (no part of the account read in that time). Its requests are then
 * cancelled, it says so, and nothing is downloaded.
 *
 * No React here, so node tests cover it (tests/account/export-time-limit.test.ts).
 */

/** How long the download may go without reading another part of the account. */
export const EXPORT_STALL_LIMIT_MS = 60_000;

/** What Settings says when it stops waiting. */
export const EXPORT_STALLED = "Collecting your data is taking too long, so we stopped waiting. Nothing was downloaded. Check your connection and try again.";

export class ExportStalled extends Error {
  readonly ms: number;

  constructor(ms: number) {
    super(`nothing new within ${ms} ms`);
    this.name = "ExportStalled";
    this.ms = ms;
  }
}

/** True for the error unlessStalled rejects with. */
export function isStalled(error: unknown): error is ExportStalled {
  return error instanceof ExportStalled;
}

/**
 * Runs `work` until it ends, however long that takes, as long as it calls `progress()` at least every `stallMs`. Past
 * that its signal is aborted (so are the requests built with it) and this rejects with ExportStalled at once; what
 * `work` does afterwards is up to it (it checks `signal.aborted`), and its late `progress()` calls do nothing.
 */
export async function unlessStalled<T>(work: (signal: AbortSignal, progress: () => void) => PromiseLike<T>, stallMs: number = EXPORT_STALL_LIMIT_MS): Promise<T> {
  const controller = new AbortController();
  const stalled = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(new ExportStalled(stallMs)), { once: true });
  });
  stalled.catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let waiting = true;
  const progress = () => {
    if (!waiting) return;
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), stallMs);
  };
  try {
    progress();
    return await Promise.race([work(controller.signal, progress), stalled]);
  } finally {
    waiting = false;
    clearTimeout(timer);
  }
}
