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

/**
 * localStorage: when the welcome film (or its reduced-motion or reveal-only stand-in) started on this device, as an
 * ISO time (D1). The account gate skips the film for FILM_SEEN_MS after it, so a failed /api/intro/complete never
 * replays it on /dashboard, and IntroCompletionReporter retries that call while the device still says "play". It is
 * the signed-in session's, not the device's: Log out and the next signed-out page load forget it (introBootstrap.ts,
 * src/lib/account/device-cleanup.ts), so the next account on the device gets its own film.
 */
export const FILM_SEEN_KEY = "fitx-film-seen";

export const FILM_SEEN_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * sessionStorage: when the sequence after onboarding (PostOnboardingSequence: the welcome film, or its logo) ended on
 * the FITX logo in this tab, as ms since the epoch. Home's full page load follows at once, and its head script reads
 * and removes this, then shows neither the brand loader nor the returning sign-in's logo: two logos never play in a
 * row (D1, the owner's "after the logo, straight to Home"). A key older than FILM_HANDOFF_MS is removed and ignored.
 */
export const FILM_HANDOFF_KEY = "fitx-film-handoff";

export const FILM_HANDOFF_MS = 60 * 1000;

/**
 * Window event that replays a film: `detail?: { film?: "intro" | "welcome" }`; no detail means the intro.
 * Dispatched by IntroReplayControl, handled by CinematicIntro.
 */
export const REPLAY_EVENT = "fitx:intro:replay";

/** CSS custom property on <html> holding `url("<poster>")` of the film being opened (introBootstrap.ts, CinematicIntro). */
export const FILM_POSTER_VAR = "--fitx-film-poster";
