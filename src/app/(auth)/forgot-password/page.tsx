"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ArrowLeft, Mail } from "lucide-react";
import { AuthScreen } from "@/components/auth/AuthScreen";
import s from "@/components/auth/auth.module.css";
import { isEmailAddress, sendCodeProblem } from "@/lib/auth/email-code";
import { browserEmailCooldown, cooldownMessage } from "@/lib/auth/send-cooldown";
import { authCallbackUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setError("");
    const address = email.trim();
    if (!isEmailAddress(address)) return setError("Enter your email address.");
    const supabase = createClient();
    if (!supabase) return setError("Password reset is temporarily unavailable.");
    const wait = browserEmailCooldown().wait(address);
    if (wait > 0) return setError(cooldownMessage(wait));
    setLoading(true);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(address, { redirectTo: authCallbackUrl("/reset-password") });
      if (resetError) {
        return setError(sendCodeProblem(resetError).retryAfter !== null || resetError.status === 429
          ? "A link was sent a moment ago. Wait a minute, then try again."
          : "We couldn’t send a reset link. Please try again.");
      }
      browserEmailCooldown().record(address);
      setSent(true);
    } catch {
      setError("We couldn’t connect to FITX. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthScreen footer={<p className={s.account}><Link href="/signin"><ArrowLeft size={15} aria-hidden="true" />&nbsp;Back to sign in</Link></p>}>
      <div className={s.body}>
        <h1 className={s.title}>{sent ? "Check your email" : "Reset password"}</h1>
        {sent ? (
          <p role="status" className={s.lead}>If an account uses <strong>{email.trim()}</strong>, a reset link is on its way.</p>
        ) : (
          <form onSubmit={submit} className={s.form} noValidate>
            <label className={s.field}>Email address
              <span className={s.inputWrap}>
                <Mail size={16} aria-hidden="true" />
                <input className="fitx-field" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
              </span>
            </label>
            {error && <p role="alert" className={s.error}>{error}</p>}
            <button type="submit" className={`fitx-button ${s.primary}`} disabled={loading}>{loading ? "Sending…" : "Send reset link"}</button>
          </form>
        )}
      </div>
    </AuthScreen>
  );
}
