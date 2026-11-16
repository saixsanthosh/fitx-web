"use client";

import { useCallback, useEffect, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { localDateKey } from "@/lib/domain/dates";
import { layoutReducer, sameLayout, type LayoutAction, type LayoutItem } from "@/lib/domain/dashboard-layout";
import { loadGoals, type GoalsSchema } from "@/lib/data/goals";
import { loadDashboardLayout, loadTodaySummary, saveDashboardLayout, type SummaryResult } from "@/lib/data/today";
import type { GoalView } from "@/lib/domain/goals";
import { getSession, messageFor } from "@/components/tasks/session";

/** A value loaded from the database: loading, ready (kept while it reloads) or failed. */
export type Resource<T> = { status: "loading" | "ready" | "error"; data: T | null; error: string; reload: () => void };

function useResource<T>(load: () => Promise<T>, fallbackMessage: string): Resource<T> {
  const [state, setState] = useState<Omit<Resource<T>, "reload">>({ status: "loading", data: null, error: "" });
  const generation = useRef(0);
  const run = useCallback(() => {
    const ticket = ++generation.current;
    setState((current) => (current.data ? current : { ...current, status: "loading" }));
    load().then(
      (data) => { if (ticket === generation.current) setState({ status: "ready", data, error: "" }); },
      (error) => { if (ticket === generation.current) setState((current) => ({ status: "error", data: current.data, error: messageFor(error, fallbackMessage) })); },
    );
  }, [load, fallbackMessage]);
  useEffect(() => { void Promise.resolve().then(run); }, [run]);
  return { ...state, reload: run };
}

export function useTodaySummary(date: string): Resource<SummaryResult> {
  const load = useCallback(async () => {
    const { db, userId } = await getSession();
    return loadTodaySummary(db, userId, date);
  }, [date]);
  return useResource(load, "Today's numbers could not be loaded.");
}

export type GoalsData = { goals: GoalView[]; schema: GoalsSchema };

export function useGoalsData(date: string): Resource<GoalsData> {
  const load = useCallback(async () => {
    const { db, userId } = await getSession();
    return loadGoals(db, userId, date);
  }, [date]);
  return useResource(load, "Your goals could not be loaded.");
}

function subscribeToDay(onChange: () => void) {
  let timer: ReturnType<typeof setTimeout>;
  const schedule = () => {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 2);
    timer = setTimeout(() => { onChange(); schedule(); }, Math.min(midnight.getTime() - now.getTime(), 2 ** 31 - 1));
  };
  schedule();
  document.addEventListener("visibilitychange", onChange);
  window.addEventListener("focus", onChange);
  return () => {
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", onChange);
    window.removeEventListener("focus", onChange);
  };
}

/** Today's day key in the browser, updated at midnight and when the tab comes back; null on the server. */
export function useToday(): string | null {
  return useSyncExternalStore(subscribeToDay, () => localDateKey(), () => null);
}

/** Calls `refresh` when the tab comes back after `staleMs` (the day may have new logs from another device). */
export function useRefreshOnReturn(refresh: () => void, staleMs = 5 * 60_000) {
  const last = useRef(0);
  const latest = useRef(refresh);
  useEffect(() => { latest.current = refresh; }, [refresh]);
  useEffect(() => {
    last.current = Date.now();
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - last.current > staleMs) { last.current = Date.now(); latest.current(); }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [staleMs]);
}

export type SaveState = "idle" | "saving" | "saved" | "error" | "unavailable";

type LayoutState = { status: "loading" | "ready"; canSave: boolean; loadError: string };

/**
 * The user's widget arrangement: loaded once, changed through the layout reducer, and saved a
 * moment after the last change. If this database cannot store it yet, changes still apply for
 * this visit and the panel says so.
 */
export function useDashboardLayout() {
  const [state, setState] = useState<LayoutState>({ status: "loading", canSave: true, loadError: "" });
  const [items, dispatch] = useReducer(layoutReducer, [] as LayoutItem[]);
  const [save, setSave] = useState<SaveState>("idle");
  const saved = useRef<LayoutItem[] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { db, userId } = await getSession();
        const result = await loadDashboardLayout(db, userId);
        if (!active) return;
        saved.current = result.items;
        dispatch({ type: "replace", items: result.items });
        setState({ status: "ready", canSave: result.canSave, loadError: "" });
      } catch (error) {
        if (!active) return;
        // Home still shows, in the default arrangement, with the reason in the panel.
        dispatch({ type: "reset" });
        setState({ status: "ready", canSave: false, loadError: messageFor(error, "Your Home layout could not be loaded.") });
      }
    })();
    return () => { active = false; };
  }, []);

  const persist = useCallback(async (next: LayoutItem[]) => {
    if (!state.canSave) { setSave("unavailable"); return; }
    setSave("saving");
    try {
      const { db, userId } = await getSession();
      const result = await saveDashboardLayout(db, userId, next);
      if (result === "unavailable") { setSave("unavailable"); return; }
      saved.current = next;
      setSave("saved");
    } catch {
      setSave("error");
    }
  }, [state.canSave]);

  useEffect(() => {
    if (state.status !== "ready" || !items.length) return;
    if (saved.current && sameLayout(saved.current, items)) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void persist(items), 450);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [items, persist, state.status]);

  const act = useCallback((action: LayoutAction) => dispatch(action), []);
  return { status: state.status, items, canSave: state.canSave, loadError: state.loadError, save, dispatch: act, retrySave: () => void persist(items) };
}
