"use client";

import { useSyncExternalStore } from "react";
import { REDUCED_MOTION_QUERY } from "./tokens";

function subscribeTo(query: string) {
  return (onChange: () => void) => {
    const list = window.matchMedia(query);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  };
}

const subscribeReduced = subscribeTo(REDUCED_MOTION_QUERY);
const readReduced = () => window.matchMedia(REDUCED_MOTION_QUERY).matches;
const assumeReduced = () => true;

/**
 * True when the visitor asked for reduced motion. It is also true on the server and during hydration,
 * until the browser's preference is known, so the first paint is always the still, final state and
 * nothing jumps when the page hydrates.
 */
export function useReducedMotionSafe(): boolean {
  return useSyncExternalStore(subscribeReduced, readReduced, assumeReduced);
}

const listeners = new Map<string, (onChange: () => void) => () => void>();

/** Whether a media query matches; `serverValue` (default false) on the server and during hydration. */
export function useMediaQuery(query: string, serverValue = false): boolean {
  let subscribe = listeners.get(query);
  if (!subscribe) {
    subscribe = subscribeTo(query);
    listeners.set(query, subscribe);
  }
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => serverValue);
}

const subscribeVisibility = (onChange: () => void) => {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
};

/** True while the tab is visible (true on the server). Loops pause when it turns false. */
export function usePageVisible(): boolean {
  return useSyncExternalStore(subscribeVisibility, () => document.visibilityState !== "hidden", () => true);
}
