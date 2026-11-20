import { isAuthPKCECodeVerifierMissingError } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { applySignInCookies, resolvePostSignIn } from "@/lib/auth/post-sign-in";
import { isSuspendedError } from "@/lib/platform/account-status";
import { createRouteSupabase } from "@/lib/supabase/route-client";

const MAX_CODE_LENGTH = 512;

const noStore = <T extends NextResponse>(response: T) => {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
};

/**
 * Finishes Google sign-in, sign-up confirmation and password-reset links: exchanges the one-time code
 * for a session (the session cookies ride on this redirect) and sends the user to the right page.
 */
export async function GET(request: NextRequest) {
  const { origin, searchParams } = request.nextUrl;
  const back = (reason: string) => noStore(NextResponse.redirect(new URL(`/signin?error=${reason}`, origin)));

  const providerError = searchParams.get("error");
  const errorCode = searchParams.get("error_code");
  if (providerError || errorCode) {
    // An account suspended in FITX Admin (banned in Supabase Auth) comes back with error_code=user_banned.
    if (isSuspendedError(searchParams)) return back("suspended");
    // Supabase reports an expired or reused e-mail link as access_denied + otp_expired.
    if (errorCode === "otp_expired") return back("expired");
    const description = searchParams.get("error_description") ?? "";
    if (providerError === "access_denied" || /cancel|denied/i.test(description)) return back("cancelled");
    return back("callback");
  }

  const code = searchParams.get("code");
  // Supabase's codes are short ids; anything else is not one and is never sent on.
  if (!code || code.length > MAX_CODE_LENGTH || !/^[A-Za-z0-9._~-]+$/.test(code)) return back("callback");
  const route = createRouteSupabase(request);
  if (!route) return noStore(NextResponse.redirect(new URL("/signin?setup=supabase", origin)));

  let exchanged: Awaited<ReturnType<typeof route.supabase.auth.exchangeCodeForSession>>;
  try {
    exchanged = await route.supabase.auth.exchangeCodeForSession(code);
  } catch (failure) {
    // An unreadable cookie or an unexpected answer: back to sign in, never an error page.
    console.warn("[fitx-auth] the sign-in code could not be exchanged", failure instanceof Error ? failure.name : "unknown");
    return route.applyTo(back("callback"));
  }
  const { data, error } = exchanged;
  if (error || !data.user) {
    if (isSuspendedError(error)) return route.applyTo(back("suspended"));
    // The code was opened in a different browser (or app) from the one that started sign-in.
    return route.applyTo(back(isAuthPKCECodeVerifierMissingError(error) ? "browser" : "callback"));
  }

  const result = await resolvePostSignIn({ supabase: route.supabase, userId: data.user.id, requestedNext: searchParams.get("next") });
  const response = NextResponse.redirect(new URL(result.destination, origin));
  applySignInCookies(response, { userId: data.user.id, onboarded: result.onboarded, intro: result.intro, secure: route.secure });
  return route.applyTo(noStore(response));
}
