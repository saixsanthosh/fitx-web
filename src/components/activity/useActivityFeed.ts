"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { figuresStatus, type SportFilter } from "@/lib/activity/feed";
import { busyRecordings, reconcileRecordings, type LocksLike } from "@/lib/activity/device-recordings";
import { recordingStore, type StoredRecording } from "@/lib/activity/local-store";
import { listActivities, listActivitySummaries, viewFromRecord, type ActivitySummary, type ActivityView } from "@/lib/activity/repository";
import { mergeSummaries, periods } from "@/lib/activity/stats";
import { listStrengthSessions, type StrengthSession } from "@/lib/activity/strength";
import { uploadPending } from "@/lib/activity/sync";
import { mergeTimeline, nextToLoad, type TimelineEntry } from "@/lib/activity/timeline";
import { createClient } from "@/lib/supabase/client";

const PAGE = 20;

export type History =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "error"; offline: boolean }
  | { status: "ready"; items: ActivityView[]; more: boolean };

/** Completed strength sessions for the timeline: "missing" when they couldn't be read (the timeline then shows activities only). */
type Sessions = { status: "loading" | "ready" | "missing"; items: StrengthSession[]; more: boolean };

export const summaryOf = (view: ActivityView): ActivitySummary => ({
  id: view.id, clientId: view.clientId, sport: view.sport, title: view.title, startedAt: view.startedAt, distanceM: view.distanceM,
  movingSeconds: view.movingSeconds, avgPaceSecondsPerKm: view.avgPaceSecondsPerKm, avgSpeedMps: view.avgSpeedMps, local: view.local,
});

const NO_SESSIONS: Sessions = { status: "ready", items: [], more: false };

/**
 * Everything the Activity feed and the sport pages show: the history (one sport, or every sport with
 * strength sessions in between), the statistics rows, and recordings kept on this device. Opening
 * the page tidies device copies a crash left behind and uploads anything finished offline.
 */
export function useActivityFeed(userId: string | null, filter: SportFilter) {
  const [history, setHistory] = useState<History>({ status: "loading" });
  const [sessions, setSessions] = useState<Sessions>({ status: "loading", items: [], more: false });
  const [recentStrength, setRecentStrength] = useState<StrengthSession[] | null>(null);
  const [stats, setStats] = useState<{ rows: ActivitySummary[]; complete: boolean } | null>(null);
  // Why the statistics couldn't be read, so a page never mistakes "still loading" or "failed" for "nothing logged".
  const [statsFailure, setStatsFailure] = useState<{ offline: boolean } | null>(null);
  const [local, setLocal] = useState<StoredRecording[]>([]);
  const [now, setNow] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // One older page at a time; `moreFailed`: the last one couldn't be read (said beside "Show older activities").
  const loadingMoreNow = useRef(false);
  const [moreFailed, setMoreFailed] = useState(false);
  // Bumped whenever the history is read again from the first page, so an older page read before that is dropped.
  const historyGeneration = useRef(0);
  const [recordingElsewhere, setRecordingElsewhere] = useState<Set<string>>(() => new Set());
  const filterRef = useRef(filter);
  useEffect(() => {
    filterRef.current = filter;
  }, [filter]);

  const loadHistory = useCallback(async (uid: string, which: SportFilter) => {
    const supabase = createClient();
    if (!supabase) return;
    historyGeneration.current += 1;
    setMoreFailed(false);
    setHistory({ status: "loading" });
    const sport = which === "all" ? null : which;
    const [list, strength] = await Promise.all([
      listActivities(supabase, uid, { limit: PAGE, sport }),
      // Strength sessions sit in the full timeline only, never in a walk, run or ride list.
      sport ? Promise.resolve(null) : listStrengthSessions(supabase, uid, { limit: PAGE }),
    ]);
    if (filterRef.current !== which) return;
    if (list.status === "unavailable") setHistory({ status: "unavailable" });
    else if (list.status !== "ok") setHistory({ status: "error", offline: list.status === "error" && list.offline });
    else setHistory({ status: "ready", items: list.data, more: list.data.length === PAGE });
    if (!strength) setSessions(NO_SESSIONS);
    else setSessions(strength.status === "ok" ? { status: "ready", items: strength.data, more: strength.data.length === PAGE } : { status: "missing", items: [], more: false });
  }, []);

  const load = useCallback(async (uid: string) => {
    const supabase = createClient();
    if (!supabase) return;
    const store = await recordingStore();
    // Tidy rows a crash left behind (never another window's live recording), then upload anything
    // finished offline or before history was available.
    const busy = await busyRecordings(typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LocksLike }).locks : null);
    setRecordingElsewhere(busy);
    await reconcileRecordings(store, uid, busy);
    await uploadPending(store, supabase, uid);
    setLocal(await store.listRecordings(uid));
    const time = Date.now();
    setNow(time);
    const [summaries, recent] = await Promise.all([
      listActivitySummaries(supabase, uid),
      listStrengthSessions(supabase, uid, { since: periods(time).lastWeek.start, limit: 200 }),
      loadHistory(uid, filterRef.current),
    ]);
    setStats(summaries.status === "ok" ? summaries.data : null);
    setStatsFailure(summaries.status === "ok" ? null : { offline: summaries.status === "error" && summaries.offline });
    setRecentStrength(recent.status === "ok" ? recent.data : null);
  }, [loadHistory]);

  useEffect(() => {
    if (!userId) return;
    const id = window.setTimeout(() => void load(userId), 0);
    const retry = () => void load(userId);
    window.addEventListener("online", retry);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("online", retry);
    };
  }, [userId, load]);

  // A new filter reloads the list only; statistics already cover every sport.
  const loadedFilter = useRef(filter);
  useEffect(() => {
    if (!userId || loadedFilter.current === filter) return;
    loadedFilter.current = filter;
    const id = window.setTimeout(() => void loadHistory(userId, filter), 0);
    return () => window.clearTimeout(id);
  }, [userId, filter, loadHistory]);

  /**
   * "Show older activities": reads the next page of whichever list holds the timeline back. Says whether a read
   * started (not while one is still loading, nor with nothing left to read), so the list knows a press is waiting
   * for new entries. A failed page of activities is said beside the button and can be tried again; a failed page
   * of strength sessions stops them there, so older activities never wait on them.
   */
  const loadMore = useCallback((): boolean => {
    if (loadingMoreNow.current || !userId || history.status !== "ready") return false;
    const supabase = createClient();
    if (!supabase) return false;
    const next = nextToLoad({ items: history.items, more: history.more }, { items: sessions.items, more: sessions.more });
    if (!next) return false;
    loadingMoreNow.current = true;
    const generation = historyGeneration.current;
    setLoadingMore(true);
    setMoreFailed(false);
    void (async () => {
      try {
        if (next === "activities") {
          const before = history.items[history.items.length - 1].startedAt;
          const page = await listActivities(supabase, userId, { limit: PAGE, before, sport: filter === "all" ? null : filter });
          if (generation !== historyGeneration.current) return;
          if (page.status === "ok") setHistory({ status: "ready", items: [...history.items, ...page.data], more: page.data.length === PAGE });
          else setMoreFailed(true);
        } else {
          const before = sessions.items[sessions.items.length - 1].startedAt;
          const page = await listStrengthSessions(supabase, userId, { limit: PAGE, before });
          if (generation !== historyGeneration.current) return;
          if (page.status === "ok") setSessions({ status: "ready", items: [...sessions.items, ...page.data], more: page.data.length === PAGE });
          else setSessions({ ...sessions, more: false });
        }
      } finally {
        loadingMoreNow.current = false;
        setLoadingMore(false);
      }
    })();
    return true;
  }, [userId, history, sessions, filter]);

  const unfinished = local.find((r) => r.state === "active") ?? null;
  const serverIds = new Set(history.status === "ready" ? history.items.map((item) => item.clientId) : []);
  // A device copy that is already on the server (its upload half-finished) is listed once.
  const onDevice = local.filter((r) => r.state === "finished" && r.record && !serverIds.has(r.clientId));
  const waiting = onDevice.filter((r) => !r.uploadRejected);
  const deviceViews = onDevice.map((r) => viewFromRecord(r.record!));
  const shownDevice = filter === "all" ? deviceViews : deviceViews.filter((view) => view.sport === filter);
  const items = history.status === "ready" ? history.items : [];
  const timeline: { entries: TimelineEntry[]; more: boolean } = mergeTimeline({ items, more: history.status === "ready" && history.more }, { items: sessions.items, more: sessions.more }, shownDevice);

  // Statistics from every saved activity plus the ones still only on this device.
  const statRows = stats ? mergeSummaries(stats.rows, deviceViews.map(summaryOf)) : history.status === "unavailable" ? deviceViews.map(summaryOf) : null;

  return {
    history, sessions, recentStrength, statRows, statsComplete: stats?.complete ?? true, now, unfinished,
    statsStatus: figuresStatus(statRows, statsFailure !== null), statsOffline: statsFailure?.offline ?? false,
    unfinishedElsewhere: Boolean(unfinished && recordingElsewhere.has(unfinished.clientId)),
    waiting, timeline, loadMore, loadingMore, moreFailed, reload: load,
  };
}
