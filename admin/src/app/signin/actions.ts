"use server";

import { redirect } from "next/navigation";
import { normaliseEmail, parseAllowlist } from "@/lib/admin-email";
import { logAdminEvent } from "@/lib/audit";
import { logServerError, logServerWarning } from "@/lib/log";
import { signOutLocally } from "@/lib/sign-out";
import { getAdminSiteOrigin } from "@/lib/site-origin";
import { hasAdminServerKey } from "@/lib/supabase/admin";
import { createUserSupabase } from "@/lib/supabase/server";

export type SignInError =
  | "invalid_email"
  | "not_authorized"
  | "setup_pending"
  | "configuration"
  | "service_key_missing"
  | "oauth"
  | "session_expired";
export type SignInState = { error?: SignInError } | null;

/**
 * Starts Google sign-in. The typed email is only a hint for Google's account picker:
 * every valid email gets the same response, so the form never reveals who is on the
 * allowlist. The callback checks the Google account that was actually used.
 */
export async function beginGoogleSignIn(_previous: SignInState, formData: FormData): Promise<SignInState> {
  const email = normaliseEmail(formData.get("email"));
  if (!email) return { error: "invalid_email" };

  const origin = getAdminSiteOrigin();
  const supabase = await createUserSupabase();
  if (!origin || !supabase) {
    logServerWarning("auth.sign_in", !origin ? "ADMIN_SITE_URL is missing or invalid" : "the public Supabase URL or publishable key is missing");
    return { error: "configuration" };
  }
  if (!parseAllowlist(process.env.FITX_ADMIN_ALLOWED_EMAILS).size) {
    logServerWarning("auth.sign_in", "FITX_ADMIN_ALLOWED_EMAILS is empty");
    return { error: "configuration" };
  }
  if (!hasAdminServerKey()) {
    logServerWarning("auth.sign_in", "SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) is not set");
    return { error: "service_key_missing" };
  }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback`,
      queryParams: { login_hint: email, prompt: "select_account" },
    },
  });

  if (error || !data.url) {
    logServerError("auth.sign_in", error);
    return { error: "oauth" };
  }
  redirect(data.url);
}

/** Signs out of this Admin browser session only; FITX sessions elsewhere stay signed in. */
export async function signOut() {
  const supabase = await createUserSupabase();
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;
  if (user) await logAdminEvent({ actorId: user.id, action: "admin_signed_out", resourceType: "admin_session" });
  await signOutLocally(supabase);
  redirect("/signin");
}
