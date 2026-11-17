import { NextResponse, type NextRequest } from "next/server";
import { logAdminEvent } from "@/lib/audit";
import { evaluateAdminSession } from "@/lib/session-policy";
import { signOutLocally } from "@/lib/sign-out";
import { getAdminSiteOrigin } from "@/lib/site-origin";
import { createUserSupabase } from "@/lib/supabase/server";

/**
 * An Admin session older than the maximum age (src/lib/session-policy.ts) comes here from any page.
 * Pages cannot change cookies while rendering, so this route ends the session (this browser only)
 * and sends the person back to sign in. It checks the age again itself, so a link to this address
 * from anywhere else neither signs anyone out nor records an expiry that did not happen.
 */
export async function GET(request: NextRequest) {
  const origin = getAdminSiteOrigin() ?? request.nextUrl.origin;
  const supabase = await createUserSupabase();
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;
  if (!supabase || !user) return NextResponse.redirect(new URL("/signin", origin));

  // getClaims verifies the access token before its claims are trusted; an unusable token signs in again.
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claimsData) return NextResponse.redirect(new URL("/signin", origin));
  const claims = claimsData.claims as unknown as Record<string, unknown>;
  const decision = evaluateAdminSession({
    aal: claims.aal,
    amr: claims.amr,
    issuedAt: claims.iat,
    hasVerifiedFactor: true,
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  if (decision.state !== "expired") return NextResponse.redirect(new URL("/overview", origin));

  await logAdminEvent({ actorId: user.id, action: "admin_session_expired", resourceType: "admin_session" });
  await signOutLocally(supabase);
  const url = new URL("/signin", origin);
  url.searchParams.set("error", "session_expired");
  return NextResponse.redirect(url);
}
