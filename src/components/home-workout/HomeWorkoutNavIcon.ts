"use client";

// Written with createElement (no JSX) and without a CSS module, so the navigation config, which imports it,
// stays loadable by the node:test unit tests (as ActivityNavIcon is).
import { createElement, useEffect, useState } from "react";
import { m } from "framer-motion";
import { EASE } from "@/components/motion/tokens";
import { usePageVisible, useReducedMotionSafe } from "@/components/motion/useReducedMotionSafe";

/** How long each pose shows, crossfade included (ms): standing, then sitting into a squat. */
export const SQUAT_POSE_MS = 1200;
const FADE = { duration: 0.3, ease: EASE.inOut };

export type HomeWorkoutNavIconProps = { size?: number; className?: string; active?: boolean };

/** Standing for even pose slots, squatting for odd ones: every icon on the page shows the same pose. */
export function squatAt(time: number): boolean {
  return Math.floor(time / SQUAT_POSE_MS) % 2 === 1;
}

/**
 * The Home workout menu icon: FITX's figure standing, then sitting into a squat, on a loop. It stays
 * standing with reduced motion, while the tab is hidden, and on the server. Decorative (aria-hidden): the
 * link's text names it. Same props as the other menu icons.
 */
export function HomeWorkoutNavIcon({ size = 20, className, active = false }: HomeWorkoutNavIconProps) {
  const reduced = useReducedMotionSafe();
  const visible = usePageVisible();
  const [down, setDown] = useState(false);
  const running = !reduced && visible;

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setDown(squatAt(Date.now())), SQUAT_POSE_MS / 4);
    return () => window.clearInterval(id);
  }, [running]);

  const squat = running && down;
  return createElement(
    "svg",
    {
      width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: active ? 2.2 : 1.9,
      strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, focusable: "false", className, overflow: "visible",
      "data-pose": squat ? "squat" : "stand",
    },
    createElement(m.g, { initial: false, animate: { opacity: squat ? 0 : 1 }, transition: FADE },
      createElement("circle", { cx: 12, cy: 3.6, r: 1.7, fill: "currentColor", stroke: "none" }),
      createElement("path", { d: "M12 6.6v6.4M12 13l-1.8 8.2M12 13l1.8 8.2M12 7.4l-2.8 4.8M12 7.4l2.8 4.8" }),
    ),
    createElement(m.g, { initial: false, animate: { opacity: squat ? 1 : 0 }, transition: FADE },
      createElement("circle", { cx: 13.6, cy: 7.4, r: 1.7, fill: "currentColor", stroke: "none" }),
      createElement("path", { d: "M12.6 10.2 9.4 15.6M9.4 15.6l5 .6M14.4 16.2l-1.6 5M12.6 11.2l5.6.4" }),
    ),
    createElement("path", { d: "M5 21.6h14", strokeWidth: 1.2, opacity: 0.45 }),
  );
}

/** Marks a nav icon that takes `active` itself (lucide icons take strokeWidth instead). */
HomeWorkoutNavIcon.fitxNavIcon = true as const;
