"use client";

import { useEffect, useRef } from "react";
import { EASE_OUT, prefersReducedMotion } from "./reduced-motion";
import styles from "./motion.module.css";

function format(value: number) {
  return value.toLocaleString("en-IN");
}

/**
 * A count that runs up to its value once it scrolls into view. The server renders the final value, so
 * it reads correctly without JavaScript, for screen readers (which get only the final value) and with
 * reduced motion. null is an en dash labelled "Not known", never 0.
 */
export function CountUp({ value, duration = 900, className }: { value: number | null; duration?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const element = ref.current;
    const text = element?.firstChild;
    if (value === null || !element || !(text instanceof Text) || prefersReducedMotion() || !Number.isFinite(value) || value === 0) return;
    let frame = 0;
    const run = () => {
      const start = performance.now();
      const step = (now: number) => {
        const progress = Math.min(1, (now - start) / duration);
        const eased = 1 - (1 - progress) ** 3;
        text.nodeValue = format(Math.round(value * eased));
        if (progress < 1) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
      element.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: duration / 2, easing: EASE_OUT });
    };
    if (typeof IntersectionObserver === "undefined") {
      run();
      return () => cancelAnimationFrame(frame);
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        run();
      }
    }, { threshold: 0.4 });
    observer.observe(element);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      text.nodeValue = format(value);
    };
  }, [value, duration]);

  if (value === null) return <span className={className} aria-label="Not known">–</span>;
  return (
    <span className={className}>
      <span aria-hidden="true" ref={ref} className={styles.tabular}>{format(value)}</span>
      <span className={styles.srOnly}>{format(value)}</span>
    </span>
  );
}
