"use client";

import { useEffect, useRef, useState } from "react";
import { RESEND_SECONDS, isCompleteCode, sendCodeProblem, verifyCodeProblem } from "@/lib/auth/email-code";
import { finishPasswordSignIn } from "@/lib/auth/finish-sign-in";
import { browserEmailCooldown, cooldownMessage } from "@/lib/auth/send-cooldown";
import { authCallbackUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/client";

const UNAVAILABLE = "Account access is temporarily unavailable. Please try again later.";
const OFFLINE = "We couldn’t connect to FITX. Check your connection and try again.";
const CODE_SENT_MOMENTS_AGO = "A code was sent a moment ago. Use that one, or wait to ask again.";

/**
 * Sign-in with a 6-digit code sent by e-mail. `send` asks Supabase for the code (creating the account on
 * first use, which onboarding then sets up); `verify` checks it, after which the server sets the session
 * and hint cookies and says where to go (finishPasswordSignIn, the same route as a password sign-in).
 * The e-mail also carries a link to /auth/callback on the canonical origin, for anyone who taps it instead.
 */
export function useEmailCode(next: () => string | null) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(0);
  const busy = useRef(false);

  useEffect(() => {
    if (resendAt <= now) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [resendAt, now]);

  const resendIn = Math.max(0, Math.ceil((resendAt - now) / 1000));

  function holdResend(seconds: number) {
    const at = Date.now();
    setNow(at);
    setResendAt(at + seconds * 1000);
  }

  /** Sends a code to `address`; returns a message for the e-mail step, or null once the code step shows. */
  async function send(address: string, { again = false } = {}): Promise<string | null> {
    if (busy.current) return null;
    const supabase = createClient();
    if (!supabase) return UNAVAILABLE;
    // This browser's own email limit survives a reload, Back or another address (src/lib/auth/send-cooldown.ts).
    const cooldown = browserEmailCooldown();
    const wait = cooldown.wait(address);
    if (wait > 0) {
      holdResend(wait);
      if (!cooldown.sentRecently(address)) return cooldownMessage(wait);
      // Asked again within a minute (Change email, Back or a reload): the code already sent still works.
      setError("");
      setNotice(CODE_SENT_MOMENTS_AGO);
      setEmail(address);
      setCode("");
      setStep("code");
      return null;
    }
    busy.current = true;
    setSending(true);
    setError("");
    setNotice("");
    try {
      const { error: authError } = await supabase.auth.signInWithOtp({
        email: address,
        options: { shouldCreateUser: true, emailRedirectTo: authCallbackUrl(next()) },
      });
      if (authError) {
        const problem = sendCodeProblem(authError);
        if (problem.retryAfter === null) return problem.message;
        // A code went out moments ago (a second tap, or a reload): that one still works.
        holdResend(problem.retryAfter);
        setNotice(CODE_SENT_MOMENTS_AGO);
      } else {
        browserEmailCooldown().record(address);
        holdResend(RESEND_SECONDS);
        if (again) setNotice("New code sent.");
      }
      setEmail(address);
      setCode("");
      setStep("code");
      return null;
    } catch {
      return OFFLINE;
    } finally {
      busy.current = false;
      setSending(false);
    }
  }

  async function resend() {
    if (resendIn > 0) return;
    const problem = await send(email, { again: true });
    if (problem) setError(problem);
  }

  async function verify(value: string) {
    if (busy.current || !isCompleteCode(value)) return;
    const supabase = createClient();
    if (!supabase) return setError(UNAVAILABLE);
    busy.current = true;
    setVerifying(true);
    setError("");
    setNotice("");
    try {
      const { error: authError } = await supabase.auth.verifyOtp({ email, token: value, type: "email" });
      if (authError) {
        setError(verifyCodeProblem(authError));
        setVerifying(false);
        busy.current = false;
        return;
      }
      setSigningIn(true);
      window.location.assign(await finishPasswordSignIn(next()));
    } catch {
      setError(OFFLINE);
      setVerifying(false);
      busy.current = false;
    }
  }

  function back() {
    setStep("email");
    setCode("");
    setError("");
    setNotice("");
  }

  return { step, email, code, setCode, sending, verifying, signingIn, error, notice, resendIn, send, resend, verify, back };
}

export type EmailCode = ReturnType<typeof useEmailCode>;
