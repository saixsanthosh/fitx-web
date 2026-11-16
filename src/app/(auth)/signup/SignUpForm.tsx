"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Apple, LockKeyhole, Mail, UserRound } from "lucide-react";
import { GoogleIcon } from "@/components/ui/GoogleIcon";
import { finishPasswordSignIn } from "@/lib/auth/finish-sign-in";
import { authCallbackUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/client";

const appleEnabled = process.env.NEXT_PUBLIC_APPLE_OAUTH_ENABLED === "true";

export default function SignUpPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function signUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setError("");
    if (password.length < 8) return setError("Use at least 8 characters for your password.");
    if (password !== confirm) return setError("Your passwords do not match.");
    const supabase = createClient();
    if (!supabase) return setError("Account access is temporarily unavailable. Please try again later.");
    setLoading(true);
    try {
      const { data, error: authError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { name: name.trim() },
          emailRedirectTo: authCallbackUrl("/onboarding"),
        },
      });
      if (authError) {
        setError("We couldn’t create your account. Check your details and try again.");
        setLoading(false);
        return;
      }
      if (data.session) window.location.assign(await finishPasswordSignIn("/onboarding"));
      else setSent(true);
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
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: authCallbackUrl("/dashboard"),
          ...(provider === "google" ? { queryParams: { prompt: "select_account" } } : {}),
        },
      });
      if (authError) {
        setError(/unsupported provider|provider is not enabled/i.test(authError.message)
          ? `${provider === "google" ? "Google" : "Apple"} sign-in is not enabled for this app yet. Try email sign-up.`
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
      {sent ? (
        <div className="auth-success">
          <p className="auth-eyebrow">ONE MORE STEP</p>
          <h1>Check your email</h1>
          <p className="auth-subtitle">We sent a confirmation link to <strong>{email}</strong>. Open it to finish creating your FITX account.</p>
          <Link href="/signin" className="auth-form-link">Back to sign in</Link>
        </div>
      ) : (
        <>
          <p className="auth-eyebrow">START YOUR NEXT CHAPTER</p>
          <h1>Create your FITX account</h1>
          <p className="auth-subtitle">Bring workouts, nutrition and progress into one routine.</p>
          <button type="button" disabled={loading} onClick={() => void signInWith("google")} className="auth-google-button">
            <GoogleIcon />{loading ? "Connecting…" : "Continue with Google"}
          </button>
          <p className="auth-privacy-note">Secure sign-in powered by Google. FITX never sees your Google password.</p>
          {error && <p role="alert" className="auth-error">{error}</p>}
          <details className="auth-email-details">
            <summary>Other sign-up options</summary>
            <div className="auth-email-form">
              {appleEnabled && <button type="button" disabled={loading} onClick={() => void signInWith("apple")} className="auth-option-button"><Apple size={17} aria-hidden="true" />Continue with Apple</button>}
              <form onSubmit={signUp} className="auth-email-form">
                <label className="auth-field-label">Your name
                  <span className="auth-field-wrap"><UserRound size={16} aria-hidden="true" /><input className="fitx-field" autoComplete="name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></span>
                </label>
                <label className="auth-field-label">Email address
                  <span className="auth-field-wrap"><Mail size={16} aria-hidden="true" /><input className="fitx-field" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></span>
                </label>
                <label className="auth-field-label">Password
                  <span className="auth-field-wrap"><LockKeyhole size={16} aria-hidden="true" /><input className="fitx-field" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} /></span>
                </label>
                <label className="auth-field-label">Confirm password
                  <span className="auth-field-wrap"><LockKeyhole size={16} aria-hidden="true" /><input className="fitx-field" type="password" autoComplete="new-password" minLength={8} required value={confirm} onChange={(e) => setConfirm(e.target.value)} /></span>
                </label>
                <button type="submit" disabled={loading} className="fitx-button w-full">{loading ? "Creating account…" : "Create account with email"}</button>
              </form>
            </div>
          </details>
          <p className="auth-account-note">Already use FITX? <Link href="/signin">Sign in</Link></p>
        </>
      )}
    </div>
  );
}
