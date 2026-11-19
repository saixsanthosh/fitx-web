"use client";

import type { ReactNode } from "react";
import { LazyMotion, MotionConfig, domAnimation } from "framer-motion";

/**
 * Mounted once in the root layout. Loads framer-motion's DOM animation features lazily (use `m.*`, not
 * `motion.*`, so the bundle stays small) and makes every animation follow the visitor's reduced-motion
 * setting. Not strict: the existing drag-to-reorder lists use `Reorder`, which brings its own features.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation}>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}
