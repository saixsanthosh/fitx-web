"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ArrowLeft, Mail } from "lucide-react";
import { Logo } from "@/components/ui/Logo";
import { createClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const supabase = createClient();
    if (!supabase) return setError("Password reset is temporarily unavailable.");
    setLoading(true);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });
    setLoading(false);
    if (resetError) return setError(resetError.message);
    setSent(true);
  }

  return (
    <div className="mx-auto w-full max-w-[448px]">
      <Link href="/signin" className="mb-7 flex justify-center" aria-label="FITX"><Logo size={64} /></Link>
      <section className="rounded-2xl border border-fitx-border bg-[#0b1012] p-6 sm:p-8">
        <h1 className="mb-2 text-center text-xl font-semibold text-fitx-text">{sent ? "Check your email" : "Reset password"}</h1>
        <p className="mb-6 text-center text-sm leading-6 text-fitx-text-secondary">{sent ? "If an account matches that address, a secure reset link is on its way." : "Enter the email address for your account and we’ll send a reset link."}</p>
        {!sent && <form onSubmit={submit} className="space-y-3">
          <label className="relative block"><span className="sr-only">Email address</span><Mail size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-fitx-text-disabled" /><input className="fitx-field pl-11" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" /></label>
          {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
          <button className="fitx-button w-full" disabled={loading}>{loading ? "Sending…" : "Send reset link"}</button>
        </form>}
        <Link href="/signin" className="mt-6 flex items-center justify-center gap-2 text-sm text-fitx-text-secondary hover:text-fitx-text"><ArrowLeft size={15} />Back to Login</Link>
      </section>
    </div>
  );
}
