"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, CloudOff, FileUp, Play, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/app/EmptyState";
import { PageHeading } from "@/components/app/PageHeading";
import { SPORT_NOUN, usesPace } from "@/lib/activity/config";
import { formatActivityDate, formatDistance, formatDuration, formatPace, formatSpeed } from "@/lib/activity/format";
import { busyRecordings, clearDeviceActivityData, reconcileRecordings, type LocksLike } from "@/lib/activity/device-recordings";
import { recordingStore, type StoredRecording } from "@/lib/activity/local-store";
import { decodeRoute } from "@/lib/activity/polyline";
import { deleteAllActivities, listActivities, listActivitySummaries, viewFromRecord, type ActivitySummary, type ActivityView } from "@/lib/activity/repository";
import { mergeSummaries, periods, periodTotals, personalBests, weekChange } from "@/lib/activity/stats";
import { listStrengthSessions, strengthTotals, type StrengthSession } from "@/lib/activity/strength";
import { uploadPending } from "@/lib/activity/sync";
import { mergeTimeline, nextToLoad } from "@/lib/activity/timeline";
import { groupByWeek, weekLabel } from "@/lib/activity/weeks";
import { createClient } from "@/lib/supabase/client";
import { AccountError } from "./AccountError";
import { PeriodTotalsPanel, PersonalBestsPanel, WeekPanel } from "./ActivityStats";
import { ActivitySourceBadge } from "./ActivitySourceBadge";
import { RouteSvg } from "./RouteSvg";
import { SportIcon } from "./sports";
import { StrengthRow } from "./StrengthRow";
import { useActivityAccount } from "./useActivityAccount";

const PAGE = 20;

type History =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "error"; offline: boolean }
  | { status: "ready"; items: ActivityView[]; more: boolean };

/** Completed strength sessions for the timeline: "missing" when they couldn't be read (the timeline then shows activities only). */
type Sessions = { status: "loading" | "ready" | "missing"; items: StrengthSession[]; more: boolean };
type Stats = { rows: ActivitySummary[]; complete: boolean };

function ActivityRow({ activity }: { activity: ActivityView }) {
  const href = activity.local ? `/activity/local-${activity.clientId}` : `/activity/${activity.id}`;
  const route = decodeRoute(activity.routePolyline);
  return (
    <li>
      <Link href={href} className="group flex min-h-20 items-center gap-3 rounded-xl border border-fitx-border bg-fitx-card p-3 transition-colors hover:border-fitx-primary/40 sm:gap-4">
        <div className="grid h-14 w-14 shrink-0 place-items-center rounded-lg bg-fitx-surface-variant sm:h-16 sm:w-16">
          {route.some((s) => s.length > 1) ? <RouteSvg segments={route} className="h-full w-full p-1" strokeWidth={2.5} /> : <SportIcon sport={activity.sport} size={22} className="text-fitx-text-secondary" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[11px] text-fitx-text-secondary"><SportIcon sport={activity.sport} size={13} />{formatActivityDate(activity.startedAt)}{activity.local && <span className="inline-flex items-center gap-1 text-fitx-warning"><CloudOff size={12} aria-hidden="true" />On this device</span>}</p>
          <p className="mt-0.5 truncate font-semibold text-fitx-text">{activity.title}</p>
          <p className="mt-0.5 text-xs tabular-nums text-fitx-text-secondary">
            {formatDistance(activity.distanceM)} · {formatDuration(activity.movingSeconds)} · {usesPace(activity.sport) ? formatPace(activity.avgPaceSecondsPerKm) : formatSpeed(activity.avgSpeedMps)}
          </p>
          <ActivitySourceBadge info={activity} className="mt-1 max-w-full" />
        </div>
        <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-fitx-text-disabled group-hover:text-fitx-primary" />
      </Link>
    </li>
  );
}

const summaryOf = (view: ActivityView): ActivitySummary => ({
  id: view.id, clientId: view.clientId, sport: view.sport, title: view.title, startedAt: view.startedAt, distanceM: view.distanceM,
  movingSeconds: view.movingSeconds, avgPaceSecondsPerKm: view.avgPaceSecondsPerKm, avgSpeedMps: view.avgSpeedMps, local: view.local,
});

export function ActivityHome() {
  const account = useActivityAccount();
  const [history, setHistory] = useState<History>({ status: "loading" });
  const [sessions, setSessions] = useState<Sessions>({ status: "loading", items: [], more: false });
  const [recentStrength, setRecentStrength] = useState<StrengthSession[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [local, setLocal] = useState<StoredRecording[]>([]);
  const [now, setNow] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [notice, setNotice] = useState("");
  const [recordingElsewhere, setRecordingElsewhere] = useState<Set<string>>(() => new Set());
  const focusOnMount = useCallback((element: HTMLElement | null) => element?.focus(), []);
  const deleteAllTriggerRef = useRef<HTMLButtonElement | null>(null);

  const userId = account.status === "ready" ? account.userId : null;

  const refreshLocal = useCallback(async (uid: string) => {
    const store = await recordingStore();
    setLocal(await store.listRecordings(uid));
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
    await refreshLocal(uid);
    const time = Date.now();
    setNow(time);
    const [list, summaries, strength, recent] = await Promise.all([
      listActivities(supabase, uid, { limit: PAGE }),
      listActivitySummaries(supabase, uid),
      listStrengthSessions(supabase, uid, { limit: PAGE }),
      listStrengthSessions(supabase, uid, { since: periods(time).lastWeek.start, limit: 200 }),
    ]);
    if (list.status === "unavailable") setHistory({ status: "unavailable" });
    else if (list.status !== "ok") setHistory({ status: "error", offline: list.status === "error" && list.offline });
    else setHistory({ status: "ready", items: list.data, more: list.data.length === PAGE });
    setStats(summaries.status === "ok" ? summaries.data : null);
    setSessions(strength.status === "ok" ? { status: "ready", items: strength.data, more: strength.data.length === PAGE } : { status: "missing", items: [], more: false });
    setRecentStrength(recent.status === "ok" ? recent.data : null);
  }, [refreshLocal]);

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

  async function loadMore() {
    if (!userId || history.status !== "ready") return;
    const supabase = createClient();
    if (!supabase) return;
    const activitiesPage = { items: history.items, more: history.more };
    const sessionsPage = { items: sessions.items, more: sessions.more };
    const next = nextToLoad(activitiesPage, sessionsPage);
    if (!next) return;
    setLoadingMore(true);
    if (next === "activities") {
      const before = history.items[history.items.length - 1].startedAt;
      const page = await listActivities(supabase, userId, { limit: PAGE, before });
      if (page.status === "ok") setHistory({ status: "ready", items: [...history.items, ...page.data], more: page.data.length === PAGE });
    } else {
      const before = sessions.items[sessions.items.length - 1].startedAt;
      const page = await listStrengthSessions(supabase, userId, { limit: PAGE, before });
      if (page.status === "ok") setSessions({ status: "ready", items: [...sessions.items, ...page.data], more: page.data.length === PAGE });
      else setSessions({ ...sessions, more: false });
    }
    setLoadingMore(false);
  }

  async function syncNow() {
    if (!userId) return;
    setSyncing(true);
    await load(userId);
    setSyncing(false);
  }

  async function deleteAll() {
    if (!userId) return;
    const supabase = createClient();
    if (!supabase) return;
    const store = await recordingStore();
    const result = await deleteAllActivities(supabase, userId);
    if (result.status === "error" || result.status === "rejected") {
      setNotice("Your activities couldn’t be deleted. Check your connection and try again.");
      return;
    }
    await clearDeviceActivityData(store, userId);
    setConfirmDeleteAll(false);
    setNotice(result.status === "unavailable" ? "Activity data on this device was deleted." : "All your walks, runs and rides and their routes were deleted.");
    await load(userId);
  }

  if (account.status === "loading") return <div className="fitx-panel animate-pulse p-8 text-sm text-fitx-text-secondary">Loading activity…</div>;
  if (account.status === "unconfigured") return <EmptyState title="Activity tracking isn’t connected" description="FITX is not connected to its database on this site." />;
  if (account.status === "error") return <AccountError />;
  if (account.status === "signed-out") return <EmptyState title="Sign in to track activities" description="Walks, runs and rides are saved to your account." action={<Link href="/signin?next=/activity" className="fitx-button min-h-11">Sign in</Link>} />;

  const unfinished = local.find((r) => r.state === "active");
  const unfinishedElsewhere = Boolean(unfinished && recordingElsewhere.has(unfinished.clientId));
  const serverIds = new Set(history.status === "ready" ? history.items.map((item) => item.clientId) : []);
  // A device copy that is already on the server (its upload half-finished) is listed once.
  const onDevice = local.filter((r) => r.state === "finished" && r.record && !serverIds.has(r.clientId));
  const waiting = onDevice.filter((r) => !r.uploadRejected);
  const waitingViews = onDevice.map((r) => viewFromRecord(r.record!));
  const items = history.status === "ready" ? history.items : [];
  const timeline = mergeTimeline({ items, more: history.status === "ready" && history.more }, { items: sessions.items, more: sessions.more }, waitingViews);
  const groups = groupByWeek(timeline.entries);

  // Statistics from every saved activity plus the ones still only on this device.
  const statRows = stats ? mergeSummaries(stats.rows, waitingViews.map(summaryOf)) : history.status === "unavailable" ? waitingViews.map(summaryOf) : null;
  const totals = statRows && now !== null ? periodTotals(statRows, now) : null;
  const bounds = now !== null ? periods(now) : null;
  const strengthWeek = recentStrength && bounds ? strengthTotals(recentStrength, bounds.week.start, bounds.week.end) : null;
  const bests = statRows ? personalBests(statRows) : null;
  const hasAnything = (statRows?.length ?? 0) > 0 || groups.length > 0;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeading
        title="Activity"
        description="Walks, runs and rides recorded with your phone’s GPS or imported from a watch, next to your strength sessions."
        actions={(
          <>
            <Link href="/activity/import" className="fitx-button fitx-button-secondary min-h-11"><FileUp size={16} aria-hidden="true" />Import</Link>
            <Link href="/activity/record" className="fitx-button min-h-11"><Play size={16} aria-hidden="true" />Start activity</Link>
          </>
        )}
      />

      {notice && <p role="status" className="fitx-alert fitx-alert-success">{notice}</p>}

      {unfinished && (
        <Link href="/activity/record" className="fitx-panel flex min-h-16 items-center justify-between gap-3 border-fitx-primary/40 p-4">
          <span>
            <span className="block text-sm font-semibold text-fitx-text">{unfinishedElsewhere ? `Recording a ${SPORT_NOUN[unfinished.sport]} in another FITX window` : `Unfinished ${SPORT_NOUN[unfinished.sport]} on this device`}</span>
            <span className="block text-xs text-fitx-text-secondary">Started {formatActivityDate(unfinished.startedAt)}. {unfinishedElsewhere ? "Finish it in that window or tab." : "Resume or finish it."}</span>
          </span>
          <ChevronRight size={18} aria-hidden="true" className="text-fitx-primary" />
        </Link>
      )}

      {totals && hasAnything && (
        <>
          <WeekPanel week={totals.week} change={totals.lastWeek.count > 0 || totals.week.count > 0 ? weekChange(totals.week, totals.lastWeek) : null} strength={strengthWeek} />
          {now !== null && <PeriodTotalsPanel totals={totals} now={now} complete={stats?.complete ?? true} />}
        </>
      )}

      {history.status === "unavailable" && (
        <p role="status" className="fitx-alert flex gap-2"><CloudOff size={17} aria-hidden="true" className="mt-0.5 shrink-0 text-fitx-warning" /><span><span className="font-semibold">Activity history isn’t available yet.</span> FITX is finishing an update. You can still record and share; activities stay on this device and upload once history is ready.</span></p>
      )}
      {history.status === "error" && (
        <div role="alert" className="fitx-alert fitx-alert-danger flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span>{history.offline ? "You’re offline, so your history can’t load. Activities you record still save on this device." : "Your history couldn’t load right now."}</span>
          <button type="button" onClick={() => void syncNow()} className="fitx-button fitx-button-secondary min-h-11 shrink-0"><RefreshCw size={15} aria-hidden="true" />Try again</button>
        </div>
      )}
      {waiting.length > 0 && history.status === "ready" && (
        <div className="fitx-alert flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="flex gap-2"><CloudOff size={17} aria-hidden="true" className="mt-0.5 shrink-0 text-fitx-warning" />{waiting.length} {waiting.length === 1 ? "activity is" : "activities are"} saved on this device and not uploaded yet.</span>
          <button type="button" disabled={syncing} onClick={() => void syncNow()} className="fitx-button fitx-button-secondary min-h-11 shrink-0"><RefreshCw size={15} aria-hidden="true" />{syncing ? "Uploading…" : "Upload now"}</button>
        </div>
      )}

      {history.status === "loading" ? (
        <div className="space-y-2" aria-hidden="true">{[0, 1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-fitx-surface-variant" />)}</div>
      ) : groups.length === 0 ? (
        history.status === "ready" && (
          <EmptyState
            title="No activities yet"
            description="Start a walk, run or ride (keep FITX open with the screen on while you record), or import one from your watch."
            action={(
              <div className="flex flex-wrap justify-center gap-2">
                <Link href="/activity/record" className="fitx-button min-h-11"><Play size={16} aria-hidden="true" />Start activity</Link>
                <Link href="/activity/import" className="fitx-button fitx-button-secondary min-h-11"><FileUp size={16} aria-hidden="true" />Import a file</Link>
              </div>
            )}
          />
        )
      ) : (
        <div className="space-y-5">
          {groups.map((group) => (
            <section key={group.weekStart} aria-label={now === null ? undefined : weekLabel(group.weekStart, now)}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-[.12em] text-fitx-text-secondary">{now === null ? "" : weekLabel(group.weekStart, now)}</h2>
              <ul className="space-y-2">
                {group.items.map((entry) => (entry.kind === "activity" ? <ActivityRow key={entry.key} activity={entry.activity} /> : <StrengthRow key={entry.key} session={entry.session} />))}
              </ul>
            </section>
          ))}
          {history.status === "ready" && timeline.more && (
            <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="fitx-button fitx-button-secondary min-h-11 w-full">{loadingMore ? "Loading…" : "Show older activities"}</button>
          )}
          {sessions.status === "missing" && history.status === "ready" && <p className="text-xs text-fitx-text-secondary">Strength sessions couldn’t be loaded here right now. They’re in Workouts.</p>}
        </div>
      )}

      {bests && <PersonalBestsPanel bests={bests} />}

      <section className="fitx-panel p-4 sm:p-5" aria-labelledby="privacy-title">
        <h2 id="privacy-title" className="flex items-center gap-2 text-sm font-semibold text-fitx-text"><ShieldCheck size={16} aria-hidden="true" className="text-fitx-primary" />Your location data</h2>
        <ul className="mt-2 space-y-1.5 text-xs leading-5 text-fitx-text-secondary">
          <li>Location is used while the Record screen is open (to show the GPS signal, then to record); only the positions from while you record are kept, and routes are visible only to you.</li>
          <li>Imported files are read on this device: only the activity’s summary, route and points are saved, never the file itself.</li>
          <li>Map images come from OpenFreeMap (openfreemap.org), which receives the map area shown (around you on the Record screen, around a route on an activity page) and your IP address, not your route or account.</li>
          <li>Share images leave out the area around your start and finish.</li>
          <li>Detailed GPS points are deleted after 90 days; activity summaries and routes stay until you delete them.</li>
          <li>Activities not uploaded yet are kept on this device until they are, or until you delete them.</li>
        </ul>
        {confirmDeleteAll ? (
          <div className="mt-4 rounded-lg border border-fitx-danger-border bg-fitx-danger-bg p-4" role="alertdialog" aria-labelledby="delete-all-question">
            <p id="delete-all-question" className="text-sm font-semibold text-fitx-danger">Delete every walk, run and ride, with their routes and GPS points, in your account and on this device? Strength sessions aren’t affected. This can’t be undone.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" ref={focusOnMount} onClick={() => { setConfirmDeleteAll(false); window.setTimeout(() => deleteAllTriggerRef.current?.focus(), 0); }} className="fitx-button fitx-button-secondary min-h-11">Keep my data</button>
              <button type="button" onClick={() => void deleteAll()} className="fitx-button fitx-button-danger min-h-11"><Trash2 size={15} aria-hidden="true" />Delete everything</button>
            </div>
          </div>
        ) : (
          <button type="button" ref={deleteAllTriggerRef} onClick={() => setConfirmDeleteAll(true)} className="fitx-button fitx-button-quiet mt-4 min-h-11"><Trash2 size={15} aria-hidden="true" />Delete all activity data</button>
        )}
      </section>
    </div>
  );
}
