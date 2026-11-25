"use client";

import Link from "next/link";
import { useId, useRef, useState, type FormEvent } from "react";
import { LockKeyhole } from "lucide-react";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { useEarlySubmit } from "@/components/auth/early-submit";
import { useFocusWhen } from "@/components/auth/useFocusWhen";
import { FieldProblemText } from "@/components/auth/FieldProblem";
import { useHydrated, useKeepTypedValue } from "@/components/auth/useKeepTypedValue";
import s from "@/components/auth/auth.module.css";
import { fieldIds, fieldInvalid, newPasswordProblem, type FieldProblem } from "@/lib/auth/form-problems";
import { stampSessionCookies } from "@/lib/auth/session-stamp";
import { isTimeLimit, TIMED_OUT, TIME_LIMIT_MS, withTimeLimit } from "@/lib/auth/time-limit";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  /** A problem with one of the two fields, under that field (bug 45). */
  const [fieldProblem, setFieldProblem] = useState<FieldProblem | null>(null);
  /** Why saving failed, under the button. */
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const passwordInput = useRef<HTMLInputElement>(null);
  const confirmInput = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const baseId = useId();
  const ids = fieldIds(baseId);
  // Passwords typed before the page's scripts ran stay (src/components/auth/useKeepTypedValue.ts).
  useKeepTypedValue(passwordInput, password, setPassword);
  useKeepTypedValue(confirmInput, confirm, setConfirm);
  const hydrated = useHydrated();
  // A press of Enter or of the button before the page is ready is held, then sent once it is (early-submit.ts).
  const formRef = useRef<HTMLFormElement>(null);
  const replayEarlySubmit = useEarlySubmit(formRef);
  // The button pressed is gone once the password is saved: focus goes to "Password updated", then Open FITX.
  useFocusWhen(heading, saved);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setFieldProblem(null);
    setError("");
    const found = newPasswordProblem({ password, confirm });
    if (found) {
      // The field at fault takes focus, marked invalid and described by the message (bug 80).
      setFieldProblem(found);
      (found.field === "confirm" ? confirmInput : passwordInput).current?.focus();
      return;
    }
    const supabase = createClient();
    if (!supabase) return setError("Password reset is temporarily unavailable.");
    setLoading(true);
    try {
      const { error: updateError } = await withTimeLimit(
        supabase.auth.updateUser({ password }),
        TIME_LIMIT_MS.check,
        // Saved after all: say so.
        ({ error: late }) => {
          if (late) return;
          void stampSessionCookies();
          setSaved(true);
        },
      );
      if (updateError) {
        return setError(/session|jwt|not authenticated/i.test(updateError.message)
          ? "This reset link has expired. Ask for a new one."
          : /different from the old|same password/i.test(updateError.message)
            ? "Choose a password you haven’t used here before."
            : "We couldn’t update your password. Please try again.");
      }
      void stampSessionCookies();
      setSaved(true);
    } catch (problem) {
      setError(isTimeLimit(problem) ? TIMED_OUT.newPassword : "We couldn’t connect to FITX. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthScreen>
      <div className={s.body}>
        <h1 ref={heading} tabIndex={-1} className={s.title}>{saved ? "Password updated" : "New password"}</h1>
        {saved ? (
          <Link href="/dashboard" className={`fitx-button ${s.primary}`}>Open FITX</Link>
        ) : (
          <form ref={formRef} action={replayEarlySubmit} onSubmit={submit} className={s.form} noValidate data-hydrated={hydrated || undefined}>
            <div className={s.field}>
              <label htmlFor={ids.input("password")}>New password</label>
              <span className={s.inputWrap}>
                <LockKeyhole size={16} aria-hidden="true" />
                <input ref={passwordInput} id={ids.input("password")} className="fitx-field" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} {...fieldInvalid(fieldProblem, "password", ids)} />
              </span>
              <FieldProblemText problem={fieldProblem} field="password" ids={ids} />
            </div>
            <div className={s.field}>
              <label htmlFor={ids.input("confirm")}>Confirm password</label>
              <span className={s.inputWrap}>
                <LockKeyhole size={16} aria-hidden="true" />
                <input ref={confirmInput} id={ids.input("confirm")} className="fitx-field" type="password" autoComplete="new-password" minLength={8} required value={confirm} onChange={(event) => setConfirm(event.target.value)} {...fieldInvalid(fieldProblem, "confirm", ids)} />
              </span>
              <FieldProblemText problem={fieldProblem} field="confirm" ids={ids} />
            </div>
            <button type="submit" className={`fitx-button ${s.primary}`} aria-disabled={loading || undefined}>{loading ? "Saving…" : "Update password"}</button>
            {error && <p role="alert" className={s.error}>{error}</p>}
            <Link href="/forgot-password" className={s.link}>Need a new link?</Link>
          </form>
        )}
      </div>
    </AuthScreen>
  );
}
