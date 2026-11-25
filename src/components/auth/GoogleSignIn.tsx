"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { finishLateSignIn, finishPasswordSignIn } from "@/lib/auth/finish-sign-in";
import { configuredGoogleClientId, createNonce, idTokenProblem, loadGoogleIdentity, type GoogleId } from "@/lib/auth/google-identity";
import { isTimeLimit, TIMED_OUT, TIME_LIMIT_MS, withTimeLimit } from "@/lib/auth/time-limit";
import { isSuspendedError, SUSPENDED_MESSAGE } from "@/lib/platform/account-status";
import { createClient } from "@/lib/supabase/client";
import { GoogleButton } from "./GoogleButton";
import s from "./auth.module.css";

type Props = {
  /** Sign-in or sign-up wording on Google's button. */
  context: "signin" | "signup";
  /** The page asked for after sign-in (cleaned by the server). */
  next: () => string | null;
  /** Another sign-in is in flight: the redirect button is disabled and Google's button is covered. */
  disabled: boolean;
  /** The redirect button's own state (used when Google's button is not available). */
  redirectPending: boolean;
  onRedirect: () => void;
  onError: (message: string) => void;
  /** A Google sign-in is being finished. */
  onBusy?: (busy: boolean) => void;
};

type Mode = "loading" | "gis" | "redirect";

function readDark() {
  const saved = document.documentElement.dataset.theme;
  if (saved === "light" || saved === "dark") return saved === "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}
function subscribeDark(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onChange);
  return () => {
    observer.disconnect();
    media.removeEventListener("change", onChange);
  };
}

/**
 * "Continue with Google". With NEXT_PUBLIC_GOOGLE_CLIENT_ID set it is Google's own button (Google Identity Services),
 * so Google's consent screen names FITX; the token goes to supabase.auth.signInWithIdToken with the attempt's nonce,
 * then through /api/auth/session like every other sign-in (cookies, onboarding, the returning-login reveal).
 * Without a client id, or if Google's script fails, it is the redirect button as before.
 */
export function GoogleSignIn({ context, next, disabled, redirectPending, onRedirect, onError, onBusy }: Props) {
  const clientId = configuredGoogleClientId();
  const [mode, setMode] = useState<Mode>(clientId ? "loading" : "redirect");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const slot = useRef<HTMLDivElement>(null);
  const api = useRef<GoogleId | null>(null);
  const dark = useSyncExternalStore(subscribeDark, readDark, () => false);
  const callbacks = useRef({ next, onError, onBusy });
  useEffect(() => {
    callbacks.current = { next, onError, onBusy };
  }, [next, onError, onBusy]);

  useEffect(() => {
    if (!clientId || mode === "redirect") return;
    let cancelled = false;
    (async () => {
      let google: GoogleId;
      try {
        google = api.current ?? (await loadGoogleIdentity());
      } catch {
        if (!cancelled) setMode("redirect");
        return;
      }
      if (cancelled || !slot.current) return;
      api.current = google;
      const nonce = await createNonce();
      if (cancelled || !slot.current) return;
      google.initialize({
        client_id: clientId,
        nonce: nonce.hashed,
        ux_mode: "popup",
        context,
        auto_select: false,
        itp_support: true,
        callback: (response) => {
          if (!response.credential) return;
          void finish(response.credential, nonce.raw);
        },
      });
      const width = Math.round(Math.min(400, Math.max(220, slot.current.getBoundingClientRect().width)));
      slot.current.replaceChildren();
      google.renderButton(slot.current, {
        type: "standard",
        theme: dark ? "outline" : "filled_black",
        size: "large",
        text: context === "signup" ? "signup_with" : "continue_with",
        shape: "rectangular",
        logo_alignment: "center",
        width,
        locale: "en-GB",
      });
      setMode("gis");
    })().catch(() => !cancelled && setMode("redirect"));

    async function finish(token: string, raw: string) {
      const supabase = createClient();
      if (!supabase) return callbacks.current.onError("Account access is temporarily unavailable. Please try again later.");
      setBusy(true);
      callbacks.current.onBusy?.(true);
      callbacks.current.onError("");
      try {
        const { error } = await withTimeLimit(
          supabase.auth.signInWithIdToken({ provider: "google", token, nonce: raw }),
          TIME_LIMIT_MS.check,
          ({ error: late }) => {
            if (!late) finishLateSignIn(callbacks.current.next());
          },
        );
        if (error) {
          const problem = idTokenProblem(error);
          callbacks.current.onError(isSuspendedError(error) ? SUSPENDED_MESSAGE : problem.message);
          setBusy(false);
          callbacks.current.onBusy?.(false);
          if (problem.fallback) setMode("redirect");
          else setAttempt((n) => n + 1); // A fresh nonce for the next try.
          return;
        }
        window.location.assign(await finishPasswordSignIn(callbacks.current.next()));
      } catch (problem) {
        callbacks.current.onError(isTimeLimit(problem) ? TIMED_OUT.google : "We couldn’t connect to FITX. Check your connection and try again.");
        setBusy(false);
        callbacks.current.onBusy?.(false);
        setAttempt((n) => n + 1);
      }
    }
    return () => {
      cancelled = true;
    };
    // `mode` is left out on purpose: only a switch to "redirect" matters, and that is checked above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, context, dark, attempt]);

  if (mode === "redirect") return <GoogleButton pending={redirectPending} disabled={disabled} onClick={onRedirect} />;
  return (
    <div className={s.gis} data-state={mode} aria-busy={busy || mode === "loading"}>
      <div ref={slot} className={s.gisSlot} />
      {(busy || disabled) && <div className={s.gisCover} aria-hidden="true" />}
      {busy && <p role="status" className={s.gisStatus}>Signing in with Google…</p>}
    </div>
  );
}
