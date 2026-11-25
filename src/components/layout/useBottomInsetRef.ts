"use client";

import { useCallback } from "react";
import { trackBottomInset, type BottomInsetName } from "./bottom-inset";

/**
 * A ref for a bar fixed to the bottom of the screen: while the element is in the page it keeps its inset variable
 * on <html> up to date (bottom-inset.ts), and removes it when the element leaves the page. A callback ref, so it
 * follows the element itself: React 19 runs the returned cleanup when the element is removed, also when the
 * component stays mounted and only stops drawing it (BottomNav on the focus screens).
 */
export function useBottomInsetRef(name: BottomInsetName) {
  return useCallback((element: HTMLElement | null) => (element ? trackBottomInset(element, name) : undefined), [name]);
}
