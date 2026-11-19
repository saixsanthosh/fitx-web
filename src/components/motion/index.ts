// Motion primitives. Client components; import from "@/components/motion".
export { MotionProvider } from "./MotionProvider";
export { useReducedMotionSafe, useMediaQuery, usePageVisible } from "./useReducedMotionSafe";
export { EASE, DURATION, SPRING, REDUCED_FADE, REDUCED_MOTION_QUERY, WIDE_QUERY, type CubicBezier } from "./tokens";
export { Reveal, type RevealTag } from "./Reveal";
export { Stagger, StaggerItem } from "./Stagger";
export { ScrollScene } from "./ScrollScene";
export { Parallax } from "./Parallax";
export { parallaxRange } from "./scroll-math";
export { CountUp } from "./CountUp";
export { Presence } from "./Presence";
export { UNKNOWN_MARK, UNKNOWN_LABEL, displayCount, isKnown, defaultCountFormat } from "./count-format";
