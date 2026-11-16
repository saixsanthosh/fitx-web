"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ChevronRight, CloudOff, Play, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/app/EmptyState";
import { PageHeading } from "@/components/app/PageHeading";
import { SPORT_LABEL, SPORT_NOUN, usesPace } from "@/lib/activity/config";
import { formatActivityDate, formatDistance, formatDuration, formatPace, formatSpeed, kmValue } from "@/lib/activity/format";
import { recordingStore, type StoredRecording } from "@/lib/activity/local-store";
import { decodeRoute } from "@/lib/activity/polyline";
import { deleteAllActivities, listActivities, totalsOf, totalsSince, viewFromRecord, type ActivityView, type PeriodTotals } from "@/lib/activity/repository";
import { uploadPending } from "@/lib/activity/sync";
import { SPORTS } from "@/lib/activity/types";
import { groupByWeek, startOfWeek, weekLabel } from "@/lib/activity/weeks";
import { createClient } from "@/lib/supabase/client";
import { AccountError } from "./AccountError";
import { RouteSvg } from "./RouteSvg";
import { SportIcon } from "./sports";
import { useActivityAccount } from "./useActivityAccount";

const PAGE = 20;

type History =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "error"; offline: boolean }
  | { status: "ready"; items: ActivityView[]; more: boolean };

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
        </div>
        <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-fitx-text-disabled group-hover:text-fitx-primary" />
      </Link>
    </li>
  );
}

export function ActivityHome() {
  const account = useActivityAccount();
  const [history, setHistory] = useState<History>({ status: "loading" });
  const [week, setWeek] = useState<PeriodTotals | null>(null);
  const [local, setLocal] = useState<StoredRecording[]>([]);
  const [now, setNow] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [notice, setNotice] = useState("");

  const userId = account.status === "ready" ? account.userId : null;

  const refreshLocal = useCallback(async (uid: string) => {
    const store = await recordingStore();
    setLocal(await store.listRecordings(uid));
  }, []);

  const load = useCallback(async (uid: string) => {
    const supabase = createClient();
    if (!supabase) return;
    const store = await recordingStore();
    // Anything finished offline (or before history was available) goes up first.
    await uploadPending(store, supabase, uid);
    await refreshLocal(uid);
    const time = Date.now();
    setNow(time);
    const [list, totals] = await Promise.all([listActivities(supabase, uid, { limit: PAGE }), totalsSince(supabase, uid, startOfWeek(time))]);
    if (list.status === "unavailable") setHistory({ status: "unavailable" });
    else if (list.status === "error") setHistory({ status: "error", offline: list.offline });
    else setHistory({ status: "ready", items: list.data, more: list.data.length === PAGE });
    setWeek(totals.status === "ok" ? totals.data : null);
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
    if (!userId || history.status !== "ready" || !history.items.length) return;
    const supabase = createClient();
    if (!supabase) return;
    setLoadingMore(true);
    const before = history.items[history.items.length - 1].startedAt;
    const next = await listActivities(supabase, userId, { limit: PAGE, before });
    setLoadingMore(false);
    if (next.status === "ok") setHistory({ status: "ready", items: [...history.items, ...next.data], more: next.data.length === PAGE });
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
    if (result.status === "error") {
      setNotice("Your activities couldn’t be deleted. Check your connection and try again.");
      return;
    }
    await store.deleteAll(userId);
    setConfirmDeleteAll(false);
    setNotice(result.status === "unavailable" ? "Activity data on this device was deleted." : "All your activities and routes were deleted.");
    await load(userId);
  }

  if (account.status === "loading") return <div className="fitx-panel animate-pulse p-8 text-sm text-fitx-text-secondary">Loading activity…</div>;
  if (account.status === "unconfigured") return <EmptyState title="Activity tracking isn’t connected" description="FITX is not connected to its database on this site." />;
  if (account.status === "error") return <AccountError />;
  if (account.status === "signed-out") return <EmptyState title="Sign in to track activities" description="Walks, runs and rides are saved to your account." action={<Link href="/signin?next=/activity" className="fitx-button min-h-11">Sign in</Link>} />;

  const unfinished = local.find((r) => r.state === "active");
  const waiting = local.filter((r) => r.state === "finished" && r.record);
  const waitingViews = waiting.map((r) => viewFromRecord(r.record!));
  const items = history.status === "ready" ? history.items : [];
  const groups = groupByWeek([...waitingViews, ...items].sort((a, b) => b.startedAt - a.startedAt));
  const weekTotals = week ?? (history.status === "unavailable" && now !== null ? totalsOf(waitingViews.filter((v) => v.startedAt >= startOfWeek(now))) : null);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeading
        title="Activity"
        description="Walks, runs and rides tracked with your phone’s GPS: route, distance, time, pace and a card to share."
        actions={<Link href="/activity/record" className="fitx-button min-h-11"><Play size={16} aria-hidden="true" />Start activity</Link>}
      />

      {notice && <p role="status" className="fitx-alert fitx-alert-success">{notice}</p>}

      {unfinished && (
        <Link href="/activity/record" className="fitx-panel flex min-h-16 items-center justify-between gap-3 border-fitx-primary/40 p-4">
          <span>
            <span className="block text-sm font-semibold text-fitx-text">Unfinished {SPORT_NOUN[unfinished.sport]} on this device</span>
            <span className="block text-xs text-fitx-text-secondary">Started {formatActivityDate(unfinished.startedAt)}. Resume or finish it.</span>
          </span>
          <ChevronRight size={18} aria-hidden="true" className="text-fitx-primary" />
        </Link>
      )}

      {weekTotals && (weekTotals.count > 0 || groups.length > 0) && (
        <section className="fitx-panel p-4 sm:p-5" aria-labelledby="week-title">
          <h2 id="week-title" className="text-sm font-semibold text-fitx-text">This week</h2>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <div><p className="text-[10px] font-semibold uppercase tracking-[.13em] text-fitx-text-secondary">Distance</p><p className="mt-1 text-2xl font-semibold tabular-nums">{kmValue(weekTotals.distanceM)}<span className="ml-1 text-sm font-medium text-fitx-text-secondary">km</span></p></div>
            <div><p className="text-[10px] font-semibold uppercase tracking-[.13em] text-fitx-text-secondary">Moving time</p><p className="mt-1 text-2xl font-semibold tabular-nums">{formatDuration(weekTotals.movingSeconds)}</p></div>
            <div><p className="text-[10px] font-semibold uppercase tracking-[.13em] text-fitx-text-secondary">Activities</p><p className="mt-1 text-2xl font-semibold tabular-nums">{weekTotals.count}</p></div>
          </div>
          {weekTotals.count > 0 && (
            <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fitx-text-secondary">
              {SPORTS.filter((sport) => weekTotals.bySport[sport].count > 0).map((sport) => (
                <span key={sport} className="inline-flex items-center gap-1.5"><SportIcon sport={sport} size={13} />{SPORT_LABEL[sport]} {formatDistance(weekTotals.bySport[sport].distanceM)}</span>
              ))}
            </p>
          )}
        </section>
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
        history.status === "ready" && <EmptyState title="No activities yet" description="Start a walk, run or ride. Keep FITX open with the screen on while you record." action={<Link href="/activity/record" className="fitx-button min-h-11"><Play size={16} aria-hidden="true" />Start activity</Link>} />
      ) : (
        <div className="space-y-5">
          {groups.map((group) => (
            <section key={group.weekStart} aria-label={now === null ? undefined : weekLabel(group.weekStart, now)}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-[.12em] text-fitx-text-secondary">{now === null ? "" : weekLabel(group.weekStart, now)}</h2>
              <ul className="space-y-2">{group.items.map((activity) => <ActivityRow key={activity.clientId || activity.id} activity={activity} />)}</ul>
            </section>
          ))}
          {history.status === "ready" && history.more && (
            <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="fitx-button fitx-button-secondary min-h-11 w-full">{loadingMore ? "Loading…" : "Show older activities"}</button>
          )}
        </div>
      )}

      <section className="fitx-panel p-4 sm:p-5" aria-labelledby="privacy-title">
        <h2 id="privacy-title" className="flex items-center gap-2 text-sm font-semibold text-fitx-text"><ShieldCheck size={16} aria-hidden="true" className="text-fitx-primary" />Your location data</h2>
        <ul className="mt-2 space-y-1.5 text-xs leading-5 text-fitx-text-secondary">
          <li>Location is used while the Record screen is open (to show the GPS signal, then to record); only the positions from while you record are kept, and routes are visible only to you.</li>
          <li>Share images leave out the area around your start and finish.</li>
          <li>Detailed GPS points are deleted after 90 days; activity summaries and routes stay until you delete them.</li>
        </ul>
        {confirmDeleteAll ? (
          <div className="mt-4 rounded-lg border border-fitx-danger-border bg-fitx-danger-bg p-4" role="group" aria-label="Delete all activity data?">
            <p className="text-sm font-semibold text-fitx-danger">Delete every activity, route and GPS point in your account and on this device? This can’t be undone.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => setConfirmDeleteAll(false)} className="fitx-button fitx-button-secondary min-h-11">Keep my data</button>
              <button type="button" onClick={() => void deleteAll()} className="fitx-button fitx-button-danger min-h-11"><Trash2 size={15} aria-hidden="true" />Delete everything</button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmDeleteAll(true)} className="fitx-button fitx-button-quiet mt-4 min-h-11"><Trash2 size={15} aria-hidden="true" />Delete all activity data</button>
        )}
      </section>
    </div>
  );
}
