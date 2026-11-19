"use client";

import { useRef, type ReactNode } from "react";
import { m, useScroll, useTransform } from "framer-motion";
import { parallaxRange } from "./scroll-math";
import { WIDE_QUERY } from "./tokens";
import { useMediaQuery, useReducedMotionSafe } from "./useReducedMotionSafe";

/**
 * Drifts its content against the scroll, by at most `speed × 100` px over the time it crosses the
 * viewport. Off with reduced motion and below 768 px (and on the server, so hydration never jumps).
 */
export function Parallax({ children, speed = 0.15, className }: { children: ReactNode; speed?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotionSafe();
  const wide = useMediaQuery(WIDE_QUERY, false);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], parallaxRange(speed));
  return <m.div ref={ref} className={className} style={{ y: !reduced && wide ? y : 0 }}>{children}</m.div>;
}
