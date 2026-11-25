"use client";

import Link from "next/link";
import { useId, useRef, useState, type FormEvent } from "react";
import { AnimatePresence, m } from "framer-motion";
import { Apple, LockKeyhole, Mail, Plus, UserRound } from "lucide-react";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { useEarlySubmit } from "@/components/auth/early-submit";
import { EmailCodeStep } from "@/components/auth/EmailCodeStep";
import { FieldProblemText } from "@/components/auth/FieldProblem";
import { startOAuth, type OAuthProvider } from "@/components/auth/GoogleButton";
import { GoogleSignIn } from "@/components/auth/GoogleSignIn";
import { useEmailCode } from "@/components/auth/useEmailCode";
import { useHydrated, useKeepOpenState, useKeepTypedValue } from "@/components/auth/useKeepTypedValue";
import s from "@/components/auth/auth.module.css";
import { DURATION, EASE, useReducedMotionSafe } from "@/components/motion";
import { finishLateSignIn, finishPasswordSignIn, leaveSignInPage } from "@/lib/auth/finish-sign-in";
import { fieldIds, fieldInvalid, signUpFormProblem, type AuthField, type FieldProblem } from "@/lib/auth/form-problems";
import { browserEmailCooldown, cooldownMessage } from "@/lib/auth/send-cooldown";
import { isTimeLimit, TIMED_OUT, TIME_LIMIT_MS, withTimeLimit } from "@/lib/auth/time-limit";
import { authCallbackUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/client";

const appleEnabled = process.env.NEXT_PUBLIC_APPLE_OAUTH_ENABLED === "true";

/** New accounts go to onboarding: the server sends them there (post-sign-in), whatever they asked for. */
const noNext = () => null;

type Pending = "password" | OAuthProvider | null;

export default function SignUpForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [sent, setSent] = useState(false);
  /** A problem with one field, under that field (bug 45). */
  const [fieldProblem, setFieldProblem] = useState<FieldProblem | null>(null);
  /** Why the last code or sign-up failed, under the button that is showing. */
  const [error, setError] = useState("");
  /** Why Google (or Apple) sign-up failed, under the Google button. */
  const [providerError, setProviderError] = useState("");
  const emailInput = useRef<HTMLInputElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const confirmInput = useRef<HTMLInputElement>(null);
  const options = useRef<HTMLDetailsElement>(null);
  const baseId = useId();
  const ids = fieldIds(baseId);
  // Whatever was typed (or opened) before the page's scripts ran stays: the render right after hydration would wipe it.
  useKeepTypedValue(emailInput, email, setEmail);
  useKeepTypedValue(nameInput, name, setName);
  useKeepTypedValue(passwordInput, password, setPassword);
  useKeepTypedValue(confirmInput, confirm, setConfirm);
  useKeepOpenState(options, open, setOpen);
  const hydrated = useHydrated();
  // A press of Enter or of the button before the page is ready is held, then sent once it is (early-submit.ts).
  const formRef = useRef<HTMLFormElement>(null);
  const replayEarlySubmit = useEarlySubmit(formRef);
  const reduced = useReducedMotionSafe();
  const codeFlow = useEmailCode(noNext);
  const loading = pending !== null || codeFlow.sending;

  /** Shows a problem under its field, and takes the member there to fix it (bug 80: not left on the button). */
  function showProblem(found: FieldProblem) {
    setFieldProblem(found);
    const field: Record<AuthField, HTMLInputElement | null> = {
      email: emailInput.current,
      name: nameInput.current,
      password: passwordInput.current,
      confirm: confirmInput.current,
    };
    field[found.field]?.focus({ preventScroll: found.field === "email" });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setFieldProblem(null);
    setError("");
    setProviderError("");
    const found = signUpFormProblem({ email, name, password, confirm, withPassword: open });
    if (found) return showProblem(found);
    const address = email.trim();
    if (!open) {
      const failure = await codeFlow.send(address);
      if (failure) setError(failure);
      return;
    }
    const supabase = createClient();
    if (!supabase) return setError("Account access is temporarily unavailable. Please try again later.");
    const wait = browserEmailCooldown().wait(address);
    if (wait > 0) return setError(cooldownMessage(wait));
    setPending("password");
    try {
      const { data, error: authError } = await withTimeLimit(
        supabase.auth.signUp({
          email: address,
          password,
          options: { data: { name: name.trim() }, emailRedirectTo: authCallbackUrl("/onboarding") },
        }),
        TIME_LIMIT_MS.email,
        // Created after all: carry on as if it had answered in time.
        ({ data: late, error: lateError }) => {
          if (lateError) return;
          if (late.session) return finishLateSignIn("/onboarding");
          browserEmailCooldown().record(address);
          setSent(true);
        },
      );
      if (authError) {
        setError("We couldn’t create your account. Check your details and try again.");
        setPending(null);
        return;
      }
      if (data.session) leaveSignInPage(await finishPasswordSignIn("/onboarding"));
      else {
        // A confirmation email is on its way.
        browserEmailCooldown().record(address);
        setSent(true);
        setPending(null);
      }
    } catch (problem) {
      setError(isTimeLimit(problem) ? TIMED_OUT.signUp : "We couldn’t connect to FITX. Check your connection and try again.");
      setPending(null);
    }
  }

  async function signInWith(provider: OAuthProvider) {
    if (loading) return;
    setError("");
    setProviderError("");
    setPending(provider);
    const failure = await startOAuth(provider, null);
    if (failure) {
      setProviderError(failure);
      setPending(null);
    }
  }

  const slide = reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.15 } }
    : { initial: { opacity: 0, x: 24 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: -24 }, transition: { duration: DURATION.base, ease: EASE.out } };
  const view = sent ? "sent" : codeFlow.step;

  return (
    <AuthScreen footer={view === "email" && <p className={s.account}>Already use FITX? <Link href="/signin">Sign in</Link></p>}>
      <AnimatePresence mode="popLayout" initial={false}>
        {view === "sent" ? (
          <m.div key="sent" className={s.body} {...slide}>
            <h1 className={s.title}>Check your email</h1>
            <p className={s.lead}>Open the link we sent to <strong>{email.trim()}</strong> to finish.</p>
            <Link href="/signin" className={s.link}>Back to sign in</Link>
          </m.div>
        ) : view === "code" ? (
          <m.div key="code" className={s.body} {...slide}>
            <EmailCodeStep flow={codeFlow} />
          </m.div>
        ) : (
          <m.div key="email" className={s.body} {...slide}>
            <h1 className={s.title}>Create account</h1>
            <GoogleSignIn
              context="signup"
              next={noNext}
              disabled={loading}
              redirectPending={pending === "google"}
              onRedirect={() => void signInWith("google")}
              onError={setProviderError}
              onBusy={(busy) => setPending(busy ? "google" : null)}
            />
            {providerError && <p role="alert" className={s.error}>{providerError}</p>}
            <div className={s.divider}>or</div>
            <form ref={formRef} action={replayEarlySubmit} onSubmit={submit} className={s.form} noValidate data-hydrated={hydrated || undefined}>
              <div className={s.field}>
                <label htmlFor={ids.input("email")}>Email address</label>
                <span className={s.inputWrap}>
                  <Mail size={16} aria-hidden="true" />
                  <input ref={emailInput} id={ids.input("email")} className="fitx-field" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(event) => setEmail(event.target.value)} {...fieldInvalid(fieldProblem, "email", ids)} />
                </span>
                <FieldProblemText problem={fieldProblem} field="email" ids={ids} />
              </div>
              {!open && (
                <>
                  <button type="submit" disabled={loading} className={`fitx-button ${s.primary}`}>
                    {codeFlow.sending ? "Sending code…" : "Email me a code"}
                  </button>
                  {error && <p role="alert" className={s.error}>{error}</p>}
                </>
              )}
              <details
                ref={options}
                className={s.details}
                open={open}
                onToggle={(event) => {
                  const nowOpen = event.currentTarget.open;
                  setOpen(nowOpen);
                  // A failure belongs to the button that showed it, and the panel's fields' problems to them: they go
                  // when the panel that holds them is opened or shut.
                  if (nowOpen !== open) {
                    setError("");
                    if (fieldProblem && fieldProblem.field !== "email") setFieldProblem(null);
                  }
                }}
              >
                <summary>Other sign-up options<Plus size={17} aria-hidden="true" /></summary>
                <div className={s.detailsBody}>
                  <div className={s.field}>
                    <label htmlFor={ids.input("name")}>Your name</label>
                    <span className={s.inputWrap}>
                      <UserRound size={16} aria-hidden="true" />
                      <input ref={nameInput} id={ids.input("name")} className="fitx-field" autoComplete="name" required={open} maxLength={80} value={name} onChange={(event) => setName(event.target.value)} {...fieldInvalid(fieldProblem, "name", ids)} />
                    </span>
                    <FieldProblemText problem={fieldProblem} field="name" ids={ids} />
                  </div>
                  <div className={s.field}>
                    <label htmlFor={ids.input("password")}>Password</label>
                    <span className={s.inputWrap}>
                      <LockKeyhole size={16} aria-hidden="true" />
                      <input ref={passwordInput} id={ids.input("password")} className="fitx-field" type="password" autoComplete="new-password" minLength={8} required={open} value={password} onChange={(event) => setPassword(event.target.value)} {...fieldInvalid(fieldProblem, "password", ids)} />
                    </span>
                    <FieldProblemText problem={fieldProblem} field="password" ids={ids} />
                  </div>
                  <div className={s.field}>
                    <label htmlFor={ids.input("confirm")}>Confirm password</label>
                    <span className={s.inputWrap}>
                      <LockKeyhole size={16} aria-hidden="true" />
                      <input ref={confirmInput} id={ids.input("confirm")} className="fitx-field" type="password" autoComplete="new-password" minLength={8} required={open} value={confirm} onChange={(event) => setConfirm(event.target.value)} {...fieldInvalid(fieldProblem, "confirm", ids)} />
                    </span>
                    <FieldProblemText problem={fieldProblem} field="confirm" ids={ids} />
                  </div>
                  {open && (
                    <>
                      <button type="submit" disabled={loading} className={`fitx-button ${s.primary}`}>
                        {pending === "password" ? "Creating account…" : "Create account with email"}
                      </button>
                      {error && <p role="alert" className={s.error}>{error}</p>}
                    </>
                  )}
                  {appleEnabled && (
                    <button type="button" disabled={loading} onClick={() => void signInWith("apple")} className={s.option}>
                      <Apple size={17} aria-hidden="true" />Continue with Apple
                    </button>
                  )}
                </div>
              </details>
            </form>
          </m.div>
        )}
      </AnimatePresence>
    </AuthScreen>
  );
}
