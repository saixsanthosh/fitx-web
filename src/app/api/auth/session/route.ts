import { NextResponse, type NextRequest } from "next/server";
import { LONG_MAX_AGE, SESSION_COOKIE_RE, sessionCookieOptions } from "@/lib/auth/cookies";
import { applySignInCookies, resolvePostSignIn } from "@/lib/auth/post-sign-in";
import { isSameOriginRequest } from "@/lib/auth/same-origin";
import { createRouteSupabase } from "@/lib/supabase/route-client";

const json = (body: unknown, status = 200) => {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
};

/**
 * Keeps browser sign-ins as durable as server ones.
 *  - Every call re-sends the current Supabase session cookies from the server. Safari limits cookies
 *    written by page scripts to seven days; written by the server they last as long as the session.
 *  - `{ intent: "sign-in", next }`, sent right after a password sign-in or sign-up, also sets the hint
 *    cookies and returns where to go, exactly as the OAuth callback does.
 */
export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return json({ error: "forbidden" }, 403);
  const route = createRouteSupabase(request);
  if (!route) return json({ error: "unavailable" }, 503);

  let body: { intent?: unknown; next?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const restamp = (response: NextResponse) => {
    for (const cookie of request.cookies.getAll()) {
      if (SESSION_COOKIE_RE.test(cookie.name)) {
        response.cookies.set(cookie.name, cookie.value, { ...sessionCookieOptions(route.secure), maxAge: LONG_MAX_AGE });
      }
    }
    return response;
  };

  // Only a session that still verifies is re-sent (a request racing a sign-out must not revive it).
  const { data } = await route.supabase.auth.getClaims();
  const userId = typeof data?.claims?.sub === "string" ? data.claims.sub : null;
  if (!userId) return route.applyTo(json({ error: "signed_out" }, 401));
  if (body.intent !== "sign-in") return route.applyTo(restamp(json({ ok: true })));

  const result = await resolvePostSignIn({
    supabase: route.supabase,
    userId,
    requestedNext: typeof body.next === "string" ? body.next : null,
  });
  const response = restamp(json({ destination: result.destination }));
  applySignInCookies(response, { userId, onboarded: result.onboarded, intro: result.intro, secure: route.secure });
  return route.applyTo(response);
}
