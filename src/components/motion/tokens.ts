/**
 * Motion tokens: one set of curves, durations and springs for the whole app, so movement feels like one
 * product. Durations are in seconds (framer-motion's unit).
 */
export type CubicBezier = [number, number, number, number];

export const EASE: { out: CubicBezier; inOut: CubicBezier } = {
  /** Entrances and anything that settles: fast start, long soft landing. */
  out: [0.22, 1, 0.36, 1],
  /** Scroll-linked and looping movement: symmetric. */
  inOut: [0.65, 0, 0.35, 1],
};

export const DURATION = { fast: 0.18, base: 0.32, slow: 0.6 } as const;

export const SPRING = { type: "spring", stiffness: 260, damping: 30 } as const;

/** The longest fade allowed when the visitor asks for reduced motion (no transforms at all). */
export const REDUCED_FADE = 0.15;

/** The media query behind every reduced-motion decision. */
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Parallax and other large scroll effects only run from this width up. */
export const WIDE_QUERY = "(min-width: 768px)";
