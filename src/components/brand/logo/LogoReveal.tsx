"use client";

import { useCallback, useEffect, useId, useRef, type CSSProperties } from "react";
import { FitxMark } from "@/components/ui/FitxMark";
import { cn } from "@/lib/utils";
import { FITX_MARK_PATHS, FITX_MARK_VIEWBOX } from "./geometry";
import { REVEAL_REDUCED_MS, REVEAL_TOTAL_MS, revealPlan, type LogoRevealVariant } from "./reveal-plan";
import styles from "./LogoReveal.module.css";

export type { LogoRevealVariant } from "./reveal-plan";

type LogoRevealProps = {
  variant: LogoRevealVariant;
  /** Called once, when the reveal has finished or was skipped. */
  onDone?: () => void;
  /** The mark's size in px. By default it follows the screen (never cropped, 120 to 260 px). */
  size?: number;
  className?: string;
};

/**
 * The FITX logo reveal: a full stage on which the mark writes itself from its real strokes (FitxMark's formation),
 * the plates slide onto the bar, an ember light passes across the metal and the wordmark rises underneath. About
 * 2.1 s ("film-end" holds on the logo instead of fading, 1.8 s), never longer than 2.2 s, with a Skip button. CSS
 * only (transform and opacity), so it plays from the first paint, before the app hydrates; `onDone` follows the
 * real animations (or 400 ms of the still logo with reduced motion). Idle while hidden (display: none).
 */
export function LogoReveal({ variant, onDone, size, className }: LogoRevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const finished = useRef(false);
  const onDoneRef = useRef(onDone);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const plan = revealPlan(variant);

  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    onDoneRef.current?.();
  }, []);

  useEffect(() => {
    const stage = ref.current;
    // Not on screen (a reveal rendered ahead of time and kept hidden): nothing plays, so nothing ends.
    if (!stage || stage.getClientRects().length === 0) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const cap = window.setTimeout(finish, reduced ? REVEAL_REDUCED_MS : plan.totalMs + 200);
    if (!reduced && typeof stage.getAnimations === "function") {
      const running = stage.getAnimations({ subtree: true });
      Promise.all(running.map((animation) => animation.finished)).then(finish, () => undefined);
    }
    return () => window.clearTimeout(cap);
  }, [finish, plan.totalMs]);

  const style = { "--reveal-size": size ? `${size}px` : undefined } as CSSProperties;
  return (
    <div ref={ref} className={cn(styles.stage, styles[plan.className], className)} style={style} data-logo-reveal={variant}>
      <span className={styles.glow} aria-hidden="true" />
      <div className={styles.lockup}>
        <div className={styles.markBox}>
          <span className={styles.floor} aria-hidden="true" />
          <FitxMark animate className={styles.mark} />
          <svg className={styles.sheen} viewBox={FITX_MARK_VIEWBOX} aria-hidden="true" focusable="false">
            <defs>
              <clipPath id={`rv${uid}-mark`} clipPathUnits="userSpaceOnUse">
                {FITX_MARK_PATHS.map(({ id, d }) => <path key={id} d={d} />)}
              </clipPath>
              <linearGradient id={`rv${uid}-light`} x1="0" x2="1" y1="0" y2="0">
                <stop offset="0" className={styles.lightEdge} />
                <stop offset="0.5" className={styles.lightCore} />
                <stop offset="1" className={styles.lightEdge} />
              </linearGradient>
            </defs>
            <g clipPath={`url(#rv${uid}-mark)`}>
              <rect className={styles.beam} x="-260" y="-200" width="220" height="1000" fill={`url(#rv${uid}-light)`} />
            </g>
          </svg>
        </div>
        {plan.wordmark && (
          <span className={styles.word} aria-hidden="true">
            {"FITX".split("").map((letter, index) => (
              <span key={index} className={styles.letterClip}>
                <span className={cn("fitx-wordmark", styles.letter)} style={{ "--i": index } as CSSProperties}>{letter}</span>
              </span>
            ))}
          </span>
        )}
        <span className={styles.rule} aria-hidden="true" />
      </div>
      <span className="sr-only">FITX</span>
      <button type="button" className={styles.skip} onClick={finish} data-fitx-welcome-skip="">
        Skip
      </button>
    </div>
  );
}

export { REVEAL_TOTAL_MS };
