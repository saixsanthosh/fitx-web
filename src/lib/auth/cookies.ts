import type { CookieOptions } from "@supabase/ssr";

/**
 * Small first-party cookies FITX sets next to the Supabase session cookies. None of them grants
 * access: the session cookies and RLS do. They only let static pages, the head script and the proxy
 * make the right choice without a round trip.
 */

/** "1" while a session cookie exists. Read before hydration to show "Open dashboard" instead of "Log in". */
export const AUTH_HINT_COOKIE = "fitx_auth";
/** The id of a user known to have finished onboarding, so the proxy can skip a profile query. httpOnly. */
export const ONBOARDED_COOKIE = "fitx_onboarded";
/**
 * The account's one-time intro film on this device: "play" until it starts, then "seen". The server
 * takes it from the account (profiles.intro_completed_at) at sign-in, and the proxy once per device and
 * account, on a full page load, for devices that were already signed in (INTRO_CHECKED_COOKIE).
 */
export const INTRO_COOKIE = "fitx_intro";
/**
 * The id of the user whose film state this device last took from the account, so the proxy reads it once
 * per device and account (again only for a second account on the same device), never more. httpOnly.
 */
export const INTRO_CHECKED_COOKIE = "fitx_intro_checked";

/**
 * "return" for two minutes after an onboarded account whose film was already seen signs in. The head script
 * (src/components/brand/introBootstrap.ts, RETURNING_WELCOME_COOKIE in introKeys.ts) reads and clears it on the
 * next full app-page load and plays the short returning-login logo reveal instead of the plain loader. Readable by
 * page scripts on purpose; it grants nothing.
 */
export const WELCOME_COOKIE = "fitx_welcome";
export const WELCOME_VALUE = "return";
/** Long enough to cover the redirect and the first app page, short enough never to replay on a later visit. */
export const WELCOME_MAX_AGE = 120;

/**
 * One word FITX leaves for the sign-in page just before it sends this browser there, naming what FITX itself just did:
 * after Sign out everywhere (LogoutButton), "everywhere" once Auth confirmed it or "ended" when this device's session was
 * already over. The page says either only with this cookie, reads it once and removes it
 * (src/lib/auth/address-messages.ts): a link can carry any address, but it can't set FITX's cookies. Only the sign-in
 * page sees it (its path), readable by page scripts on purpose; it grants nothing. Two minutes, like WELCOME_COOKIE: long
 * enough for the page to load, never long enough for a later visit.
 */
export const NOTICE_PROOF_COOKIE = "fitx_signin_notice";
export const NOTICE_PROOF_MAX_AGE = 120;

export function noticeProofCookieOptions(secure: boolean): CookieOptions {
  return { path: "/signin", sameSite: "lax", secure, httpOnly: false, maxAge: NOTICE_PROOF_MAX_AGE };
}

/** Browsers cap cookie lifetimes at 400 days. */
export const LONG_MAX_AGE = 400 * 24 * 60 * 60;
/**
 * A pending "play" expires after a day, so a sign-in the user walked away from doesn't replay the film weeks
 * later on a stale cookie. A device left without the cookie then (also one with reduced motion, which never
 * plays it) is told "seen" by the proxy, without asking the account again (src/proxy.ts).
 */
export const INTRO_PLAY_MAX_AGE = 24 * 60 * 60;

/** Supabase session cookies (`sb-<project>-auth-token`, split into `.0`, `.1`… when large). */
export const SESSION_COOKIE_RE = /^sb-[a-z0-9-]+-auth-token(?:\.\d+)?$/;

/** True when the visitor reached the site over HTTPS (Vercel terminates TLS and forwards the scheme). */
export function isSecureRequest(request: { headers: { get(name: string): string | null }; nextUrl: { protocol: string } }) {
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return forwarded ? forwarded === "https" : request.nextUrl.protocol === "https:";
}

/** Options for the Supabase session cookies; @supabase/ssr adds its own 400-day max-age. */
export function sessionCookieOptions(secure: boolean): CookieOptions {
  return { path: "/", sameSite: "lax", secure };
}

export function hintCookieOptions(
  secure: boolean,
  { httpOnly = false, maxAge = LONG_MAX_AGE }: { httpOnly?: boolean; maxAge?: number } = {},
): CookieOptions {
  return { path: "/", sameSite: "lax", secure, httpOnly, maxAge };
}

/** Options for INTRO_COOKIE, the same at sign-in and in the proxy: a pending "play" lasts a day. */
export function introCookieOptions(secure: boolean, intro: "play" | "seen"): CookieOptions {
  return hintCookieOptions(secure, intro === "play" ? { maxAge: INTRO_PLAY_MAX_AGE } : {});
}
