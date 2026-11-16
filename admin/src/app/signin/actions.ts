"use server";

import { redirect } from "next/navigation";
import { getAdminSiteOrigin } from "@/lib/site-origin";
import { createUserSupabase } from "@/lib/supabase/server";

export type SignInError = "invalid_email" | "not_authorized" | "setup_pending" | "configuration" | "oauth";
export type SignInState = { error?: SignInError } | null;

function isAllowedAdminEmail(email: string) {
  const allowlist = process.env.FITX_ADMIN_ALLOWED_EMAILS ?? "";
  return allowlist.trim() ? allowlist.split(",").some((entry) => entry.trim().toLowerCase() === email) : null;
}

export async function beginGoogleSignIn(_previous: SignInState, formData: FormData): Promise<SignInState> {
  const submitted = formData.get("email");
  const email = typeof submitted === "string" ? submitted.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "invalid_email" };

  const allowlisted = isAllowedAdminEmail(email);
  if (allowlisted === null) return { error: "configuration" };
  if (!allowlisted) return { error: "not_authorized" };

  const origin = getAdminSiteOrigin();
  const supabase = await createUserSupabase();
  if (!origin || !supabase) return { error: "configuration" };

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback`,
      queryParams: { login_hint: email, prompt: "select_account" },
    },
  });

  if (error || !data.url) return { error: "oauth" };
  redirect(data.url);
}

export async function signOut() {
  "use server";
  const supabase = await createUserSupabase();
  if (supabase) await supabase.auth.signOut();
  redirect("/signin");
}
