"use client";

import Link from "next/link";
import { useState, useSyncExternalStore, type FormEvent } from "react";
import { Apple, Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";
import { GoogleIcon } from "@/components/ui/GoogleIcon";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

const appleEnabled = process.env.NEXT_PUBLIC_APPLE_OAUTH_ENABLED === "true";

function safeNext(value: string | null) {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")
    ? value
    : "/dashboard";
}

function subscribeLocation(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}

function getLocationError() {
  const query = new URLSearchParams(window.location.search);
  const code = query.get("error");
  return code === "cancelled"
    ? "Google sign-in was cancelled. You can try again whenever you’re ready."
    : code === "provider"
      ? "Google sign-in is not enabled for this app yet. Use email sign-in or contact the FITX team."
      : code === "callback"
        ? "We couldn’t complete sign-in. Please try again."
        : query.has("setup")
          ? "Account access is not configured in this environment yet."
          : "";
}

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const locationError = useSyncExternalStore(subscribeLocation, getLocationError, () => "");
  const visibleError = error || locationError;

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setError("");
    const supabase = createClient();
    if (!supabase) {
      setError("Account access is temporarily unavailable. Please try again later.");
      return;
    }
    setLoading(true);
    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (authError) {
        setError(/email not confirmed/i.test(authError.message)
          ? "Please confirm your email address before signing in."
          : /invalid login credentials/i.test(authError.message)
            ? "That email and password don’t match. Check your details and try again."
            : "We couldn’t sign you in. Please try again.");
        setLoading(false);
        return;
      }
      const { data: profile } = await supabase.from("profiles").select("onboarded").eq("id", data.user.id).maybeSingle();
      const destination = profile?.onboarded ? safeNext(new URLSearchParams(window.location.search).get("next")) : "/onboarding";
      window.location.assign(destination);
    } catch {
      setError("We couldn’t connect to FITX. Check your connection and try again.");
      setLoading(false);
    }
  }

  async function signInWith(provider: "google" | "apple") {
    if (loading) return;
    const supabase = createClient();
    if (!supabase) return setError("Account access is temporarily unavailable. Please try again later.");
    setError("");
    setLoading(true);
    try {
      const requested = safeNext(new URLSearchParams(window.location.search).get("next"));
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(requested)}`,
          ...(provider === "google" ? { queryParams: { prompt: "select_account" } } : {}),
        },
      });
      if (authError) {
        setError(/unsupported provider|provider is not enabled/i.test(authError.message)
          ? `${provider === "google" ? "Google" : "Apple"} sign-in is not enabled for this app yet. Use email sign-in or contact the FITX team.`
          : "We couldn’t start sign-in. Please try again.");
        setLoading(false);
      }
    } catch {
      setError("We couldn’t connect to FITX. Check your connection and try again.");
      setLoading(false);
    }
  }

  return (
    <div>
      <p className="auth-eyebrow">WELCOME BACK</p>
      <h1>Sign in to FITX</h1>
      <p className="auth-subtitle">Pick up where your training and progress left off.</p>
      <button type="button" disabled={loading} onClick={() => void signInWith("google")} className="auth-google-button">
        <GoogleIcon />{loading ? "Connecting…" : "Continue with Google"}
      </button>
      <p className="auth-privacy-note">Secure sign-in powered by Google. FITX never sees your Google password.</p>
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
            <button type="submit" disabled={loading} className="fitx-button w-full">{loading ? "Signing in…" : "Sign in with email"}</button>
          </form>
        </div>
      </details>
      <p className="auth-account-note">New to FITX? <Link href="/signup">Create an account</Link></p>
    </div>
  );
}
