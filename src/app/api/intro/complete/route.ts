import { NextResponse, type NextRequest } from "next/server";
import { hintCookieOptions, INTRO_COOKIE, isSecureRequest } from "@/lib/auth/cookies";
import { isSameOriginRequest } from "@/lib/auth/same-origin";
import { isMissingColumnError } from "@/lib/supabase/errors";
import { createRouteSupabase } from "@/lib/supabase/route-client";

/**
 * Called once the account's one-time intro film has started: remembers it on this device and on the
 * account, so signing in on another device doesn't play it again.
 */
export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return new NextResponse(null, { status: 403 });
  const response = new NextResponse(null, { status: 204 });
  response.headers.set("Cache-Control", "private, no-store");
  response.cookies.set(INTRO_COOKIE, "seen", hintCookieOptions(isSecureRequest(request)));

  const route = createRouteSupabase(request);
  if (!route) return response;
  const { data } = await route.supabase.auth.getClaims();
  const userId = typeof data?.claims?.sub === "string" ? data.claims.sub : null;
  if (userId) {
    const { error } = await route.supabase
      .from("profiles")
      .update({ intro_completed_at: new Date().toISOString() })
      .eq("id", userId)
      .is("intro_completed_at", null);
    if (error && !isMissingColumnError(error)) console.warn("FITX intro completion was not saved", error.code);
  }
  return route.applyTo(response);
}
