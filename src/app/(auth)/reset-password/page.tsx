"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { LockKeyhole } from "lucide-react";
import { AuthScreen } from "@/components/auth/AuthScreen";
import s from "@/components/auth/auth.module.css";
import { stampSessionCookies } from "@/lib/auth/session-stamp";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setError("");
    if (password.length < 8) return setError("Use at least 8 characters for your password.");
    if (password !== confirm) return setError("Your passwords do not match.");
    const supabase = createClient();
    if (!supabase) return setError("Password reset is temporarily unavailable.");
    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        return setError(/session|jwt|not authenticated/i.test(updateError.message)
          ? "This reset link has expired. Ask for a new one."
          : /different from the old|same password/i.test(updateError.message)
            ? "Choose a password you haven’t used here before."
            : "We couldn’t update your password. Please try again.");
      }
      void stampSessionCookies();
      setSaved(true);
    } catch {
      setError("We couldn’t connect to FITX. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthScreen>
      <div className={s.body}>
        <h1 className={s.title}>{saved ? "Password updated" : "New password"}</h1>
        {saved ? (
          <Link href="/dashboard" className={`fitx-button ${s.primary}`}>Open FITX</Link>
        ) : (
          <form onSubmit={submit} className={s.form} noValidate>
            <label className={s.field}>New password
              <span className={s.inputWrap}>
                <LockKeyhole size={16} aria-hidden="true" />
                <input className="fitx-field" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} />
              </span>
            </label>
            <label className={s.field}>Confirm password
              <span className={s.inputWrap}>
                <LockKeyhole size={16} aria-hidden="true" />
                <input className="fitx-field" type="password" autoComplete="new-password" minLength={8} required value={confirm} onChange={(event) => setConfirm(event.target.value)} />
              </span>
            </label>
            {error && <p role="alert" className={s.error}>{error}</p>}
            <button type="submit" className={`fitx-button ${s.primary}`} disabled={loading}>{loading ? "Saving…" : "Update password"}</button>
            <Link href="/forgot-password" className={s.link}>Need a new link?</Link>
          </form>
        )}
      </div>
    </AuthScreen>
  );
}
