"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSession, messageFor } from "@/components/tasks/session";
import { loadProgressRows, type ProgressRows } from "@/lib/data/progress";

export type PeriodRowsState = {
  /** The rows of the range asked for last, or of the range before while the new one loads (charts then glide). */
  data: ProgressRows | null;
  /** True while the range asked for is still loading. */
  loading: boolean;
  error: string;
  reload: () => void;
};

/**
 * Loads `from` to `to` for Progress and keeps the last range on screen while the next one loads, so the charts
 * move from one period to the next instead of blanking. Ranges already read are kept for this page view.
 */
export function usePeriodRows(from: string, to: string): PeriodRowsState {
  const cache = useRef(new Map<string, ProgressRows>());
  const [state, setState] = useState<{ key: string; data: ProgressRows | null; error: string }>({ key: "", data: null, error: "" });
  const [nonce, setNonce] = useState(0);
  const key = `${from}:${to}`;
  const ticket = useRef(0);

  useEffect(() => {
    const cached = cache.current.get(key);
    const run = ++ticket.current;
    if (cached && nonce === 0) {
      void Promise.resolve().then(() => { if (run === ticket.current) setState({ key, data: cached, error: "" }); });
      return;
    }
    void (async () => {
      try {
        const { db, userId } = await getSession();
        const rows = await loadProgressRows(db, userId, from, to);
        cache.current.set(key, rows);
        if (run === ticket.current) setState({ key, data: rows, error: "" });
      } catch (failure) {
        if (run === ticket.current) setState((current) => ({ key, data: current.data, error: messageFor(failure, "Your progress could not be loaded.") }));
      }
    })();
  }, [key, from, to, nonce]);

  const reload = useCallback(() => {
    cache.current.clear();
    setNonce((value) => value + 1);
  }, []);

  return { data: state.data, loading: state.key !== key, error: state.key === key ? state.error : "", reload };
}
