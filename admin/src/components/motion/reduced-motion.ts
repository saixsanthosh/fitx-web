"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/** True when the viewer asked for reduced motion. Read at the moment an animation would start. */
export function prefersReducedMotion(): boolean {
  return typeof window === "undefined" || typeof window.matchMedia !== "function" || window.matchMedia(QUERY).matches;
}

function subscribe(onChange: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const list = window.matchMedia(QUERY);
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

/** The reduced-motion preference as state: true on the server and before hydration, so nothing jumps. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, () => true);
}

/** Shared easing for Admin motion (the app's EASE.out). */
export const EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)";
