"use client";

import { GoogleIcon } from "@/components/ui/GoogleIcon";
import { authCallbackUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/client";
import s from "./auth.module.css";

export type OAuthProvider = "google" | "apple";

/**
 * Starts Google (or, where the owner turned it on, Apple) sign-in. The return address is always built on
 * the canonical auth origin (authCallbackUrl), with `next` cleaned by safeNext. Resolves with an error
 * message, or never resolves on success because the browser leaves the page.
 */
export async function startOAuth(provider: OAuthProvider, next: string | null): Promise<string | null> {
  const supabase = createClient();
  if (!supabase) return "Account access is temporarily unavailable. Please try again later.";
  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: authCallbackUrl(next),
        ...(provider === "google" ? { queryParams: { prompt: "select_account" } } : {}),
      },
    });
    if (!error) return null;
    return /unsupported provider|provider is not enabled/i.test(error.message)
      ? `${provider === "google" ? "Google" : "Apple"} sign-in is not turned on for FITX yet. Use your email instead.`
      : "We couldn’t start sign-in. Please try again.";
  } catch {
    return "We couldn’t connect to FITX. Check your connection and try again.";
  }
}

export function GoogleButton({ pending, disabled, onClick }: { pending: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={s.google}>
      <GoogleIcon />
      {pending ? "Connecting…" : "Continue with Google"}
    </button>
  );
}
