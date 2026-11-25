"use client";

import Link from "next/link";
import { useId, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Mail } from "lucide-react";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { useEarlySubmit } from "@/components/auth/early-submit";
import { FieldProblemText } from "@/components/auth/FieldProblem";
import { useHydrated, useKeepTypedValue } from "@/components/auth/useKeepTypedValue";
import s from "@/components/auth/auth.module.css";
import { sendCodeProblem } from "@/lib/auth/email-code";
import { emailProblem, fieldIds, fieldInvalid, type FieldProblem } from "@/lib/auth/form-problems";
import { browserEmailCooldown, cooldownMessage } from "@/lib/auth/send-cooldown";
import { isTimeLimit, TIMED_OUT, TIME_LIMIT_MS, withTimeLimit } from "@/lib/auth/time-limit";
import { authCallbackUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  /** A problem with the address, under the field (bug 45). */
  const [fieldProblem, setFieldProblem] = useState<FieldProblem | null>(null);
  /** Why the last request failed, under the button. */
  const [error, setError] = useState("");
  const emailInput = useRef<HTMLInputElement>(null);
  const baseId = useId();
  const ids = fieldIds(baseId);
  // An address typed before the page's scripts ran stays (src/components/auth/useKeepTypedValue.ts).
  useKeepTypedValue(emailInput, email, setEmail);
  const hydrated = useHydrated();
  // A press of Enter or of the button before the page is ready is held, then sent once it is (early-submit.ts).
  const formRef = useRef<HTMLFormElement>(null);
  const replayEarlySubmit = useEarlySubmit(formRef);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setFieldProblem(null);
    setError("");
    const found = emailProblem(email);
    if (found) {
      setFieldProblem(found);
      emailInput.current?.focus({ preventScroll: true });
      return;
    }
    const address = email.trim();
    const supabase = createClient();
    if (!supabase) return setError("Password reset is temporarily unavailable.");
    const wait = browserEmailCooldown().wait(address);
    if (wait > 0) return setError(cooldownMessage(wait));
    setLoading(true);
    try {
      const { error: resetError } = await withTimeLimit(
        supabase.auth.resetPasswordForEmail(address, { redirectTo: authCallbackUrl("/reset-password") }),
        TIME_LIMIT_MS.email,
        // Sent after all: it counts for this browser's email limit, and the page says it is on its way.
        ({ error: late }) => {
          if (late) return;
          browserEmailCooldown().record(address);
          setSent(true);
        },
      );
      if (resetError) {
        return setError(sendCodeProblem(resetError).retryAfter !== null || resetError.status === 429
          ? "A link was sent a moment ago. Wait a minute, then try again."
          : "We couldn’t send a reset link. Please try again.");
      }
      browserEmailCooldown().record(address);
      setSent(true);
    } catch (problem) {
      setError(isTimeLimit(problem) ? TIMED_OUT.resetLink : "We couldn’t connect to FITX. Check your connection and try again.");
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
          <form ref={formRef} action={replayEarlySubmit} onSubmit={submit} className={s.form} noValidate data-hydrated={hydrated || undefined}>
            <div className={s.field}>
              <label htmlFor={ids.input("email")}>Email address</label>
              <span className={s.inputWrap}>
                <Mail size={16} aria-hidden="true" />
                <input ref={emailInput} id={ids.input("email")} className="fitx-field" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(event) => setEmail(event.target.value)} {...fieldInvalid(fieldProblem, "email", ids)} />
              </span>
              <FieldProblemText problem={fieldProblem} field="email" ids={ids} />
            </div>
            <button type="submit" className={`fitx-button ${s.primary}`} disabled={loading}>{loading ? "Sending…" : "Send reset link"}</button>
            {error && <p role="alert" className={s.error}>{error}</p>}
          </form>
        )}
      </div>
    </AuthScreen>
  );
}
