/**
 * Which steps play after onboarding (no React, so it runs under `node --test`).
 *
 * D1 (BRIEF-2 section 0), live since S6's welcome cuts shipped (release 2b; dormant in a build without them):
 *  - with the welcome film (`hasFilm`: its manifest exists), just ["film"], whatever the cookie says: the film ends on
 *    the logo (LogoReveal "film-end"), so there are never two logo reveals in a row, and it records itself (the seen
 *    flag and /api/intro/complete), so the dashboard does not play the account's intro film after it;
 *  - without it, exactly what wave 1 did: nothing when the device still owes the account its one-time intro film
 *    (cookie `fitx_intro=play`; that film plays on the first dashboard load and ends on the logo), else the logo.
 */
import { FILM_HANDOFF_KEY } from "@/components/brand/introKeys";

export type PostStep = "film" | "logo";

export const INTRO_COOKIE_NAME = "fitx_intro";

/** The value of cookie `name` in a `document.cookie` string, or null. */
export function readCookie(cookies: string, name: string): string | null {
  for (const part of cookies.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {
      try {
        return decodeURIComponent(rest.join("="));
      } catch {
        return rest.join("=");
      }
    }
  }
  return null;
}

export function postOnboardingSteps({ cookies, hasFilm }: { cookies: string; hasFilm: boolean }): PostStep[] {
  if (hasFilm) return ["film"];
  if (readCookie(cookies, INTRO_COOKIE_NAME) === "play") return [];
  return ["logo"];
}

/**
 * The sequence ended on the FITX logo (the welcome film's end, or the logo step): Home's page load, which follows at
 * once in this tab, opens without the brand loader (introBootstrap.ts reads and removes FILM_HANDOFF_KEY), so two logos
 * never play in a row (D1). Session storage: only this tab's next page load counts. Blocked storage: the loader shows.
 */
export function markFilmHandoff(storage: Pick<Storage, "setItem"> | null, now: number = Date.now()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(FILM_HANDOFF_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}

/** How long the logo step holds before moving on: the mark's formation plus a beat (static with reduced motion). */
export function logoHoldMs(reduced: boolean): number {
  return reduced ? 600 : 2100;
}
