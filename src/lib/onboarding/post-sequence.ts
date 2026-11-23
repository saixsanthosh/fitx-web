/**
 * Which steps play after onboarding (no React, so it runs under `node --test`).
 *
 * The steps are [film, logo]. When the device still owes the account its one-time intro film (cookie
 * `fitx_intro=play`), both are skipped: that film plays on the first dashboard load and ends on the logo, so the
 * member never sees two films or two logo reveals in a row. Otherwise the post-onboarding film plays when one
 * exists (wave 2), then the logo reveal.
 */
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
  if (readCookie(cookies, INTRO_COOKIE_NAME) === "play") return [];
  return hasFilm ? ["film", "logo"] : ["logo"];
}

/** How long the logo step holds before moving on: the mark's formation plus a beat (static with reduced motion). */
export function logoHoldMs(reduced: boolean): number {
  return reduced ? 600 : 2100;
}
