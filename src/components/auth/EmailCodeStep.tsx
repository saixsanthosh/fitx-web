"use client";

import { useEffect, useRef, type FormEvent } from "react";
import { ArrowLeft } from "lucide-react";
import { formatCountdown } from "@/lib/auth/email-code";
import { CodeField } from "./CodeField";
import type { EmailCode } from "./useEmailCode";
import { useHydrated, useKeepTypedValue } from "./useKeepTypedValue";
import s from "./auth.module.css";

/**
 * The second step of signing in with an e-mail code: enter the six digits, resend after a minute, or go back.
 * Its buttons are aria-disabled while they can't be used, never disabled: a button disabled while it has focus drops
 * keyboard focus to the page (bug 81). After a new code is sent, focus goes back to the code field for it, and
 * "New code sent." is spoken by a status line that is always there (a live region added with its text may be missed).
 * "Change email" hands focus to the email field (the form does that, src/lib/auth/step-focus.ts).
 */
export function EmailCodeStep({ flow }: { flow: EmailCode }) {
  const input = useRef<HTMLInputElement>(null);
  const { email, code, setCode, verifying, signingIn, error, notice, resendIn, sending } = flow;
  // Like every auth field, it keeps what it holds when it mounts (this step itself only shows after hydration).
  useKeepTypedValue(input, code, setCode);
  const hydrated = useHydrated();

  useEffect(() => {
    // No scrolling: the step slides in from the side, and focusing mid-slide would scroll the page sideways.
    input.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (error) input.current?.select();
  }, [error]);

  const working = verifying || signingIn;
  const canResend = resendIn === 0 && !sending && !working;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (working) return;
    void flow.verify(code);
  }

  async function resend() {
    if (!canResend) return;
    // The new code goes in the same field: focus waits there for it.
    if (await flow.resend()) input.current?.focus({ preventScroll: true });
  }

  return (
    <>
      <h1 className={s.title}>Check your email</h1>
      <p className={s.lead}>Code sent to <strong>{email}</strong>. Or tap the link in the email.</p>
      <form className={s.form} onSubmit={submit} noValidate data-hydrated={hydrated || undefined}>
        <CodeField
          ref={input}
          value={code}
          onChange={setCode}
          onComplete={(full) => void flow.verify(full)}
          invalid={Boolean(error)}
          readOnly={signingIn}
          describedBy={error ? "auth-code-error" : undefined}
        />
        {error && <p id="auth-code-error" role="alert" className={s.error}>{error}</p>}
        <p role="status" className={s.notice}>{notice && !error ? notice : null}</p>
        <button type="submit" className={`fitx-button ${s.primary}`} disabled={code.length < 6} aria-disabled={working || undefined}>
          {signingIn ? "Signing in…" : verifying ? "Checking…" : "Verify code"}
        </button>
      </form>
      <div className={s.row}>
        <button type="button" className={`${s.link} ${s.quietLink}`} onClick={() => !working && flow.back()} aria-disabled={working || undefined}>
          <ArrowLeft size={15} aria-hidden="true" />Change email
        </button>
        <button type="button" className={s.link} onClick={() => void resend()} aria-disabled={!canResend || undefined}>
          {sending ? "Sending…" : resendIn > 0 ? `Resend in ${formatCountdown(resendIn)}` : "Resend code"}
        </button>
      </div>
    </>
  );
}
