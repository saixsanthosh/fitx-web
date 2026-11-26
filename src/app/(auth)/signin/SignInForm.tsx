"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { AnimatePresence, m } from "framer-motion";
import { Apple, Eye, EyeOff, LockKeyhole, Mail, Plus } from "lucide-react";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { useEarlySubmit } from "@/components/auth/early-submit";
import { EmailCodeStep } from "@/components/auth/EmailCodeStep";
import { FieldProblemText } from "@/components/auth/FieldProblem";
import { startOAuth, type OAuthProvider } from "@/components/auth/GoogleButton";
import { GoogleSignIn } from "@/components/auth/GoogleSignIn";
import { useBringIntoView } from "@/components/auth/useBringIntoView";
import { useEmailCode } from "@/components/auth/useEmailCode";
import { useHydrated, useKeepOpenState, useKeepTypedValue } from "@/components/auth/useKeepTypedValue";
import s from "@/components/auth/auth.module.css";
import { DURATION, EASE, useReducedMotionSafe } from "@/components/motion";
import { addressError, addressNotice, takeNoticeProof, withoutAddressMessages } from "@/lib/auth/address-messages";
import { passwordSignInProblem } from "@/lib/auth/email-code";
import { finishLateSignIn, finishPasswordSignIn, leaveSignInPage } from "@/lib/auth/finish-sign-in";
import { fieldIds, fieldInvalid, signInFormProblem, type AuthField, type FieldProblem } from "@/lib/auth/form-problems";
import { focusAfterStep, type SignInStep } from "@/lib/auth/step-focus";
import { isTimeLimit, TIMED_OUT, TIME_LIMIT_MS, withTimeLimit } from "@/lib/auth/time-limit";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

const appleEnabled = process.env.NEXT_PUBLIC_APPLE_OAUTH_ENABLED === "true";

function subscribeLocation(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}

/**
 * What the address says happened (src/lib/auth/address-messages.ts): a sign-in that came back, or signing out. A claim
 * a link could make falsely needs more than the address: "signed out everywhere" the proof this browser's own sign-out
 * left (read once), "not configured" this page's own finding.
 */
const noticeProof = () => takeNoticeProof(document, window.location.protocol === "https:");
const getLocationError = () => addressError(window.location.search, isSupabaseConfigured);
const getLocationNotice = () => addressNotice(window.location.search, noticeProof());

/** The page the visitor was heading to; every consumer cleans it with safeNext. */
const requestedNext = () => new URLSearchParams(window.location.search).get("next");

type Pending = "password" | OAuthProvider | null;

export default function SignInForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  /** A problem with one field, under that field (bug 45). */
  const [fieldProblem, setFieldProblem] = useState<FieldProblem | null>(null);
  /** Why the last code or password sign-in failed, under the button that is showing. */
  const [error, setError] = useState("");
  /** Why Google (or Apple) sign-in failed, under the Google button. */
  const [providerError, setProviderError] = useState("");
  const [addressDismissed, setAddressDismissed] = useState(false);
  const emailInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const options = useRef<HTMLDetailsElement>(null);
  /** The failure under whichever button shows ("Email me a code", or the panel's own). */
  const failureText = useRef<HTMLParagraphElement>(null);
  const baseId = useId();
  const ids = fieldIds(baseId);
  // Whatever was typed (or opened) before the page's scripts ran stays: the render right after hydration would wipe it.
  useKeepTypedValue(emailInput, email, setEmail);
  useKeepTypedValue(passwordInput, password, setPassword);
  useKeepOpenState(options, open, setOpen);
  const hydrated = useHydrated();
  // A press of Enter or of the button before the page is ready is held, then sent once it is (early-submit.ts).
  const formRef = useRef<HTMLFormElement>(null);
  const replayEarlySubmit = useEarlySubmit(formRef);
  const reduced = useReducedMotionSafe();
  const codeFlow = useEmailCode(requestedNext);
  const locationError = useSyncExternalStore(subscribeLocation, getLocationError, () => "");
  const locationNotice = useSyncExternalStore(subscribeLocation, getLocationNotice, () => "");
  // What the address said happened shows until the member acts on the page (dismissAddressMessages).
  const notice = addressDismissed ? "" : locationNotice;
  const pageError = providerError || (addressDismissed ? "" : locationError);
  const loading = pending !== null || codeFlow.sending;
  // The failure sits under the button, which keeps focus: it scrolls into view, clear of the privacy banner (bug 43).
  useBringIntoView(failureText, error);

  // Back from the code step ("Change email"): focus goes to the email field, not to the page (bug 81).
  const shownStep = useRef<SignInStep>(codeFlow.step);
  useEffect(() => {
    if (focusAfterStep(shownStep.current, codeFlow.step) === "email") emailInput.current?.focus({ preventScroll: true });
    shownStep.current = codeFlow.step;
  }, [codeFlow.step]);

  /**
   * The member is acting on the page, so what the address said happened (an expired link, a sign-out) is the past: it
   * stops showing and leaves the address too, keeping ?next=, so neither the email step nor a reload shows it again.
   */
  function dismissAddressMessages() {
    setAddressDismissed(true);
    const search = withoutAddressMessages(window.location.search);
    if (search !== window.location.search) window.history.replaceState(null, "", `${window.location.pathname}${search}${window.location.hash}`);
  }

  /** Shows a problem under its field, and takes the member there to fix it. */
  function showProblem(found: FieldProblem) {
    setFieldProblem(found);
    const field: Partial<Record<AuthField, HTMLInputElement | null>> = { email: emailInput.current, password: passwordInput.current };
    field[found.field]?.focus({ preventScroll: found.field === "email" });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    dismissAddressMessages();
    setFieldProblem(null);
    setError("");
    setProviderError("");
    const found = signInFormProblem({ email, password, withPassword: open });
    if (found) return showProblem(found);
    const address = email.trim();
    if (!open) {
      const failure = await codeFlow.send(address);
      if (failure) setError(failure);
      return;
    }
    const supabase = createClient();
    if (!supabase) return setError("Account access is temporarily unavailable. Please try again later.");
    setPending("password");
    try {
      // A sign-in that hangs ends at its time limit with a plain message, and the button works again.
      const { error: authError } = await withTimeLimit(
        supabase.auth.signInWithPassword({ email: address, password }),
        TIME_LIMIT_MS.check,
        ({ error: late }) => {
          if (!late) finishLateSignIn(requestedNext());
        },
      );
      if (authError) {
        setError(passwordSignInProblem(authError));
        setPending(null);
        return;
      }
      leaveSignInPage(await finishPasswordSignIn(requestedNext()));
    } catch (problem) {
      setError(isTimeLimit(problem) ? TIMED_OUT.signIn : "We couldn’t connect to FITX. Check your connection and try again.");
      setPending(null);
    }
  }

  async function signInWith(provider: OAuthProvider) {
    if (loading) return;
    dismissAddressMessages();
    setError("");
    setProviderError("");
    setPending(provider);
    const failure = await startOAuth(provider, requestedNext());
    if (failure) {
      setProviderError(failure);
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
            <GoogleSignIn
              context="signin"
              next={requestedNext}
              disabled={loading}
              redirectPending={pending === "google"}
              onRedirect={() => void signInWith("google")}
              onError={setProviderError}
              onBusy={(busy) => {
                if (busy) dismissAddressMessages();
                setPending(busy ? "google" : null);
              }}
            />
            {/* What happened before (an expired link, a sign-out) and Google's own failures, next to Google's button. */}
            {pageError ? <p role="alert" className={s.error}>{pageError}</p> : notice && <p role="status" className={s.notice}>{notice}</p>}
            {!isSupabaseConfigured && <p role="status" className={s.config}>Supabase environment values are missing here.</p>}
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
                  <button type="submit" aria-disabled={loading || undefined} className={`fitx-button ${s.primary}`}>
                    {codeFlow.sending ? "Sending code…" : "Email me a code"}
                  </button>
                  {error && <p ref={failureText} role="alert" className={s.error}>{error}</p>}
                </>
              )}
              <details
                ref={options}
                className={s.details}
                open={open}
                onToggle={(event) => {
                  const nowOpen = event.currentTarget.open;
                  setOpen(nowOpen);
                  // A failure belongs to the button that showed it, and the password's problem to its field: both go
                  // when the panel that holds them is opened or shut.
                  if (nowOpen !== open) {
                    setError("");
                    if (fieldProblem?.field === "password") setFieldProblem(null);
                  }
                }}
              >
                <summary>Other sign-in options<Plus size={17} aria-hidden="true" /></summary>
                <div className={s.detailsBody}>
                  {/* The label holds only the field: wrapped around the Show password button too, it named the box
                      "Password Show password". The button sits beside the field, named for itself. */}
                  <div className={s.field}>
                    <label htmlFor={ids.input("password")}>Password</label>
                    <span className={s.inputWrap}>
                      <LockKeyhole size={16} aria-hidden="true" />
                      <input ref={passwordInput} id={ids.input("password")} className="fitx-field" type={visible ? "text" : "password"} autoComplete="current-password" required={open} value={password} onChange={(event) => setPassword(event.target.value)} {...fieldInvalid(fieldProblem, "password", ids)} />
                      <button type="button" className={s.reveal} aria-label={visible ? "Hide password" : "Show password"} aria-controls={ids.input("password")} onClick={() => setVisible((show) => !show)}>
                        {visible ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
                      </button>
                    </span>
                    <FieldProblemText problem={fieldProblem} field="password" ids={ids} />
                  </div>
                  {open && (
                    <>
                      <button type="submit" aria-disabled={loading || undefined} className={`fitx-button ${s.primary}`}>
                        {pending === "password" ? "Signing in…" : "Sign in with email"}
                      </button>
                      {error && <p ref={failureText} role="alert" className={s.error}>{error}</p>}
                    </>
                  )}
                  <div className={s.row}>
                    <Link href="/forgot-password" className={s.link}>Forgot password?</Link>
                    {appleEnabled && (
                      <button type="button" aria-disabled={loading || undefined} onClick={() => void signInWith("apple")} className={s.link}>
                        <Apple size={15} aria-hidden="true" />Continue with Apple
                      </button>
                    )}
                  </div>
                </div>
              </details>
            </form>
          </m.div>
        )}
      </AnimatePresence>
    </AuthScreen>
  );
}
