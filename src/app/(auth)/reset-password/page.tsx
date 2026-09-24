"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/ui/Logo";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (password.length < 8) return setError("Use at least 8 characters for your password.");
    if (password !== confirm) return setError("Your passwords do not match.");
    const supabase = createClient();
    if (!supabase) return setError("Password reset is temporarily unavailable.");
    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (updateError) return setError(updateError.message);
    setSaved(true);
  }

  return (
    <div className="mx-auto w-full max-w-[448px]">
      <Link href="/signin" className="mb-7 flex justify-center"><Logo size={64} /></Link>
      <section className="rounded-2xl border border-fitx-border bg-[#0b1012] p-6 sm:p-8">
        <h1 className="mb-2 text-center text-xl font-semibold">Choose a new password</h1>
        {saved ? <div className="text-center"><p className="text-sm text-fitx-text-secondary">Your password has been updated.</p><Link href="/signin" className="mt-5 inline-flex text-sm font-medium text-fitx-primary">Return to Login</Link></div> :
          <form onSubmit={submit} className="mt-5 space-y-3">
            <label className="block"><span className="sr-only">New password</span><input className="fitx-field" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="New password" /></label>
            <label className="block"><span className="sr-only">Confirm password</span><input className="fitx-field" type="password" autoComplete="new-password" minLength={8} required value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Confirm password" /></label>
            {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
            <button disabled={loading} className="fitx-button w-full">{loading ? "Saving…" : "Update password"}</button>
          </form>}
      </section>
    </div>
  );
}
