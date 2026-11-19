"use client";

import { useRef, type CSSProperties, type ReactNode } from "react";
import { useMotionValue, useScroll, type MotionValue } from "framer-motion";
import styles from "./motion.module.css";
import { REDUCED_MOTION_QUERY } from "./tokens";
import { useMediaQuery } from "./useReducedMotionSafe";

type ScrollSceneProps = {
  /** Section height in viewports (default 3). */
  length?: number;
  /** Accessible name of the section (it is a region). */
  label: string;
  className?: string;
  /** Stage class (layout of the sticky full-viewport stage). */
  stageClassName?: string;
  id?: string;
  /** Draws the stage for a scroll progress from 0 (pinned at the top) to 1 (about to leave). */
  children: (progress: MotionValue<number>) => ReactNode;
};

/**
 * A section `length × 100svh` tall whose stage stays pinned while the section scrolls past. `progress`
 * runs from 0 when the section's top reaches the top of the viewport to 1 when its bottom reaches the
 * bottom. Derive transforms with `useTransform(progress, …)` and animate only transform and opacity.
 *
 * Reduced motion: an ordinary one-screen section and `progress` fixed at 1, so children must make
 * sense in their final state. (The server renders progress 0, the state at the top of the page.)
 */
export function ScrollScene({ length = 3, label, className = "", stageClassName = "", id, children }: ScrollSceneProps) {
  const ref = useRef<HTMLElement>(null);
  const reduced = useMediaQuery(REDUCED_MOTION_QUERY, false);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const still = useMotionValue(1);
  return (
    <section ref={ref} id={id} aria-label={label} className={`${styles.scene} ${className}`} style={{ "--fitx-scene-length": Math.max(1, length) } as CSSProperties}>
      <div className={`${styles.stage} ${stageClassName}`}>{children(reduced ? still : scrollYProgress)}</div>
    </section>
  );
}
