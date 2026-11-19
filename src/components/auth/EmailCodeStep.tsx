"use client";

import { useEffect, useRef, type FormEvent } from "react";
import { ArrowLeft } from "lucide-react";
import { formatCountdown } from "@/lib/auth/email-code";
import { CodeField } from "./CodeField";
import type { EmailCode } from "./useEmailCode";
import s from "./auth.module.css";

/** The second step of signing in with an e-mail code: enter the six digits, resend after a minute, or go back. */
export function EmailCodeStep({ flow }: { flow: EmailCode }) {
  const input = useRef<HTMLInputElement>(null);
  const { email, code, setCode, verifying, signingIn, error, notice, resendIn, sending } = flow;

  useEffect(() => {
    // No scrolling: the step slides in from the side, and focusing mid-slide would scroll the page sideways.
    input.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (error) input.current?.select();
  }, [error]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void flow.verify(code);
  }

  const working = verifying || signingIn;

  return (
    <>
      <h1 className={s.title}>Check your email</h1>
      <p className={s.lead}>Code sent to <strong>{email}</strong></p>
      <form className={s.form} onSubmit={submit} noValidate>
        <CodeField
          ref={input}
          value={code}
          onChange={setCode}
          onComplete={(full) => void flow.verify(full)}
          invalid={Boolean(error)}
          disabled={signingIn}
          describedBy={error ? "auth-code-error" : undefined}
        />
        {error && <p id="auth-code-error" role="alert" className={s.error}>{error}</p>}
        {notice && !error && <p role="status" className={s.notice}>{notice}</p>}
        <button type="submit" className={`fitx-button ${s.primary}`} disabled={working || code.length < 6}>
          {signingIn ? "Signing in…" : verifying ? "Checking…" : "Verify code"}
        </button>
      </form>
      <div className={s.row}>
        <button type="button" className={`${s.link} ${s.quietLink}`} onClick={flow.back} disabled={working}>
          <ArrowLeft size={15} aria-hidden="true" />Change email
        </button>
        <button type="button" className={s.link} onClick={() => void flow.resend()} disabled={resendIn > 0 || sending || working}>
          {sending ? "Sending…" : resendIn > 0 ? `Resend in ${formatCountdown(resendIn)}` : "Resend code"}
        </button>
      </div>
    </>
  );
}
