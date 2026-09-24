"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Apple, Eye, EyeOff, LockKeyhole, Mail, UserRound } from "lucide-react";
import { Logo } from "@/components/ui/Logo";
import { GoogleIcon } from "@/components/ui/GoogleIcon";
import { createClient } from "@/lib/supabase/client";

const appleEnabled = process.env.NEXT_PUBLIC_APPLE_OAUTH_ENABLED === "true";

export default function SignUpPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function signUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (password.length < 8) return setError("Use at least 8 characters for your password.");
    if (password !== confirm) return setError("Your passwords do not match.");
    const supabase = createClient();
    if (!supabase) return setError("Sign up is temporarily unavailable. Please try again later.");
    setLoading(true);
    const { data, error: authError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { name: name.trim() },
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding`,
      },
    });
    setLoading(false);
    if (authError) return setError(authError.message);
    if (data.session) window.location.assign("/onboarding");
    else setSent(true);
  }

  async function signInWith(provider: "google" | "apple") {
    const supabase = createClient();
    if (!supabase) return setError("Sign up is temporarily unavailable. Please try again later.");
    setError("");
    setLoading(true);
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=/onboarding`,
        ...(provider === "google" ? { queryParams: { prompt: "select_account" } } : {}),
      },
    });
    if (authError) {
      setError(provider === "google" && /unsupported provider|provider is not enabled/i.test(authError.message)
        ? "Google sign-in hasn’t been enabled for this app yet. Please use email and password for now."
        : authError.message);
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[448px]">
      <Link href="/" className="mb-7 flex justify-center" aria-label="FITX"><Logo size={64} /></Link>
      <section className="rounded-2xl border border-fitx-border bg-[#0b1012] p-6 shadow-[0_24px_80px_rgba(0,0,0,.25)] sm:p-8">
        {sent ? (
          <div className="py-4 text-center">
            <h1 className="mb-2 text-xl font-semibold text-fitx-text">Check your email</h1>
            <p className="text-sm leading-6 text-fitx-text-secondary">We sent a confirmation link to <span className="text-fitx-text">{email}</span>. Open it to finish creating your account.</p>
            <Link href="/signin" className="mt-6 inline-flex text-sm font-medium text-fitx-primary">Back to Login</Link>
          </div>
        ) : (
          <>
            <h1 className="mb-5 text-center text-xl font-semibold text-fitx-text">Create account</h1>
            <>
              <div className={`grid grid-cols-1 gap-2 ${appleEnabled ? "sm:grid-cols-2" : ""}`}>
                <button type="button" disabled={loading} onClick={() => void signInWith("google")} className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-fitx-border bg-fitx-surface text-sm hover:bg-white/[.04]"><GoogleIcon />Continue with Google</button>
                {appleEnabled && <button type="button" disabled={loading} onClick={() => void signInWith("apple")} className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-fitx-border bg-fitx-surface text-sm hover:bg-white/[.04]"><Apple size={18} fill="currentColor" />Continue with Apple</button>}
              </div>
              <div className="my-5 flex items-center gap-3 text-xs text-fitx-text-disabled"><span className="h-px flex-1 bg-fitx-divider" /><span>or</span><span className="h-px flex-1 bg-fitx-divider" /></div>
            </>
            <form onSubmit={signUp} className="space-y-3">
              <label className="relative block">
                <span className="sr-only">Full name</span><UserRound size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-fitx-text-disabled" />
                <input className="fitx-field pl-11" autoComplete="name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
              </label>
              <label className="relative block">
                <span className="sr-only">Email address</span><Mail size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-fitx-text-disabled" />
                <input className="fitx-field pl-11" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" />
              </label>
              <label className="relative block">
                <span className="sr-only">Password</span><LockKeyhole size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-fitx-text-disabled" />
                <input className="fitx-field pl-11 pr-12" type={visible ? "text" : "password"} autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" />
                <button type="button" aria-label={visible ? "Hide password" : "Show password"} onClick={() => setVisible(!visible)} className="absolute right-3 top-1/2 -translate-y-1/2 text-fitx-text-disabled hover:text-fitx-text">{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button>
              </label>
              <label className="relative block">
                <span className="sr-only">Confirm password</span><LockKeyhole size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-fitx-text-disabled" />
                <input className="fitx-field pl-11" type="password" autoComplete="new-password" minLength={8} required value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Confirm password" />
              </label>
              {error && <p role="alert" className="rounded-lg border border-red-400/20 bg-red-400/5 px-3 py-2 text-sm text-red-300">{error}</p>}
              <button type="submit" disabled={loading} className="fitx-button w-full">{loading ? "Creating account…" : "Sign Up"}</button>
            </form>
            <p className="mt-5 text-center text-sm text-fitx-text-secondary">Already have an account? <Link href="/signin" className="font-medium text-fitx-primary hover:text-fitx-primary-bright">Log In</Link></p>
          </>
        )}
      </section>
    </div>
  );
}
