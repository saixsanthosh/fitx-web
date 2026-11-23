"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toSocialError } from "@/lib/social";

export type AsyncState<T> = { status: "loading" | "ready" | "error"; data: T | null; error: string | null };

const sameDeps = (a: readonly unknown[] | null, b: readonly unknown[]) => a !== null && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));

/** Runs `load` when its dependencies change; `reload` runs it again. Older answers never overwrite newer ones. */
export function useAsync<T>(load: () => Promise<T>, deps: readonly unknown[]) {
  const [state, setState] = useState<AsyncState<T>>({ status: "loading", data: null, error: null });
  const ticket = useRef(0);
  const loadRef = useRef(load);
  const lastDeps = useRef<readonly unknown[] | null>(null);

  const reload = useCallback(async () => {
    const mine = ++ticket.current;
    setState((previous) => ({ status: previous.data === null ? "loading" : previous.status, data: previous.data, error: null }));
    try {
      const data = await loadRef.current();
      if (mine === ticket.current) setState({ status: "ready", data, error: null });
    } catch (error) {
      if (mine === ticket.current) setState({ status: "error", data: null, error: toSocialError(error).message });
    }
  }, []);

  useEffect(() => {
    loadRef.current = load;
    if (sameDeps(lastDeps.current, deps)) return;
    lastDeps.current = deps;
    const start = window.setTimeout(() => void reload(), 0);
    return () => window.clearTimeout(start);
  });

  const setData = useCallback((data: T) => setState({ status: "ready", data, error: null }), []);
  return { ...state, reload, setData };
}
