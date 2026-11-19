"use client";

import { createElement, useEffect, useState, type ReactNode } from "react";
import { armReveal } from "./reveal-core";
import { useReducedMotionSafe } from "./useReducedMotionSafe";

export type RevealTag = "div" | "section" | "article" | "header" | "footer" | "li" | "ul" | "ol" | "p" | "span" | "figure" | "aside";

type RevealProps = {
  children: ReactNode;
  /** The element to render (default div). */
  as?: RevealTag;
  /** Seconds before it starts. */
  delay?: number;
  /** Lift in px (default 16). */
  y?: number;
  /** Reveal once (default) or every time it enters. */
  once?: boolean;
  /** Share of the element that must be visible, 0 to 1 (default 0.3). */
  amount?: number;
  className?: string;
  id?: string;
};

/**
 * Fades and lifts its content in when it scrolls into view. Server-rendered visible; only content that
 * starts below the fold is hidden first. Reduced motion: content is simply there.
 */
export function Reveal({ children, as = "div", delay = 0, y = 16, once = true, amount = 0.3, className, id }: RevealProps) {
  // A callback ref (state), so the effect re-runs if the element is replaced.
  const [el, setEl] = useState<HTMLElement | null>(null);
  const reduced = useReducedMotionSafe();
  useEffect(() => {
    if (!el || reduced) return;
    return armReveal(el, [el], { y, delay, gap: 0, once, amount });
  }, [el, reduced, y, delay, once, amount]);
  return createElement(as, { ref: setEl, className, id }, children);
}
