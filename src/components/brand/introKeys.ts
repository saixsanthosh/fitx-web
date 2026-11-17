/** Names the intro's head script (introBootstrap.ts) shares with the app's intro components. */

/**
 * Dispatched on `window` whenever the head script marks a film pending. A tab that loaded hidden (opened in
 * the background, or prerendered) does that only when it is first shown, after the app has started, so
 * CinematicIntro and IntroCompletionReporter listen for it.
 */
export const INTRO_PENDING_EVENT = "fitx:intro:pending";

/**
 * sessionStorage: "1" once this tab has played the signed-out visitor's film (or it was skipped), so that
 * film plays once per tab, as on the old site. The key is the old site's.
 */
export const VISITOR_FILM_SEEN_KEY = "fitx-cinematic-seen";

/**
 * localStorage: when this device last opened an account's one-time film, in ms since the epoch with a random
 * fraction that makes each page's claim unique. It is forgotten on the next signed-out page load. See
 * introBootstrap.ts and accountFilm.ts.
 */
export const ACCOUNT_FILM_STARTED_KEY = "fitx-intro-account";
