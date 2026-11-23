"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toSocialError } from "@/lib/social";

type PagedState<T, C> = { items: T[]; cursor: C | null; done: boolean; status: "loading" | "ready" | "more" | "error"; error: string | null };

/**
 * Newest-first pages with a cursor. `load(cursor)` returns one page and the cursor after it (null on the last page).
 * Resets when `key` changes; an older answer never overwrites a newer one.
 */
export function usePaged<T extends { id: string }, C>(key: string, load: (cursor: C | null) => Promise<{ items: T[]; next: C | null }>) {
  const [state, setState] = useState<PagedState<T, C>>({ items: [], cursor: null, done: false, status: "loading", error: null });
  const ticket = useRef(0);
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; });
  const busy = useRef(false);

  const fetchPage = useCallback(async (cursor: C | null, reset: boolean) => {
    const mine = reset ? ++ticket.current : ticket.current;
    busy.current = true;
    setState((previous) => ({ ...previous, status: reset ? "loading" : "more", error: null, ...(reset ? { items: [], cursor: null, done: false } : {}) }));
    try {
      const page = await loadRef.current(cursor);
      if (mine !== ticket.current) return;
      setState((previous) => {
        const seen = new Set(reset ? [] : previous.items.map((item) => item.id));
        const items = [...(reset ? [] : previous.items), ...page.items.filter((item) => !seen.has(item.id))];
        return { items, cursor: page.next, done: page.next === null, status: "ready", error: null };
      });
    } catch (error) {
      if (mine !== ticket.current) return;
      setState((previous) => ({ ...previous, status: "error", error: toSocialError(error).message }));
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    const start = window.setTimeout(() => void fetchPage(null, true), 0);
    return () => window.clearTimeout(start);
  }, [key, fetchPage]);

  const more = useCallback(() => {
    if (busy.current || state.done || state.status === "loading") return;
    void fetchPage(state.cursor, false);
  }, [fetchPage, state.cursor, state.done, state.status]);

  const reload = useCallback(() => void fetchPage(null, true), [fetchPage]);
  const replace = useCallback((item: T) => setState((previous) => ({ ...previous, items: previous.items.map((old) => (old.id === item.id ? item : old)) })), []);
  const remove = useCallback((id: string) => setState((previous) => ({ ...previous, items: previous.items.filter((old) => old.id !== id) })), []);
  return { ...state, more, reload, replace, remove };
}

/** Calls `onVisible` when the returned element scrolls near the viewport. */
export function useSentinel(onVisible: () => void, enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const callback = useRef(onVisible);
  useEffect(() => { callback.current = onVisible; });
  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) callback.current(); }, { rootMargin: "900px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [enabled]);
  return ref;
}
