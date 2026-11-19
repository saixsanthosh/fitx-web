"use client";

import type { ReactNode } from "react";
import { AnimatePresence, type AnimatePresenceProps } from "framer-motion";

/**
 * AnimatePresence with the app's defaults: `mode="popLayout"` (the leaving element stops taking space at
 * once, so lists and panels never stack up) and `initial={false}` (no entrance on the first render).
 * With popLayout, direct children that are custom components must forward their ref.
 */
export function Presence({ mode = "popLayout", initial = false, ...props }: AnimatePresenceProps & { children?: ReactNode }) {
  return <AnimatePresence mode={mode} initial={initial} {...props} />;
}
