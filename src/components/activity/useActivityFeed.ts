"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { figuresStatus, type SportFilter } from "@/lib/activity/feed";
import { busyRecordings, reconcileRecordings, type LocksLike } from "@/lib/activity/device-recordings";
import { recordingStore, type StoredRecording } from "@/lib/activity/local-store";
import { listActivities, listActivitySummaries, viewFromRecord, type ActivitySummary, type ActivityView } from "@/lib/activity/repository";
import { mergeSummaries, periods } from "@/lib/activity/stats";
import { listStrengthSessions, type StrengthSession } from "@/lib/activity/strength";
import { uploadPending } from "@/lib/activity/sync";
import { mergeTimeline, nextToLoad, readListAgain, readSessionsOn, shownFloor, type TimelineEntry } from "@/lib/activity/timeline";
import { createClient } from "@/lib/supabase/client";

const PAGE = 20;
/**
 * Try again for strength sessions, and a list read again in place (rereadHistory), read at most this many pages in one
 * go (a stop for a server that ignores `before`).
 */
const MAX_RETRY_PAGES = 50;

export type History =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "error"; offline: boolean }
  | { status: "ready"; items: ActivityView[]; more: boolean };

/**
 * A page of strength sessions that couldn't be read: the first one (the timeline then shows activities only) or a later
 * one (older entries then stop waiting for sessions). `attempt` counts failed tries of Try again, so the line that says
 * so is read out again after each.
 */
export type SessionsFailure = { kind: "first" | "older"; attempt: number };

/** Completed strength sessions for the timeline, read a page at a time; `failed` when a page couldn't be read. */
type Sessions = { status: "loading" | "ready"; items: StrengthSession[]; more: boolean; failed: SessionsFailure | null };

export const summaryOf = (view: ActivityView): ActivitySummary => ({
  id: view.id, clientId: view.clientId, sport: view.sport, title: view.title, startedAt: view.startedAt, distanceM: view.distanceM,
  movingSeconds: view.movingSeconds, avgPaceSecondsPerKm: view.avgPaceSecondsPerKm, avgSpeedMps: view.avgSpeedMps, local: view.local,
});

const NO_SESSIONS: Sessions = { status: "ready", items: [], more: false, failed: null };

/**
 * Everything the Activity feed and the sport pages show: the history (one sport, or every sport with
 * strength sessions in between), the statistics rows, and recordings kept on this device. Opening
 * the page tidies device copies a crash left behind and uploads anything finished offline.
 */
export function useActivityFeed(userId: string | null, filter: SportFilter) {
  const [history, setHistory] = useState<History>({ status: "loading" });
  const [sessions, setSessions] = useState<Sessions>({ status: "loading", items: [], more: false, failed: null });
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
  // The list on screen (round 3e): the sport it shows, or null while none is shown (loading, unavailable, error), and
  // its oldest entry; a reload reads that list again in place (rereadHistory), and older pages and Try again wait
  // meanwhile (rereadingNow; `rereading` says so on the list's buttons).
  const shownFor = useRef<SportFilter | null>(null);
  const shownFloorRef = useRef<number | null>(null);
  const rereadingNow = useRef(false);
  const [rereading, setRereading] = useState(false);
  // Counts reloads, so what this device held is only ever shown from the latest one.
  const loads = useRef(0);
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
    // Drawn from its loading state: a reread of the old list still running is dropped (its generation is gone).
    shownFor.current = null;
    rereadingNow.current = false;
    setRereading(false);
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
    if (list.status === "ok") shownFor.current = which;
    // No workout_sessions table (an older database): no sessions anywhere, so nothing is missing from the list.
    if (!strength || strength.status === "unavailable") setSessions(NO_SESSIONS);
    else if (strength.status === "ok") setSessions({ status: "ready", items: strength.data, more: strength.data.length === PAGE, failed: null });
    else setSessions({ status: "ready", items: [], more: false, failed: { kind: "first", attempt: 0 } });
  }, []);

  /**
   * A reload of the list on screen (back online, Upload now, the figures' Try again; round 3e, D5). It used to be drawn
   * from its loading state and from its first page only, so every entry, "Show older activities" and the strength
   * sessions' Try again went while it read, and focus on any of them fell to the page. Now the list stays on screen
   * while it is read again as far back as it shows (readListAgain, down to its oldest entry), then is swapped in at
   * once, with what this device now holds (`held`, from this reload's own read of it): an activity uploaded meanwhile
   * never leaves the list and comes back. Show older activities and Try again wait meanwhile. Dropped when a sport is
   * chosen or another reload reads the list meanwhile; this device's copies are still shown unless a newer reload read them.
   */
  const rereadHistory = useCallback(async (uid: string, which: SportFilter, floor: number | null, held: { load: number; recordings: StoredRecording[]; time: number }) => {
    const supabase = createClient();
    if (!supabase) return;
    historyGeneration.current += 1;
    const generation = historyGeneration.current;
    rereadingNow.current = true;
    setRereading(true);
    setMoreFailed(false);
    const options = { maxPages: MAX_RETRY_PAGES, stillWanted: () => generation === historyGeneration.current && filterRef.current === which };
    const sport = which === "all" ? null : which;
    const [list, strength] = await Promise.all([
      readListAgain((before) => listActivities(supabase, uid, { limit: PAGE, before, sport }), floor, PAGE, options),
      // Strength sessions sit in the full timeline only, never in a walk, run or ride list.
      sport ? Promise.resolve(undefined) : readListAgain((before) => listStrengthSessions(supabase, uid, { limit: PAGE, before }), floor, PAGE, options),
    ]);
    if (held.load === loads.current) {
      setLocal(held.recordings);
      setNow(held.time);
    }
    // Another reload, or a sport chosen, took the list over (and holds or ended `rereading`).
    if (generation !== historyGeneration.current) return;
    rereadingNow.current = false;
    setRereading(false);
    if (!list || strength === null || filterRef.current !== which) return;
    if (list.status === "failed") {
      shownFor.current = null;
      setHistory(list.result.status === "unavailable" ? { status: "unavailable" } : { status: "error", offline: list.result.status === "error" && list.result.offline });
    } else {
      setHistory({ status: "ready", items: list.items, more: list.more });
      setMoreFailed(list.olderFailed);
    }
    // As loadHistory: no workout_sessions table means no sessions anywhere; a page that fails is said under the list.
    if (!strength || (strength.status === "failed" && strength.result.status === "unavailable")) setSessions(NO_SESSIONS);
    else if (strength.status === "failed") setSessions({ status: "ready", items: [], more: false, failed: { kind: "first", attempt: 0 } });
    else if (strength.olderFailed) setSessions({ status: "ready", items: strength.items, more: false, failed: { kind: "older", attempt: 0 } });
    else setSessions({ status: "ready", items: strength.items, more: strength.more, failed: null });
  }, []);

  /**
   * Reads everything again: on opening the page, back online, Upload now, the figures' Try again. The list on screen is
   * read again in place (rereadHistory); a list not shown yet, or `keepList` false (Delete everything: what was listed
   * is gone), is drawn from its loading state.
   */
  const load = useCallback(async (uid: string, keepList = true) => {
    const supabase = createClient();
    if (!supabase) return;
    loads.current += 1;
    const thisLoad = loads.current;
    const store = await recordingStore();
    // Tidy rows a crash left behind (never another window's live recording), then upload anything
    // finished offline or before history was available.
    const busy = await busyRecordings(typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LocksLike }).locks : null);
    setRecordingElsewhere(busy);
    await reconcileRecordings(store, uid, busy);
    await uploadPending(store, supabase, uid);
    const recordings = await store.listRecordings(uid);
    const time = Date.now();
    const which = filterRef.current;
    const inPlace = keepList && shownFor.current === which;
    if (!inPlace) {
      setLocal(recordings);
      setNow(time);
    }
    const [summaries, recent] = await Promise.all([
      listActivitySummaries(supabase, uid),
      listStrengthSessions(supabase, uid, { since: periods(time).lastWeek.start, limit: 200 }),
      inPlace ? rereadHistory(uid, which, shownFloorRef.current, { load: thisLoad, recordings, time }) : loadHistory(uid, which),
    ]);
    setStats(summaries.status === "ok" ? summaries.data : null);
    setStatsFailure(summaries.status === "ok" ? null : { offline: summaries.status === "error" && summaries.offline });
    setRecentStrength(recent.status === "ok" ? recent.data : null);
  }, [loadHistory, rereadHistory]);

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

  const unfinished = local.find((r) => r.state === "active") ?? null;
  const serverIds = new Set(history.status === "ready" ? history.items.map((item) => item.clientId) : []);
  // A device copy that is already on the server (its upload half-finished) is listed once.
  const onDevice = local.filter((r) => r.state === "finished" && r.record && !serverIds.has(r.clientId));
  const waiting = onDevice.filter((r) => !r.uploadRejected);
  const deviceViews = onDevice.map((r) => viewFromRecord(r.record!));
  const shownDevice = filter === "all" ? deviceViews : deviceViews.filter((view) => view.sport === filter);
  const items = history.status === "ready" ? history.items : [];
  const timeline: { entries: TimelineEntry[]; more: boolean } = mergeTimeline({ items, more: history.status === "ready" && history.more }, { items: sessions.items, more: sessions.more }, shownDevice);
  // How far back the list on screen goes, for a reload to read it again that far (rereadHistory).
  const oldestShown = shownFloor(timeline.entries);
  useEffect(() => {
    shownFloorRef.current = oldestShown;
  }, [oldestShown]);

  /**
   * "Show older activities": reads the next page of whichever list holds the timeline back. Says whether a read
   * started (not while one is still loading, nor with nothing left to read), so the list knows a press is waiting
   * for new entries. A failed page of activities is said beside the button and can be tried again; a failed page
   * of strength sessions stops them there, so older activities never wait on them, and the list says so with its
   * own Try again (retrySessions). Not while the list is read again in place (its result would be lost, or overwrite it).
   */
  const loadMore = useCallback((): boolean => {
    if (loadingMoreNow.current || rereadingNow.current || !userId || history.status !== "ready") return false;
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
          if (page.status === "ok") setSessions({ status: "ready", items: [...sessions.items, ...page.data], more: page.data.length === PAGE, failed: null });
          else setSessions({ ...sessions, more: false, failed: { kind: "older", attempt: 0 } });
        }
      } finally {
        loadingMoreNow.current = false;
        setLoadingMore(false);
      }
    })();
    return true;
  }, [userId, history, sessions, filter]);

  /**
   * Try again for strength sessions that couldn't be read: one read at a time with "Show older activities" (it says
   * Loading… meanwhile). It reads on from the last session it has until the sessions reach the oldest entry the list
   * shows (readSessionsOn), so nothing already shown is held back again. A page that fails keeps what was read and is
   * said again. Says whether a read started, like loadMore.
   */
  const retrySessions = (): boolean => {
    const failed = sessions.failed;
    // Not while the list is read again from the start, in place or not (it reads the sessions too); with activities
    // that couldn't be read, the sessions still sit beside the ones kept on this device.
    if (!failed || loadingMoreNow.current || rereadingNow.current || !userId || history.status === "loading") return false;
    const supabase = createClient();
    if (!supabase) return false;
    loadingMoreNow.current = true;
    const generation = historyGeneration.current;
    const floor = shownFloor(timeline.entries);
    setLoadingMore(true);
    void (async () => {
      try {
        const read = async (before: number | null) => {
          const page = await listStrengthSessions(supabase, userId, { limit: PAGE, before });
          return page.status === "ok" ? page.data : null;
        };
        const result = await readSessionsOn(sessions.items, floor, PAGE, read, { maxPages: MAX_RETRY_PAGES, stillWanted: () => generation === historyGeneration.current });
        if (!result) return;
        setSessions(result.failed
          ? { status: "ready", items: result.items, more: false, failed: { kind: result.items.length ? "older" : "first", attempt: failed.attempt + 1 } }
          : { status: "ready", items: result.items, more: result.more, failed: null });
      } finally {
        loadingMoreNow.current = false;
        setLoadingMore(false);
      }
    })();
    return true;
  };

  // Statistics from every saved activity plus the ones still only on this device.
  const statRows = stats ? mergeSummaries(stats.rows, deviceViews.map(summaryOf)) : history.status === "unavailable" ? deviceViews.map(summaryOf) : null;

  return {
    history, sessions, recentStrength, statRows, statsComplete: stats?.complete ?? true, now, unfinished,
    statsStatus: figuresStatus(statRows, statsFailure !== null), statsOffline: statsFailure?.offline ?? false,
    unfinishedElsewhere: Boolean(unfinished && recordingElsewhere.has(unfinished.clientId)),
    // Show older activities and the sessions' Try again say Loading… (aria-disabled) while the list is read again in place.
    waiting, timeline, loadMore, loadingMore: loadingMore || rereading, moreFailed, sessionsFailed: sessions.failed, retrySessions, reload: load,
  };
}
