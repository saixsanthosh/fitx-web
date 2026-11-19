"use client";

import { createElement, useEffect, useState, type ReactNode } from "react";
import type { RevealTag } from "./Reveal";
import { armReveal } from "./reveal-core";
import { useReducedMotionSafe } from "./useReducedMotionSafe";

const ITEM = "data-fitx-stagger-item";

type StaggerProps = {
  children: ReactNode;
  as?: RevealTag;
  /** Seconds between items (default 0.06). */
  gap?: number;
  /** Lift in px for each item (default 16). */
  y?: number;
  delay?: number;
  once?: boolean;
  amount?: number;
  className?: string;
  id?: string;
};

/**
 * Reveals its `StaggerItem` children one after another when the group scrolls into view (only the
 * items directly owned by this group, not those of a nested Stagger). Reduced motion: all at once.
 */
export function Stagger({ children, as = "div", gap = 0.06, y = 16, delay = 0, once = true, amount = 0.2, className, id }: StaggerProps) {
  // A callback ref (state), so the effect re-runs if the element is replaced.
  const [el, setEl] = useState<HTMLElement | null>(null);
  const reduced = useReducedMotionSafe();
  useEffect(() => {
    if (!el || reduced) return;
    const items = [...el.querySelectorAll<HTMLElement>(`[${ITEM}]`)].filter((item) => item.parentElement?.closest("[data-fitx-stagger]") === el);
    return armReveal(el, items, { y, delay, gap, once, amount });
  }, [el, reduced, gap, y, delay, once, amount]);
  return createElement(as, { ref: setEl, className, id, "data-fitx-stagger": "" }, children);
}

/** One step of a `Stagger` group. */
export function StaggerItem({ children, as = "div", className }: { children: ReactNode; as?: RevealTag; className?: string }) {
  return createElement(as, { className, [ITEM]: "" }, children);
}
