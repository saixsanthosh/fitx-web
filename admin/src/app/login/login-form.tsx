"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Eye, EyeOff, LoaderCircle } from "lucide-react";
import { answerText } from "@/components/form-rules";
import { signIn, type LoginState } from "./actions";
import styles from "./login.module.css";

/**
 * Username and password. The server gives one message for every failure. The password's label names only the field
 * (the Show password button sits beside it, outside the label), and after a refusal focus goes back to the emptied
 * password field, however the form was sent: the Sign in button stays focusable while it works (aria-disabled, and a
 * press while busy sends nothing), since a disabled button drops keyboard focus to the page. The message is empty
 * while a sign-in is on its way, so the same refusal a second time is read out again (focus may already be in the
 * password field, where moving it there reads nothing).
 */
export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, null);
  const [visible, setVisible] = useState(false);
  const password = useRef<HTMLInputElement>(null);
  const error = state?.error ?? null;

  useEffect(() => {
    if (state?.error) password.current?.focus();
  }, [state]);

  return (
    <form action={action} className={styles.form}>
      <input type="hidden" name="next" value={next} />
      <label className={styles.field}>
        <span>Username</span>
        <input
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          maxLength={64}
          defaultValue={state?.username ?? ""}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "login-error" : undefined}
        />
      </label>
      <div className={styles.field}>
        <label htmlFor="login-password">Password</label>
        <span className={styles.passwordRow}>
          <input
            ref={password}
            id="login-password"
            name="password"
            type={visible ? "text" : "password"}
            autoComplete="current-password"
            required
            maxLength={256}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "login-error" : undefined}
          />
          <button type="button" className={styles.reveal} onClick={() => setVisible((value) => !value)} aria-label={visible ? "Hide password" : "Show password"} aria-pressed={visible}>
            {visible ? <EyeOff aria-hidden="true" size={18} /> : <Eye aria-hidden="true" size={18} />}
          </button>
        </span>
      </div>
      <p id="login-error" className={styles.error} role="alert">{answerText(error, pending)}</p>
      <button className={styles.submit} type="submit" aria-disabled={pending} onClick={(event) => { if (pending) event.preventDefault(); }}>
        {pending && <LoaderCircle aria-hidden="true" className={styles.spin} size={18} />}
        <span>Sign in</span>
      </button>
    </form>
  );
}
