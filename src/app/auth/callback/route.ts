import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function safeNext(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/dashboard";
  return value;
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/signin?error=auth", origin));
  const supabase = await createClient();
  if (!supabase) return NextResponse.redirect(new URL("/signin?setup=supabase", origin));
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL("/signin?error=auth", origin));
  return NextResponse.redirect(new URL(safeNext(searchParams.get("next")), origin));
}
