import { NextResponse, type NextRequest } from "next/server";
import { getAdminSiteOrigin } from "@/lib/site-origin";
import { readMembership } from "@/lib/admin-auth";
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
  if (!origin || !supabase) return signInRedirect(request, "configuration");

  const code = request.nextUrl.searchParams.get("code");
  if (!code) return signInRedirect(request, "oauth");

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) return signInRedirect(request, "oauth");

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    await supabase.auth.signOut();
    return signInRedirect(request, "oauth");
  }

  const membership = await readMembership(user.id);
  if (membership.state !== "ready") {
    await supabase.auth.signOut();
    return signInRedirect(request, membership.state);
  }

  return NextResponse.redirect(new URL("/overview", origin));
}
