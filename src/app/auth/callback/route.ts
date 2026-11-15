import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function safeNext(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/dashboard";
  const parsed = new URL(value, "https://fitx.invalid");
  if (parsed.origin !== "https://fitx.invalid" || parsed.pathname.startsWith("/auth/") || parsed.pathname === "/signin") return "/dashboard";
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const providerError = searchParams.get("error");
  if (providerError) {
    const cancelled = providerError === "access_denied" || /cancel|denied/i.test(searchParams.get("error_description") ?? "");
    return NextResponse.redirect(new URL(`/signin?error=${cancelled ? "cancelled" : "callback"}`, origin));
  }
  if (!code) return NextResponse.redirect(new URL("/signin?error=callback", origin));
  const supabase = await createClient();
  if (!supabase) return NextResponse.redirect(new URL("/signin?setup=supabase", origin));
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL("/signin?error=callback", origin));
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/signin?error=callback", origin));
  const { data: profile } = await supabase.from("profiles").select("onboarded").eq("id", user.id).maybeSingle();
  const destination = profile?.onboarded ? safeNext(searchParams.get("next")) : "/onboarding";
  return NextResponse.redirect(new URL(destination, origin));
}
