"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useReducedMotionSafe } from "@/components/motion";
import { Logo } from "@/components/ui/Logo";
import { POST_ONBOARDING_FILM } from "@/components/onboarding/post-onboarding-film";
import { logoHoldMs, postOnboardingSteps, type PostStep } from "@/lib/onboarding/post-sequence";
import styles from "./PostOnboarding.module.css";

/**
 * What plays once onboarding is finished (owner's phase 4, steps 4 to 6): the post-onboarding film (wave 2; none
 * yet), then the FITX logo reveal, then `onDone` (which loads Home). Skipped entirely when the device still owes
 * the account its intro film, which ends on the logo itself. A Skip button is always there, and each step ends on
 * its own, so nobody is held up.
 */
export function PostOnboardingSequence({ onDone }: { onDone: () => void }) {
  const reduced = useReducedMotionSafe();
  // Shown only after onboarding's last save, in the browser, so the cookie can be read on the first render.
  const [steps] = useState<PostStep[]>(() =>
    typeof document === "undefined" ? ["logo"] : postOnboardingSteps({ cookies: document.cookie, hasFilm: POST_ONBOARDING_FILM !== null }));
  const [index, setIndex] = useState(0);
  const finished = useRef(false);
  const skipRef = useRef<HTMLButtonElement>(null);

  const done = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    onDone();
  }, [onDone]);

  // Nothing to play (the account film is pending and ends on the logo itself): straight on.
  useEffect(() => {
    if (!steps.length) done();
  }, [steps, done]);

  const step = steps[index] ?? null;
  const next = useCallback(() => {
    if (index + 1 >= steps.length) done();
    else setIndex(index + 1);
  }, [steps, index, done]);

  useEffect(() => {
    if (step !== "logo") return;
    skipRef.current?.focus({ preventScroll: true });
    const timer = window.setTimeout(next, logoHoldMs(reduced));
    return () => window.clearTimeout(timer);
  }, [step, next, reduced]);

  if (!step) return <div className={styles.stage} aria-hidden="true" />;

  const Film = POST_ONBOARDING_FILM;
  if (step === "film" && Film) return <Film onEnd={next} />;

  return (
    <div className={`${styles.stage} ${reduced ? styles.still : ""}`} role="dialog" aria-modal="true" aria-label="Welcome to FITX">
      <div className={styles.glow} aria-hidden="true" />
      <div className={styles.mark}>
        <Logo size={88} animateMark={!reduced} className={styles.logo} />
        <span className={styles.sweep} aria-hidden="true" />
      </div>
      <p className={styles.line}>You’re all set.</p>
      <button ref={skipRef} type="button" className={styles.skip} onClick={done}>Skip</button>
    </div>
  );
}
