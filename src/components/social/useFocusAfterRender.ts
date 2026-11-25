"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Request = { id: string | null; fallback?: () => HTMLElement | null };

/**
 * Moves keyboard focus once the next render has committed (D5): to the element with `id` if it is on the page, else to
 * `fallback()` (a heading with tabIndex -1, or the control that replaced the removed one). For actions that remove
 * the focused control, so focus never falls to the page body (bug 82). It runs after a closing sheet has handed focus
 * back to its opener, so it has the last word.
 */
export function useFocusAfterRender() {
  const pending = useRef<Request | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const request = pending.current;
    if (!request) return;
    pending.current = null;
    const target = (request.id ? document.getElementById(request.id) : null) ?? request.fallback?.() ?? null;
    target?.focus();
  }, [tick]);
  return useCallback((id: string | null, fallback?: () => HTMLElement | null) => {
    pending.current = { id, fallback };
    setTick((value) => value + 1);
  }, []);
}
