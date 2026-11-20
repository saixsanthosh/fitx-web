"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { EASE_OUT, prefersReducedMotion } from "./reduced-motion";
import styles from "./motion.module.css";

/** The first path segment: moving inside one section (a list to a detail page) is not a section change. */
function sectionOf(pathname: string) {
  return pathname.split("/")[1] ?? "";
}

/**
 * Section transitions: the page eases in and a hairline sweeps the top edge when the section changes.
 * Transform and opacity only, through the Web Animations API (no inline styles under the strict CSP).
 * Nothing moves with reduced motion.
 */
export function RouteTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const section = sectionOf(pathname);
  const pageRef = useRef<HTMLDivElement>(null);
  const sweepRef = useRef<HTMLSpanElement>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    // The first page arrives already painted by the server; only later section changes move.
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (prefersReducedMotion()) return;
    const animations = [
      pageRef.current?.animate(
        [{ opacity: 0, transform: "translate3d(0, 14px, 0)" }, { opacity: 1, transform: "translate3d(0, 0, 0)" }],
        { duration: 420, easing: EASE_OUT },
      ),
      sweepRef.current?.animate(
        [
          { opacity: 1, transform: "scaleX(0)" },
          { opacity: 1, transform: "scaleX(1)", offset: 0.7 },
          { opacity: 0, transform: "scaleX(1)" },
        ],
        { duration: 700, easing: EASE_OUT },
      ),
    ];
    return () => animations.forEach((animation) => animation?.cancel());
  }, [section]);

  return (
    <>
      <span ref={sweepRef} className={styles.sweep} aria-hidden="true" />
      <div ref={pageRef} className={styles.page}>{children}</div>
    </>
  );
}
