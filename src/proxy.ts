import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { isAuthRetryableFetchError, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import {
  AUTH_HINT_COOKIE,
  hintCookieOptions,
  INTRO_COOKIE,
  isSecureRequest,
  ONBOARDED_COOKIE,
  sessionCookieOptions,
} from "@/lib/auth/cookies";
import { openBeforeOnboarding } from "@/lib/auth/before-onboarding";
import { safeNext } from "@/lib/auth/safe-next";
import { canonicalOrigin } from "@/lib/site-url";

/** Signed-in areas. Everything else (marketing, legal, sign-in pages) is public. */
const PRIVATE_ROOTS = [
  "/dashboard", "/workouts", "/nutrition", "/activity", "/progress", "/goals", "/planner", "/profile", "/settings", "/help",
  "/exercises", "/form-coach", "/onboarding", "/achievements", "/ai-coach", "/subscription", "/tasks", "/social", "/admin",
];
const AUTH_ENTRY = new Set(["/signin", "/signup", "/forgot-password"]);
/** Parameters Supabase Auth appends when it sends a browser back after sign-in or an e-mail link. */
const AUTH_PARAMS = ["code", "error", "error_code", "error_description"] as const;
const SESSION_CHECK_TIMEOUT_MS = 3000;
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
 *     onboarding and Help.
 * Checks are optimistic (data stays protected by row-level security); a Supabase outage never
 * signs anyone out here.
 */
export async function proxy(request: NextRequest) {
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
  const claims = await Promise.race([
    supabase.auth.getClaims(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), SESSION_CHECK_TIMEOUT_MS)),
  ]);
  if (claims === null) return finish(response);
  const { data, error } = claims;
  const userId = typeof data?.claims?.sub === "string" ? data.claims.sub : null;
  if (!userId && error && (isAuthRetryableFetchError(error) || (typeof error.status === "number" && error.status >= 500))) {
    return finish(response);
  }

  const hinted = request.cookies.get(AUTH_HINT_COOKIE)?.value === "1";
  if (userId && !hinted) hints.push([AUTH_HINT_COOKIE, "1", hintCookieOptions(secure)]);
  if (!userId && hinted) hints.push([AUTH_HINT_COOKIE, "", hintCookieOptions(secure, { maxAge: 0 })]);
  if (!userId && request.cookies.has(ONBOARDED_COOKIE)) {
    hints.push([ONBOARDED_COOKIE, "", hintCookieOptions(secure, { httpOnly: true, maxAge: 0 })]);
  }
  // Accounts signed in before the film became once-per-account have already seen it: from now on this
  // device gets the short brand loader on cold loads.
  if (userId && !request.cookies.has(INTRO_COOKIE)) hints.push([INTRO_COOKIE, "seen", hintCookieOptions(secure)]);

  if (!userId) {
    if (!isPrivate(pathname)) return finish(response);
    return redirect(`/signin?next=${encodeURIComponent(safeNext(`${pathname}${search}`))}`);
  }

  const isHome = pathname === "/";
  if (!isHome && !isPrivate(pathname) && !AUTH_ENTRY.has(pathname)) return finish(response);

  const onboarded = await readOnboarded(request, supabase, userId, hints, secure);
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

/** True/false from the onboarded cookie or the profile; null when the profile can't be read right now. */
async function readOnboarded(
  request: NextRequest,
  supabase: SupabaseClient,
  userId: string,
  hints: Array<[string, string, CookieOptions]>,
  secure: boolean,
): Promise<boolean | null> {
  if (request.cookies.get(ONBOARDED_COOKIE)?.value === userId) return true;
  const { data, error } = await supabase.from("profiles").select("onboarded").eq("id", userId).maybeSingle();
  if (error) return null;
  const onboarded = Boolean((data as { onboarded?: boolean } | null)?.onboarded);
  if (onboarded) hints.push([ONBOARDED_COOKIE, userId, hintCookieOptions(secure, { httpOnly: true })]);
  return onboarded;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|api/|favicon\\.ico|icon\\.svg|apple-icon|manifest\\.webmanifest|robots\\.txt|sitemap\\.xml|opengraph-image|twitter-image|brand/|images/|models/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|mp4|webm|woff2?|txt|xml|json|map)$).*)",
  ],
};
