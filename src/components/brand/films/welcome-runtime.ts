import { FILM_SEEN_KEY, FILM_SEEN_MS } from "../introKeys";

/**
 * The welcome film's decisions (BRIEF-2 3.3 and D1), kept apart from WelcomeFilm.tsx so
 * tests/brand/welcome-film-runtime.test.ts can check every case without a browser.
 */

/**
 * - "none": no welcome cuts (D1 dormant): never rendered, `onEnd` at once;
 * - "still": reduced motion: the static mark and "Welcome, <first name>" for 2.0 s;
 * - "reveal": Save-Data or 2G, or the video could not play: LogoReveal "welcome" alone (its Skip is the only one);
 * - "film": the film, its own Skip and Sound, ending on LogoReveal "film-end".
 */
export type WelcomeMode = "none" | "still" | "reveal" | "film";

export function welcomeMode({ hasManifest, reduced, filmAllowed, unsupported = false }: { hasManifest: boolean; reduced: boolean; filmAllowed: boolean; unsupported?: boolean }): WelcomeMode {
  if (!hasManifest) return "none";
  if (reduced) return "still";
  if (!filmAllowed || unsupported) return "reveal";
  return "film";
}

/** How long the reduced-motion still holds before `onEnd`. */
export const WELCOME_STILL_MS = 2000;
/** WelcomeFilm fades its own stage out over this long after the film, then calls `onEnd`. */
export const WELCOME_EXIT_MS = 300;
/** The completion call is retried once, this long after the first try failed. */
export const REPORT_RETRY_MS = 2000;

/** The greeting: the first name from the profile, or none at all. */
export function welcomeLine(firstName: string | null | undefined): string {
  const name = (firstName ?? "").trim();
  return name ? `Welcome, ${name}` : "Welcome to FITX";
}

type Store = Pick<Storage, "setItem" | "getItem">;

/** D1: the device remembers when the welcome film started (ISO time), so the account gate never replays it. */
export function markFilmSeen(storage: Store | null, now: Date = new Date()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(FILM_SEEN_KEY, now.toISOString());
    return true;
  } catch {
    return false;
  }
}

/** Whether a stored FILM_SEEN_KEY value is less than 7 days old (a value from the future does not count). */
export function filmSeenRecently(value: string | null | undefined, now: number = Date.now()): boolean {
  const at = Date.parse(value ?? "");
  if (!Number.isFinite(at)) return false;
  const age = now - at;
  return age >= 0 && age < FILM_SEEN_MS;
}

type Fetcher = (input: string, init: RequestInit) => Promise<{ ok: boolean }>;

/**
 * D1: POST /api/intro/complete (sets `fitx_intro=seen` and `profiles.intro_completed_at`) with `keepalive`, retried
 * once after 2 s. Resolves true once one try succeeded. A failure changes nothing on screen: the film plays on.
 */
export function reportIntroComplete({
  fetcher,
  setTimer = (fn, ms) => setTimeout(fn, ms),
}: {
  fetcher: Fetcher;
  setTimer?: (fn: () => void, ms: number) => unknown;
}): Promise<boolean> {
  const once = () =>
    fetcher("/api/intro/complete", { method: "POST", credentials: "same-origin", keepalive: true }).then(
      (response) => response.ok,
      () => false,
    );
  return once().then((done) => {
    if (done) return true;
    return new Promise<boolean>((resolve) => {
      setTimer(() => void once().then(resolve), REPORT_RETRY_MS);
    });
  });
}
