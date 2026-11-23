"use client";

/**
 * The story tray, read once per page and shared by the tray and every avatar ring, so a feed of 30 avatars costs one
 * fitx_social_story_tray read, not 30. It is read again after 60 s when something asks, after a story is posted or
 * deleted, and when the tab comes back.
 */
import { useEffect, useSyncExternalStore } from "react";
import { socialApi, type StoryTrayEntry } from "@/lib/social";
import type { Db } from "@/lib/social/api";
import { markTraySeen } from "@/lib/social/stories";

type TrayState = { entries: StoryTrayEntry[] | null; status: "idle" | "loading" | "ready" | "error"; at: number };

const FRESH_MS = 60_000;
let state: TrayState = { entries: null, status: "idle", at: 0 };
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: TrayState) {
  state = next;
  for (const listener of listeners) listener();
}

/** Reads the tray (once at a time); `force` reads again even when the last read is fresh. */
export function loadTray(db: Db, force = false): Promise<void> {
  if (pending) return pending;
  if (!force && state.status === "ready" && Date.now() - state.at < FRESH_MS) return Promise.resolve();
  set({ ...state, status: state.entries ? state.status : "loading" });
  pending = socialApi.storyTray(db)
    .then((entries) => set({ entries, status: "ready", at: Date.now() }))
    .catch(() => set({ entries: state.entries, status: state.entries ? "ready" : "error", at: Date.now() }))
    .finally(() => { pending = null; });
  return pending;
}

/** After the member saw every story of an account: its ring turns to "seen" at once. */
export function traySeen(userId: string) {
  if (state.entries) set({ ...state, entries: markTraySeen(state.entries, userId) });
}

/** After a story was posted or deleted. */
export function trayChanged(db: Db) {
  void loadTray(db, true);
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const snapshot = () => state;
const serverSnapshot = (): TrayState => ({ entries: null, status: "idle", at: 0 });

/** The shared tray; reads it when it is missing or stale. `db` null waits (no session yet). */
export function useStoryTray(db: Db | null): TrayState {
  const current = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  useEffect(() => {
    if (!db) return;
    void loadTray(db);
    const onVisible = () => { if (document.visibilityState === "visible") void loadTray(db); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [db]);
  return current;
}

/** The tray as last read, without asking (for the viewer's order). */
export function currentTray(): StoryTrayEntry[] | null {
  return state.entries;
}

/** Set when a story was opened from inside FITX, so closing the viewer goes back instead of to the feed. */
let openedInApp = false;
export function markOpenedInApp() {
  openedInApp = true;
}
export function takeOpenedInApp(): boolean {
  const value = openedInApp;
  openedInApp = false;
  return value;
}
