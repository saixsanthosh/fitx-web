/** Names the intro's head script (introBootstrap.ts) shares with the app's intro components. */

/**
 * Dispatched on `window` whenever the head script marks a film pending. A tab that loaded hidden (opened in
 * the background, or prerendered) does that only when it is first shown, after the app has started, so
 * CinematicIntro and IntroCompletionReporter listen for it.
 */
export const INTRO_PENDING_EVENT = "fitx:intro:pending";

/**
 * localStorage: "1" once this device has played the signed-out visitor's film (or it was skipped), so that film
 * plays once per device, for first-time visitors only (owner, 2026-11-22; until then it was once per tab, in
 * sessionStorage). The key is the old site's. Replay (?intro=…) still plays it on request.
 */
export const VISITOR_FILM_SEEN_KEY = "fitx-cinematic-seen";

/**
 * localStorage: when this device last opened an account's one-time film, in ms since the epoch with a random
 * fraction that makes each page's claim unique. It is forgotten on the next signed-out page load. See
 * introBootstrap.ts and accountFilm.ts.
 */
export const ACCOUNT_FILM_STARTED_KEY = "fitx-intro-account";

/**
 * Cookie set at sign-in (by the auth code, as WELCOME_COOKIE in src/lib/auth/cookies.ts) to "return" for an
 * onboarded account whose film has been seen. The head script consumes it on the next full app-page load and plays
 * the logo reveal (ReturningLogin) instead of the plain brand loader. Kept here as its own constant; each side
 * tests the literal value.
 */
export const RETURNING_WELCOME_COOKIE = "fitx_welcome";
