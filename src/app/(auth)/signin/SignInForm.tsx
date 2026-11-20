"use client";

import Link from "next/link";
import { useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { AnimatePresence, m } from "framer-motion";
import { Apple, Eye, EyeOff, LockKeyhole, Mail, Plus } from "lucide-react";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { EmailCodeStep } from "@/components/auth/EmailCodeStep";
import { GoogleButton, startOAuth, type OAuthProvider } from "@/components/auth/GoogleButton";
import { useEmailCode } from "@/components/auth/useEmailCode";
import s from "@/components/auth/auth.module.css";
import { DURATION, EASE, useReducedMotionSafe } from "@/components/motion";
import { isEmailAddress, passwordSignInProblem } from "@/lib/auth/email-code";
import { finishPasswordSignIn } from "@/lib/auth/finish-sign-in";
import { SUSPENDED_MESSAGE } from "@/lib/platform/account-status";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

const appleEnabled = process.env.NEXT_PUBLIC_APPLE_OAUTH_ENABLED === "true";

function subscribeLocation(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}

const LOCATION_ERRORS: Record<string, string> = {
  cancelled: "Google sign-in was cancelled. Try again whenever you’re ready.",
  provider: "Google sign-in is not turned on for FITX yet. Use your email instead.",
  callback: "We couldn’t complete sign-in. Please try again.",
  browser: "That link was opened in a different browser or app. Sign in again here.",
  expired: "That link has expired or was already used. Sign in again, or ask for a new code.",
  suspended: SUSPENDED_MESSAGE,
};

function getLocationError() {
  const query = new URLSearchParams(window.location.search);
  const code = query.get("error");
  if (code && LOCATION_ERRORS[code]) return LOCATION_ERRORS[code];
  return query.has("setup") ? "Account access is not configured in this environment yet." : "";
}

function getLocationNotice() {
  return new URLSearchParams(window.location.search).has("signed_out") ? "You’re signed out on this device." : "";
}

/** The page the visitor was heading to; every consumer cleans it with safeNext. */
const requestedNext = () => new URLSearchParams(window.location.search).get("next");

type Pending = "password" | OAuthProvider | null;

export default function SignInForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState("");
  const emailInput = useRef<HTMLInputElement>(null);
  const reduced = useReducedMotionSafe();
  const codeFlow = useEmailCode(requestedNext);
  const locationError = useSyncExternalStore(subscribeLocation, getLocationError, () => "");
  const notice = useSyncExternalStore(subscribeLocation, getLocationNotice, () => "");
  const visibleError = error || locationError;
  const loading = pending !== null || codeFlow.sending;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setError("");
    const address = email.trim();
    if (!isEmailAddress(address)) {
      setError("Enter your email address.");
      emailInput.current?.focus({ preventScroll: true });
      return;
    }
    if (!open) {
      const problem = await codeFlow.send(address);
      if (problem) setError(problem);
      return;
    }
    if (!password) return setError("Enter your password, or close this and use a code.");
    const supabase = createClient();
    if (!supabase) return setError("Account access is temporarily unavailable. Please try again later.");
    setPending("password");
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email: address, password });
      if (authError) {
        setError(passwordSignInProblem(authError));
        setPending(null);
        return;
      }
      window.location.assign(await finishPasswordSignIn(requestedNext()));
    } catch {
      setError("We couldn’t connect to FITX. Check your connection and try again.");
      setPending(null);
    }
  }

  async function signInWith(provider: OAuthProvider) {
    if (loading) return;
    setError("");
    setPending(provider);
    const problem = await startOAuth(provider, requestedNext());
    if (problem) {
      setError(problem);
      setPending(null);
    }
  }

  const slide = reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.15 } }
    : { initial: { opacity: 0, x: 24 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: -24 }, transition: { duration: DURATION.base, ease: EASE.out } };

  return (
    <AuthScreen footer={codeFlow.step === "email" && <p className={s.account}>New to FITX? <Link href="/signup">Create an account</Link></p>}>
      <AnimatePresence mode="popLayout" initial={false}>
        {codeFlow.step === "code" ? (
          <m.div key="code" className={s.body} {...slide}>
            <EmailCodeStep flow={codeFlow} />
          </m.div>
        ) : (
          <m.div key="email" className={s.body} {...slide}>
            <h1 className={s.title}>Sign in</h1>
            <GoogleButton pending={pending === "google"} disabled={loading} onClick={() => void signInWith("google")} />
            {notice && !visibleError && <p role="status" className={s.notice}>{notice}</p>}
            {!isSupabaseConfigured && <p role="status" className={s.config}>Supabase environment values are missing here.</p>}
            <div className={s.divider}>or</div>
            <form onSubmit={submit} className={s.form} noValidate>
              <label className={s.field}>Email address
                <span className={s.inputWrap}>
                  <Mail size={16} aria-hidden="true" />
                  <input ref={emailInput} className="fitx-field" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
                </span>
              </label>
              {!open && (
                <button type="submit" disabled={loading} className={`fitx-button ${s.primary}`}>
                  {codeFlow.sending ? "Sending code…" : "Email me a code"}
                </button>
              )}
              <details className={s.details} open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
                <summary>Other sign-in options<Plus size={17} aria-hidden="true" /></summary>
                <div className={s.detailsBody}>
                  <label className={s.field}>Password
                    <span className={s.inputWrap}>
                      <LockKeyhole size={16} aria-hidden="true" />
                      <input className="fitx-field" type={visible ? "text" : "password"} autoComplete="current-password" required={open} value={password} onChange={(event) => setPassword(event.target.value)} />
                      <button type="button" className={s.reveal} aria-label={visible ? "Hide password" : "Show password"} onClick={() => setVisible((show) => !show)}>
                        {visible ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
                      </button>
                    </span>
                  </label>
                  {open && (
                    <button type="submit" disabled={loading} className={`fitx-button ${s.primary}`}>
                      {pending === "password" ? "Signing in…" : "Sign in with email"}
                    </button>
                  )}
                  <div className={s.row}>
                    <Link href="/forgot-password" className={s.link}>Forgot password?</Link>
                    {appleEnabled && (
                      <button type="button" disabled={loading} onClick={() => void signInWith("apple")} className={s.link}>
                        <Apple size={15} aria-hidden="true" />Continue with Apple
                      </button>
                    )}
                  </div>
                </div>
              </details>
              {visibleError && <p role="alert" className={s.error}>{visibleError}</p>}
            </form>
          </m.div>
        )}
      </AnimatePresence>
    </AuthScreen>
  );
}
