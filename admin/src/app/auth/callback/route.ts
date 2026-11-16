import { NextResponse, type NextRequest } from "next/server";
import { allowlistRefusalReason, checkAdminAllowlist, readMembership } from "@/lib/admin-auth";
import { logAdminEvent } from "@/lib/audit";
import { logServerError, logServerWarning } from "@/lib/log";
import { signOutLocally } from "@/lib/sign-out";
import { getAdminSiteOrigin } from "@/lib/site-origin";
import { createUserSupabase } from "@/lib/supabase/server";

function signInRedirect(request: NextRequest, state: string) {
  const origin = getAdminSiteOrigin() ?? request.nextUrl.origin;
  const url = new URL("/signin", origin);
  url.searchParams.set("error", state);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const origin = getAdminSiteOrigin();
  const supabase = await createUserSupabase();
  if (!origin || !supabase) {
    logServerWarning("auth.callback", !origin ? "ADMIN_SITE_URL is missing or invalid" : "the public Supabase URL or publishable key is missing");
    return signInRedirect(request, "configuration");
  }

  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    const providerError = (request.nextUrl.searchParams.get("error_code") ?? request.nextUrl.searchParams.get("error") ?? "")
      .replace(/[^\w.-]/g, "")
      .slice(0, 60);
    logServerWarning("auth.callback", `no authorization code was returned${providerError ? ` (${providerError})` : ""}`);
    return signInRedirect(request, "oauth");
  }

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    logServerError("auth.exchange_code", exchangeError);
    return signInRedirect(request, "oauth");
  }

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    logServerError("auth.get_user", userError);
    await signOutLocally(supabase);
    return signInRedirect(request, "oauth");
  }

  // The allowlist is checked against the Google account that was actually used,
  // not the email typed on the sign-in form. Every refusal signs out locally only.
  const allowlist = checkAdminAllowlist(user, "auth.callback");
  if (allowlist.state !== "ready") {
    await logAdminEvent({ actorId: user.id, action: "admin_sign_in_denied", resourceType: "admin_session", details: { reason: allowlistRefusalReason(user) } });
    await signOutLocally(supabase);
    return signInRedirect(request, allowlist.state);
  }

  const membership = await readMembership(user.id);
  if (membership.state !== "ready") {
    await logAdminEvent({ actorId: user.id, action: "admin_sign_in_denied", resourceType: "admin_session", details: { reason: membership.state } });
    await signOutLocally(supabase);
    return signInRedirect(request, membership.state);
  }

  // The session is AAL1 here; every console page then asks for the authenticator code (AAL2).
  await logAdminEvent({ actorId: user.id, action: "admin_sign_in", resourceType: "admin_session", details: { role: membership.membership.role } });
  return NextResponse.redirect(new URL("/overview", origin));
}
