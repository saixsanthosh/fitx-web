import { NextResponse, type NextRequest } from "next/server";
import { logAdminEvent } from "@/lib/audit";
import { signOutLocally } from "@/lib/sign-out";
import { getAdminSiteOrigin } from "@/lib/site-origin";
import { createUserSupabase } from "@/lib/supabase/server";

/**
 * An Admin session older than the maximum age (src/lib/session-policy.ts) comes here from any page.
 * Pages cannot change cookies while rendering, so this route ends the session (this browser only)
 * and sends the person back to sign in.
 */
export async function GET(request: NextRequest) {
  const supabase = await createUserSupabase();
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;
  if (user) await logAdminEvent({ actorId: user.id, action: "admin_session_expired", resourceType: "admin_session" });
  await signOutLocally(supabase);
  const url = new URL("/signin", getAdminSiteOrigin() ?? request.nextUrl.origin);
  url.searchParams.set("error", "session_expired");
  return NextResponse.redirect(url);
}
