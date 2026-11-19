"use client";

import { useLayoutEffect, useRef } from "react";
import { animate, inView } from "framer-motion";
import { countStart, defaultCountFormat, displayCount, isKnown, UNKNOWN_LABEL, UNKNOWN_MARK } from "./count-format";
import { EASE } from "./tokens";
import { useReducedMotionSafe } from "./useReducedMotionSafe";

/** Writes into React's own text node (never replaces it), so React's later updates still land. */
function write(el: HTMLElement, text: string) {
  const node = el.firstChild;
  if (node && node.nodeType === Node.TEXT_NODE) node.nodeValue = text;
  else el.textContent = text;
}

type CountUpProps = {
  /** null (or undefined) means not known: an en dash, never 0. */
  value: number | null | undefined;
  format?: (value: number) => string;
  /** Seconds (default 0.8). */
  duration?: number;
  className?: string;
};

/**
 * A number that counts up to its value: when it first scrolls into view (if it started below the fold),
 * and from the old value whenever the value changes. Screen readers only ever get the final value.
 * Reduced motion, and the server: the final value straight away.
 */
export function CountUp({ value, format = defaultCountFormat, duration = 0.8, className }: CountUpProps) {
  const visible = useRef<HTMLSpanElement>(null);
  const shown = useRef<number | null>(null);
  const reduced = useReducedMotionSafe();
  const known = isKnown(value);
  const target = known ? value : null;
  const formatRef = useRef(format);

  useLayoutEffect(() => {
    formatRef.current = format;
  });

  useLayoutEffect(() => {
    const el = visible.current;
    const previous = shown.current;
    shown.current = target;
    if (!el || target === null || reduced) return;
    const run = (from: number) => {
      write(el, formatRef.current(from));
      return animate(from, target, { duration, ease: EASE.out, onUpdate: (n) => write(el, formatRef.current(n)) });
    };
    if (previous !== null) {
      if (previous === target) return;
      const controls = run(countStart(previous));
      return () => controls.stop();
    }
    // First known value: count from 0 only if the number is off screen now, else leave the final value.
    if (el.getBoundingClientRect().top < window.innerHeight) return;
    write(el, formatRef.current(0));
    let controls: { stop: () => void } | null = null;
    const stop = inView(el, () => {
      controls = run(0);
      stop();
    }, { amount: 0.6 });
    return () => {
      stop();
      controls?.stop();
      write(el, formatRef.current(target));
    };
  }, [target, reduced, duration]);

  if (!known) return <span role="img" aria-label={UNKNOWN_LABEL} className={className}>{UNKNOWN_MARK}</span>;
  const final = displayCount(value, format);
  return (
    <span className={className}>
      <span aria-hidden="true" ref={visible} className="tabular-nums">{final}</span>
      <span className="sr-only">{final}</span>
    </span>
  );
}
