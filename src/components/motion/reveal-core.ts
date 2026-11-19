"use client";

import { animate, inView, stagger } from "framer-motion";
import { DURATION, EASE } from "./tokens";

export type RevealOptions = {
  /** Lift in px (0 for a pure fade). */
  y: number;
  /** Seconds before the first element moves. */
  delay: number;
  /** Seconds between elements (stagger). */
  gap: number;
  /** Reveal once (default), or hide again when it leaves the viewport. */
  once: boolean;
  /** How much of the element must be visible, 0 to 1. */
  amount: number;
};

/** Below the bottom of the viewport, so hiding it now cannot be seen. */
export function startsBelowFold(top: number, viewportHeight: number) {
  return top >= viewportHeight;
}

/**
 * Hides `targets` and reveals them when `root` scrolls into view. Only elements that start below the
 * fold are hidden, so the server-rendered first viewport never blinks out and back in. Returns a cleanup.
 * Callers skip this entirely for reduced motion (content then simply stays visible).
 */
export function armReveal(root: HTMLElement, targets: HTMLElement[], { y, delay, gap, once, amount }: RevealOptions): () => void {
  if (!targets.length || !startsBelowFold(root.getBoundingClientRect().top, window.innerHeight)) return () => undefined;
  const hide = () => {
    for (const el of targets) {
      el.style.opacity = "0";
      el.style.transform = y ? `translateY(${y}px)` : "";
    }
  };
  hide();
  let running: { stop: () => void } | null = null;
  const stop = inView(root, () => {
    running = animate(targets, { opacity: 1, transform: "translateY(0px)" }, { duration: DURATION.slow, ease: EASE.out, delay: gap ? stagger(gap, { startDelay: delay }) : delay });
    if (once) {
      stop();
      return;
    }
    return () => {
      running?.stop();
      hide();
    };
  }, { amount });
  return () => {
    stop();
    running?.stop();
    for (const el of targets) {
      el.style.opacity = "";
      el.style.transform = "";
    }
  };
}
