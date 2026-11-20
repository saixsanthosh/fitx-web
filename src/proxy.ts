import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { isAuthRetryableFetchError, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import {
  AUTH_HINT_COOKIE,
  hintCookieOptions,
  INTRO_CHECKED_COOKIE,
  INTRO_COOKIE,
  introCookieOptions,
  isSecureRequest,
  ONBOARDED_COOKIE,
  SESSION_COOKIE_RE,
  sessionCookieOptions,
} from "@/lib/auth/cookies";
import { openBeforeOnboarding } from "@/lib/auth/before-onboarding";
import { safeNext } from "@/lib/auth/safe-next";
import { platformGate } from "@/lib/platform/gate";
import { canonicalOrigin } from "@/lib/site-url";
import { isMissingColumnError } from "@/lib/supabase/errors";

/** Signed-in areas. Everything else (marketing, legal, sign-in pages) is public. */
const PRIVATE_ROOTS = [
  "/dashboard", "/workouts", "/nutrition", "/activity", "/progress", "/goals", "/planner", "/profile", "/settings", "/help",
  "/exercises", "/home-workout", "/form-coach", "/onboarding", "/achievements", "/ai-coach", "/subscription", "/tasks", "/social", "/admin",
  "/unavailable",
];
const AUTH_ENTRY = new Set(["/signin", "/signup", "/forgot-password"]);
/** Parameters Supabase Auth appends when it sends a browser back after sign-in or an e-mail link. */
const AUTH_PARAMS = ["code", "error", "error_code", "error_description"] as const;
const SESSION_CHECK_TIMEOUT_MS = 3000;
/** The profile read waits at most this long, and is never retried here (see readProfile). */
const PROFILE_READ_TIMEOUT_MS = 1500;
const AUTH_CODE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isPrivate = (pathname: string) => PRIVATE_ROOTS.some((root) => pathname === root || pathname.startsWith(`${root}/`));

const noStore = <T extends NextResponse>(response: T) => {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
};

/**
 * Routing before any page renders:
 *  1. one production host, so the sign-in verifier and session cookies always live on the same origin;
 *  2. auth results that Supabase delivered to the wrong path (its Site-URL fallback "/?code=…") are
 *     forwarded to /auth/callback instead of being dropped;
 *  3. the session is refreshed and every response, redirects included, carries the refreshed cookies;
 *  4. signed-in visitors skip the marketing home and the sign-in pages; signed-out visitors are sent
 *     to sign in from private pages; unfinished accounts go to onboarding from every page except
 *     onboarding and Help;
 *  5. a feature switched off in FITX Admin closes its pages and APIs for signed-in members
 *     (src/lib/platform/gate.ts): pages are rewritten to /unavailable, APIs answer 503;
 *  6. a device that was already signed in takes the account's one-time intro film from the account,
 *     once per device and account, on a full page load (readProfile), so it plays on the next full load
 *     of an app page.
 * Checks are optimistic (data stays protected by row-level security); a Supabase outage never
 * signs anyone out here. The proxy never fails a request: anything that throws (for example a session
 * cookie that is not a session) is answered by recoverFromFailure.
 */
export async function proxy(request: NextRequest) {
  try {
    return await routeRequest(request);
  } catch (error) {
    return recoverFromFailure(request, error);
  }
}

/**
 * Something in the proxy threw. The request carries on unchanged (pages and APIs check the session themselves, and
 * row-level security guards the data) rather than failing; the session is never cleared for an unknown failure.
 */
function recoverFromFailure(request: NextRequest, error: unknown) {
  console.warn("[fitx-proxy] routing skipped after an error", error instanceof Error ? error.name : "unknown");
  return NextResponse.next();
}

async function routeRequest(request: NextRequest) {
  const { pathname, search, searchParams } = request.nextUrl;

  const canonical = canonicalOrigin();
  const host = request.headers.get("host");
  if (canonical && host && host.endsWith(".vercel.app") && host !== new URL(canonical).host) {
    // Assign the path instead of resolving it, so a "//other.example" path stays a path on the canonical host.
    const target = new URL(canonical);
    target.pathname = pathname;
    target.search = search;
    return NextResponse.redirect(target, 307);
  }

  if (pathname.startsWith("/auth/")) return NextResponse.next();

  const code = searchParams.get("code");
  if ((code && AUTH_CODE_RE.test(code)) || searchParams.has("error_description")) {
    const target = new URL("/auth/callback", request.url);
    for (const key of AUTH_PARAMS) {
      const value = searchParams.get(key);
      if (value) target.searchParams.set(key, value);
    }
    const rest = new URL(request.url);
    for (const key of AUTH_PARAMS) rest.searchParams.delete(key);
    if (pathname !== "/") target.searchParams.set("next", safeNext(`${rest.pathname}${rest.search}`));
    return noStore(NextResponse.redirect(target, 307));
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    if (!isPrivate(pathname)) return NextResponse.next();
    const signIn = new URL("/signin", request.url);
    signIn.searchParams.set("setup", "supabase");
    return NextResponse.redirect(signIn);
  }

  const secure = isSecureRequest(request);
  let response = NextResponse.next({ request });
  let cacheHeaders: Record<string, string> = {};
  const supabase = createServerClient(url, key, {
    cookieOptions: sessionCookieOptions(secure),
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        cacheHeaders = { ...cacheHeaders, ...headers };
      },
    },
  });

  // Hint cookies are applied last because a session refresh may replace `response`.
  const hints: Array<[string, string, CookieOptions]> = [];
  const finish = (result: NextResponse) => {
    if (result !== response) for (const cookie of response.cookies.getAll()) result.cookies.set(cookie);
    for (const [name, value, options] of hints) result.cookies.set(name, value, options);
    for (const [header, value] of Object.entries(cacheHeaders)) result.headers.set(header, value);
    return result;
  };
  const redirect = (to: string) => {
    const target = new URL(to, request.url);
    // Never leave this site, whatever a ?next= resolved to.
    return finish(NextResponse.redirect(target.origin === request.nextUrl.origin ? target : new URL("/dashboard", request.url)));
  };

  // An Auth outage must not hold every page for the client's full retry budget (~25 s).
  let userId: string | null = null;
  try {
    const claims = await Promise.race([
      supabase.auth.getClaims(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), SESSION_CHECK_TIMEOUT_MS)),
    ]);
    if (claims === null) return finish(response);
    const { data, error } = claims;
    userId = typeof data?.claims?.sub === "string" ? data.claims.sub : null;
    if (!userId && error && (isAuthRetryableFetchError(error) || (typeof error.status === "number" && error.status >= 500))) {
      return finish(response);
    }
  } catch {
    // A session cookie that is not a session (edited, truncated or from another app): the device is signed out
    // instead of every page failing until the cookie is cleared by hand.
    const unreadable = request.cookies.getAll().filter((cookie) => SESSION_COOKIE_RE.test(cookie.name)).map((cookie) => cookie.name);
    for (const name of unreadable) request.cookies.delete(name);
    response = NextResponse.next({ request });
    for (const name of unreadable) response.cookies.set(name, "", { ...sessionCookieOptions(secure), maxAge: 0 });
  }

  const hinted = request.cookies.get(AUTH_HINT_COOKIE)?.value === "1";
  if (userId && !hinted) hints.push([AUTH_HINT_COOKIE, "1", hintCookieOptions(secure)]);
  if (!userId && hinted) hints.push([AUTH_HINT_COOKIE, "", hintCookieOptions(secure, { maxAge: 0 })]);

  if (!userId) {
    // Signed out: the device forgets which account it belonged to (the film's own state, fitx_intro, stays).
    for (const name of [ONBOARDED_COOKIE, INTRO_CHECKED_COOKIE]) {
      if (request.cookies.has(name)) hints.push([name, "", hintCookieOptions(secure, { httpOnly: true, maxAge: 0 })]);
    }
    if (!isPrivate(pathname)) return finish(response);
    return redirect(`/signin?next=${encodeURIComponent(safeNext(`${pathname}${search}`))}`);
  }

  const gated = await platformGate(request);
  if (gated) {
    // A rewrite renders /unavailable in this request, so it needs the refreshed session cookies the way
    // NextResponse.next({ request }) carries them.
    if (gated.headers.has("x-middleware-rewrite")) {
      for (const [header, value] of response.headers) {
        if (header === "x-middleware-override-headers" || header.startsWith("x-middleware-request-")) gated.headers.set(header, value);
      }
    }
    return finish(gated);
  }

  const isHome = pathname === "/";
  if (!isHome && !isPrivate(pathname) && !AUTH_ENTRY.has(pathname)) return finish(response);

  const onboarded = await readProfile(request, supabase, userId, hints, secure);
  if (onboarded === null) return finish(response);
  // An account still in setup may open onboarding and Help only (src/lib/auth/before-onboarding.ts).
  if (!onboarded) return openBeforeOnboarding(pathname) ? finish(response) : redirect("/onboarding");
  if (isHome) {
    const intro = searchParams.get("intro");
    return redirect(intro ? `/dashboard?intro=${encodeURIComponent(intro)}` : "/dashboard");
  }
  if (pathname === "/onboarding") return redirect("/dashboard");
  if (AUTH_ENTRY.has(pathname)) return redirect(safeNext(searchParams.get("next")));
  return finish(response);
}

type ProfileRow = { onboarded?: boolean | null; intro_completed_at?: string | null } | null;

/**
 * A full load of a page (its HTML), whose head script can play the film at once. The app's own fetches of
 * a page (client-side navigation, prefetch) say `Sec-Fetch-Dest: empty`; Next strips only its own Flight
 * headers before the proxy. A browser that sends no Fetch Metadata counts as a full load.
 */
function isPageLoad(request: NextRequest) {
  const destination = request.headers.get("sec-fetch-dest");
  return destination === null || destination === "document";
}

/**
 * What the proxy needs from the profile, answered by cookies where they can and otherwise by one profile
 * query at most:
 *  - onboarding: true/false from the onboarded cookie or the profile; null when the profile can't be read
 *    right now;
 *  - the account's one-time intro film on this device, taken from the account once per device and account
 *    (fitx_intro_checked holds the user it was taken for), on a full page load: fitx_intro=play for a day
 *    (as at sign-in) when the account has not seen the film (intro_completed_at null), else seen (also
 *    while the column doesn't exist yet). So a device that was already signed in plays the film on its
 *    next full load of an app page, and a second account on the device is checked for itself. A device
 *    checked for this user is never asked about again: if it no longer holds fitx_intro (a "play" left
 *    unused for a day, as with reduced motion, or a cookie the browser dropped), it is told seen without a
 *    query, as before the check existed. A failed read sets nothing from it, and a later page load tries
 *    again. Never a loop: the completion route sets intro_completed_at as soon as the film starts, so every
 *    later check says seen.
 * The read is bounded like the Auth check, and not retried: an outage of the database API must not hold
 * every page (postgrest-js would otherwise retry a GET three times, for 7 seconds), and the next page asks
 * again anyway.
 */
async function readProfile(
  request: NextRequest,
  supabase: SupabaseClient,
  userId: string,
  hints: Array<[string, string, CookieOptions]>,
  secure: boolean,
): Promise<boolean | null> {
  const knownOnboarded = request.cookies.get(ONBOARDED_COOKIE)?.value === userId;
  const checked = request.cookies.get(INTRO_CHECKED_COOKIE)?.value === userId;
  if (checked && !request.cookies.has(INTRO_COOKIE)) hints.push([INTRO_COOKIE, "seen", introCookieOptions(secure, "seen")]);
  const askIntro = !checked && isPageLoad(request);
  if (knownOnboarded && !askIntro) return true;
  const columns = [knownOnboarded ? "" : "onboarded", askIntro ? "intro_completed_at" : ""].filter(Boolean).join(", ");
  const { data, error } = await supabase
    .from("profiles")
    .select(columns)
    .eq("id", userId)
    .abortSignal(AbortSignal.timeout(PROFILE_READ_TIMEOUT_MS))
    .retry(false)
    .maybeSingle();
  const introMissing = askIntro && error !== null && isMissingColumnError(error);
  if (error && !introMissing) return knownOnboarded ? true : null;
  const row = error ? null : (data as ProfileRow);
  if (askIntro) {
    const intro = introMissing || row?.intro_completed_at ? "seen" : "play";
    hints.push([INTRO_COOKIE, intro, introCookieOptions(secure, intro)]);
    hints.push([INTRO_CHECKED_COOKIE, userId, hintCookieOptions(secure, { httpOnly: true })]);
  }
  if (knownOnboarded) return true;
  // The missing intro column failed the query before onboarding was read: the next request reads it.
  if (error) return null;
  const onboarded = Boolean(row?.onboarded);
  if (onboarded) hints.push([ONBOARDED_COOKIE, userId, hintCookieOptions(secure, { httpOnly: true })]);
  return onboarded;
}

export const config = {
  matcher: [
    // The APIs a platform switch can close (FEATURE_ROUTES in src/lib/platform/settings.ts); other APIs skip the proxy.
    "/api/coach/:path*",
    "/api/billing/checkout/:path*",
    "/api/support/:path*",
    "/((?!_next/static|_next/image|api/|favicon\\.ico|icon\\.svg|apple-icon|manifest\\.webmanifest|robots\\.txt|sitemap\\.xml|opengraph-image|twitter-image|brand/|images/|models/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|mp4|webm|woff2?|txt|xml|json|map)$).*)",
  ],
};
