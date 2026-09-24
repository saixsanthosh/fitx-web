"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Apple, Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";
import { Logo } from "@/components/ui/Logo";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

const googleEnabled = process.env.NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED === "true";
const appleEnabled = process.env.NEXT_PUBLIC_APPLE_OAUTH_ENABLED === "true";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const supabase = createClient();
    if (!supabase) {
      setError("Sign in is temporarily unavailable. Please try again later.");
      return;
    }
    setLoading(true);
    const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }
    const requested = new URLSearchParams(window.location.search).get("next") || "/dashboard";
    const destination = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/dashboard";
    window.location.assign(destination);
  }

  async function signInWith(provider: "google" | "apple") {
    const supabase = createClient();
    if (!supabase) return setError("Sign in is temporarily unavailable. Please try again later.");
    setError("");
    setLoading(true);
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback?next=/dashboard` },
    });
    if (authError) {
      setError(authError.message);
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[448px]">
      <Link href="/" className="mb-7 flex justify-center" aria-label="FITX">
        <Logo size={64} />
      </Link>
      <section className="rounded-2xl border border-fitx-border bg-[#0b1012] p-6 shadow-[0_24px_80px_rgba(0,0,0,.25)] sm:p-8">
        <h1 className="mb-5 text-center text-xl font-semibold text-fitx-text">Login</h1>
        {(googleEnabled || appleEnabled) && (
          <>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {googleEnabled && <button type="button" disabled={loading} onClick={() => void signInWith("google")} className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-fitx-border bg-fitx-surface text-sm hover:bg-white/[.04]"><span className="font-bold text-[#4285F4]">G</span>Continue with Google</button>}
              {appleEnabled && <button type="button" disabled={loading} onClick={() => void signInWith("apple")} className="flex min-h-11 items-center justify-center gap-2 rounded-lg border border-fitx-border bg-fitx-surface text-sm hover:bg-white/[.04]"><Apple size={18} fill="currentColor" />Continue with Apple</button>}
            </div>
            <div className="my-5 flex items-center gap-3 text-xs text-fitx-text-disabled"><span className="h-px flex-1 bg-fitx-divider" /><span>or</span><span className="h-px flex-1 bg-fitx-divider" /></div>
          </>
        )}
        <form onSubmit={signIn} className="space-y-3">
          <label className="relative block">
            <span className="sr-only">Email address</span><Mail size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-fitx-text-disabled" />
            <input className="fitx-field pl-11" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" />
          </label>
          <label className="relative block">
            <span className="sr-only">Password</span><LockKeyhole size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-fitx-text-disabled" />
            <input className="fitx-field pl-11 pr-12" type={visible ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" />
            <button type="button" aria-label={visible ? "Hide password" : "Show password"} onClick={() => setVisible(!visible)} className="absolute right-3 top-1/2 -translate-y-1/2 text-fitx-text-disabled hover:text-fitx-text">{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button>
          </label>
          <div className="flex justify-end pt-0.5">
            <Link href="/forgot-password" className="text-sm text-fitx-primary hover:text-fitx-primary-bright">Forgot password?</Link>
          </div>
          {error && <p role="alert" className="rounded-lg border border-red-400/20 bg-red-400/5 px-3 py-2 text-sm text-red-300">{error}</p>}
          {!isSupabaseConfigured && <p role="status" className="text-xs text-fitx-warning">Supabase connection is not configured for this environment.</p>}
          <button type="submit" disabled={loading} className="fitx-button w-full">{loading ? "Signing in…" : "Log In"}</button>
        </form>
        <p className="mt-5 text-center text-sm text-fitx-text-secondary">Don&apos;t have an account? <Link href="/signup" className="font-medium text-fitx-primary hover:text-fitx-primary-bright">Sign Up</Link></p>
      </section>
    </div>
  );
}
