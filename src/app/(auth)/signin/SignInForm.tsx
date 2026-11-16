"use client";

import Link from "next/link";
import { useState, useSyncExternalStore, type FormEvent } from "react";
import { Apple, Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";
import { GoogleIcon } from "@/components/ui/GoogleIcon";
import { finishPasswordSignIn } from "@/lib/auth/finish-sign-in";
import { safeNext } from "@/lib/auth/safe-next";
import { authCallbackUrl } from "@/lib/site-url";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

const appleEnabled = process.env.NEXT_PUBLIC_APPLE_OAUTH_ENABLED === "true";

function subscribeLocation(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}

const LOCATION_ERRORS: Record<string, string> = {
  cancelled: "Google sign-in was cancelled. You can try again whenever you’re ready.",
  provider: "Google sign-in is not enabled for this app yet. Use email sign-in or contact the FITX team.",
  callback: "We couldn’t complete sign-in. Please try again.",
  browser: "That sign-in link was opened in a different browser or app from the one you started in. Sign in again here.",
  expired: "That link has expired or was already used. Sign in again, or request a new link.",
};

function getLocationError() {
  const query = new URLSearchParams(window.location.search);
  const code = query.get("error");
  if (code && LOCATION_ERRORS[code]) return LOCATION_ERRORS[code];
  return query.has("setup") ? "Account access is not configured in this environment yet." : "";
}

function getLocationNotice() {
  return new URLSearchParams(window.location.search).has("signed_out") ? "You’re signed out on this device." : "";
}

type Pending = "email" | "google" | "apple" | null;

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState("");
  const locationError = useSyncExternalStore(subscribeLocation, getLocationError, () => "");
  const notice = useSyncExternalStore(subscribeLocation, getLocationNotice, () => "");
  const visibleError = error || locationError;
  const loading = pending !== null;

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setError("");
    const supabase = createClient();
    if (!supabase) {
      setError("Account access is temporarily unavailable. Please try again later.");
      return;
    }
    setPending("email");
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (authError) {
        setError(/email not confirmed/i.test(authError.message)
          ? "Please confirm your email address before signing in."
          : /invalid login credentials/i.test(authError.message)
            ? "That email and password don’t match. Check your details and try again."
            : "We couldn’t sign you in. Please try again.");
        setPending(null);
        return;
      }
      window.location.assign(await finishPasswordSignIn(new URLSearchParams(window.location.search).get("next")));
    } catch {
      setError("We couldn’t connect to FITX. Check your connection and try again.");
      setPending(null);
    }
  }

  async function signInWith(provider: "google" | "apple") {
    if (loading) return;
    const supabase = createClient();
    if (!supabase) return setError("Account access is temporarily unavailable. Please try again later.");
    setError("");
    setPending(provider);
    try {
      const requested = safeNext(new URLSearchParams(window.location.search).get("next"));
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: authCallbackUrl(requested),
          ...(provider === "google" ? { queryParams: { prompt: "select_account" } } : {}),
        },
      });
      if (authError) {
        setError(/unsupported provider|provider is not enabled/i.test(authError.message)
          ? `${provider === "google" ? "Google" : "Apple"} sign-in is not enabled for this app yet. Use email sign-in or contact the FITX team.`
          : "We couldn’t start sign-in. Please try again.");
        setPending(null);
      }
    } catch {
      setError("We couldn’t connect to FITX. Check your connection and try again.");
      setPending(null);
    }
  }

  return (
    <div>
      <p className="auth-eyebrow">WELCOME BACK</p>
      <h1>Sign in to FITX</h1>
      <p className="auth-subtitle">Pick up where your training and progress left off.</p>
      <button type="button" disabled={loading} onClick={() => void signInWith("google")} className="auth-google-button">
        <GoogleIcon />{pending === "google" ? "Connecting…" : "Continue with Google"}
      </button>
      <p className="auth-privacy-note">Secure sign-in powered by Google. FITX never sees your Google password.</p>
      {notice && !visibleError && <p role="status" className="auth-privacy-note">{notice}</p>}
      {visibleError && <p role="alert" className="auth-error">{visibleError}</p>}
      {!isSupabaseConfigured && <p role="status" className="auth-config-note">Supabase environment values are missing here. Add them to enable account access.</p>}
      <details className="auth-email-details">
        <summary>Other sign-in options</summary>
        <div className="auth-email-form">
          {appleEnabled && <button type="button" disabled={loading} onClick={() => void signInWith("apple")} className="auth-option-button"><Apple size={17} aria-hidden="true" />Continue with Apple</button>}
          <form onSubmit={signIn} className="auth-email-form">
            <label className="auth-field-label">Email address
              <span className="auth-field-wrap"><Mail size={16} aria-hidden="true" /><input className="fitx-field" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></span>
            </label>
            <label className="auth-field-label">Password
              <span className="auth-field-wrap"><LockKeyhole size={16} aria-hidden="true" /><input className="fitx-field" type={visible ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /><button type="button" aria-label={visible ? "Hide password" : "Show password"} onClick={() => setVisible((show) => !show)}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button></span>
            </label>
            <div className="auth-form-row"><Link href="/forgot-password" className="auth-form-link">Forgot password?</Link></div>
            <button type="submit" disabled={loading} className="fitx-button w-full">{pending === "email" ? "Signing in…" : "Sign in with email"}</button>
          </form>
        </div>
      </details>
      <p className="auth-account-note">New to FITX? <Link href="/signup">Create an account</Link></p>
    </div>
  );
}
