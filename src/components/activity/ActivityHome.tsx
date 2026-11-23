"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { ChevronDown, ChevronRight, CloudOff, FileUp, Play, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/app/EmptyState";
import { Stagger, StaggerItem } from "@/components/motion";
import { PageHeader } from "@/components/ui/PageHeader";
import { Segmented } from "@/components/ui/Segmented";
import { SPORT_LABEL, SPORT_NOUN } from "@/lib/activity/config";
import { parseSportFilter, weekBySport, type SportFilter } from "@/lib/activity/feed";
import { formatActivityDate, formatDistance } from "@/lib/activity/format";
import { clearDeviceActivityData } from "@/lib/activity/device-recordings";
import { recordingStore } from "@/lib/activity/local-store";
import { deleteAllActivities } from "@/lib/activity/repository";
import { periods, periodTotals, personalBests, weekChange } from "@/lib/activity/stats";
import { strengthTotals } from "@/lib/activity/strength";
import { PRIMARY_SPORTS, SPORTS, type Sport } from "@/lib/activity/types";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { AccountError } from "./AccountError";
import { PeriodTotalsPanel, PersonalBestsPanel } from "./ActivityStats";
import { FeedList } from "./FeedList";
import { SPORT_PLURAL, SportBadge, sportHref, SPORT_TONE } from "./sports";
import { useActivityAccount } from "./useActivityAccount";
import { useActivityFeed } from "./useActivityFeed";
import { WeekProgress } from "./WeekProgress";
import { BestEffortsOverview } from "./BestEfforts";
import { useActivityV2, useStoredEfforts } from "./useActivityV2";

/** All, the three main sports, then any other sport the member has recorded (or the address asks for). */
function filtersFor(used: ReadonlySet<Sport>, current: SportFilter) {
  const sports = SPORTS.filter((sport) => PRIMARY_SPORTS.includes(sport) || used.has(sport) || sport === current);
  return [{ value: "all" as const, label: "All" }, ...sports.map((sport) => ({ value: sport, label: SPORT_PLURAL[sport] }))];
}

export function ActivityHome() {
  const account = useActivityAccount();
  const userId = account.status === "ready" ? account.userId : null;
  // The filter lives in the address (?sport=), so going to plain /activity (the nav, a back link) shows everything again.
  // A choice shows at once and holds only until the router reports the new address.
  const addressFilter = parseSportFilter(useSearchParams().get("sport") ?? undefined);
  const [picked, setPicked] = useState<SportFilter | null>(null);
  if (picked !== null && picked === addressFilter) setPicked(null);
  const filter = picked ?? addressFilter;
  const feed = useActivityFeed(userId, filter);
  const [syncing, setSyncing] = useState(false);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [notice, setNotice] = useState("");
  const focusOnMount = useCallback((element: HTMLElement | null) => element?.focus(), []);
  const deleteAllTriggerRef = useRef<HTMLButtonElement | null>(null);
  const v2 = useActivityV2(userId);
  const storedEfforts = useStoredEfforts(userId);

  function chooseFilter(next: SportFilter) {
    setPicked(next === addressFilter ? null : next);
    const url = new URL(window.location.href);
    if (next === "all") url.searchParams.delete("sport");
    else url.searchParams.set("sport", next);
    // No state of our own: Next's router then takes the new address, so useSearchParams follows it.
    window.history.replaceState(null, "", url);
  }

  async function syncNow() {
    if (!userId) return;
    setSyncing(true);
    await feed.reload(userId);
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
    setNotice(result.status === "unavailable" ? "Activity data on this device was deleted." : "All your activities and their routes were deleted.");
    await feed.reload(userId);
  }

  if (account.status === "loading") return <div className="fitx-panel animate-pulse p-8 text-sm text-fitx-text-secondary">Loading activity…</div>;
  if (account.status === "unconfigured") return <EmptyState title="Activity tracking isn’t connected" description="FITX is not connected to its database on this site." />;
  if (account.status === "error") return <AccountError />;
  if (account.status === "signed-out") return <EmptyState title="Sign in to track activities" description="Your activities are saved to your account." action={<Link href="/signin?next=/activity" className="fitx-button min-h-11">Sign in</Link>} />;

  const { history, statRows, now, unfinished, waiting, timeline } = feed;
  const totals = statRows && now !== null ? periodTotals(statRows, now) : null;
  const bounds = now !== null ? periods(now) : null;
  const strengthWeek = feed.recentStrength && bounds ? strengthTotals(feed.recentStrength, bounds.week.start, bounds.week.end) : null;
  const bests = statRows ? personalBests(statRows) : null;
  const hasAnything = (statRows?.length ?? 0) > 0 || timeline.entries.length > 0;
  const sportWeek = statRows && now !== null ? weekBySport(statRows, now) : null;
  const used = new Set((statRows ?? []).map((row) => row.sport));
  // The newer sports once the database takes them (or once the member has any, imported before an undo).
  const moreSports = SPORTS.filter((sport) => !PRIMARY_SPORTS.includes(sport) && (v2 === true || used.has(sport)));

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Activity"
        actions={(
          <>
            <Link href="/activity/import" className="fitx-button fitx-button-secondary min-h-11"><FileUp size={16} aria-hidden="true" />Import</Link>
            <Link href="/activity/record" className="fitx-button min-h-11"><Play size={16} aria-hidden="true" />Record</Link>
          </>
        )}
      />

      <div className="space-y-8 sm:space-y-10">
        {notice && <p role="status" className="fitx-alert fitx-alert-success">{notice}</p>}

        {unfinished && (
          <Link href={`/activity/record?sport=${unfinished.sport}`} className="flex min-h-16 items-center justify-between gap-3 rounded-2xl border border-fitx-primary/40 bg-fitx-card p-4">
            <span className="flex items-center gap-3">
              <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
                <span className="absolute inset-0 rounded-full bg-fitx-primary motion-safe:animate-ping" />
                <span className="relative h-2.5 w-2.5 rounded-full bg-fitx-primary" />
              </span>
              <span>
                <span className="block text-sm font-semibold text-fitx-text">{feed.unfinishedElsewhere ? `Recording a ${SPORT_NOUN[unfinished.sport]} in another FITX window` : `Unfinished ${SPORT_NOUN[unfinished.sport]} on this device`}</span>
                <span className="block text-xs text-fitx-text-secondary">Started {formatActivityDate(unfinished.startedAt)}. {feed.unfinishedElsewhere ? "Finish it in that window or tab." : "Resume or finish it."}</span>
              </span>
            </span>
            <ChevronRight size={18} aria-hidden="true" className="text-fitx-primary" />
          </Link>
        )}

        <nav aria-label="Sports">
          <Stagger className="grid grid-cols-3 gap-2 sm:gap-3">
            {PRIMARY_SPORTS.map((sport) => (
              <StaggerItem key={sport} className="h-full">
                <Link
                  href={sportHref(sport)}
                  className={cn("group flex h-full min-h-28 flex-col justify-between rounded-2xl border border-transparent p-3 transition-colors sm:min-h-32 sm:p-4", SPORT_TONE[sport].bg, "hover:border-fitx-border")}
                >
                  <SportBadge sport={sport} size={36} className="bg-fitx-card" />
                  <span className="mt-3 block">
                    <span className="block font-heading text-base font-bold tracking-[-.02em] text-fitx-text sm:text-lg">{SPORT_LABEL[sport]}</span>
                    <span className="block text-xs leading-4 tabular-nums text-fitx-text-secondary">
                      {sportWeek && sportWeek[sport] > 0 ? <>{formatDistance(sportWeek[sport])}<span className="block sm:ml-1 sm:inline">this week</span></> : "Start"}
                    </span>
                  </span>
                </Link>
              </StaggerItem>
            ))}
          </Stagger>
          {moreSports.length > 0 && (
            <ul className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0" aria-label="More sports">
              {moreSports.map((sport) => (
                <li key={sport} className="shrink-0">
                  <Link href={sportHref(sport)} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-fitx-border bg-fitx-card py-1 pl-1.5 pr-4 text-sm font-medium text-fitx-text transition-colors hover:border-fitx-primary/40">
                    <SportBadge sport={sport} size={32} />
                    {SPORT_LABEL[sport]}
                    {sportWeek && sportWeek[sport] > 0 && <span className="tabular-nums text-fitx-text-secondary">{formatDistance(sportWeek[sport])}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </nav>

        {totals && hasAnything && now !== null && (
          <div className="space-y-3">
            <WeekProgress
              rows={statRows ?? []}
              week={totals.week}
              change={totals.lastWeek.count > 0 || totals.week.count > 0 ? weekChange(totals.week, totals.lastWeek) : null}
              now={now}
              strength={strengthWeek}
            />
            <PeriodTotalsPanel totals={totals} now={now} complete={feed.statsComplete} />
          </div>
        )}

        {history.status === "unavailable" && (
          <p role="status" className="fitx-alert flex gap-2"><CloudOff size={17} aria-hidden="true" className="mt-0.5 shrink-0 text-fitx-warning" /><span><span className="font-semibold">Activity history isn’t available yet.</span> You can still record and share; activities stay on this device and upload once history is ready.</span></p>
        )}
        {history.status === "error" && (
          <div role="alert" className="fitx-alert fitx-alert-danger flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>{history.offline ? "You’re offline. Activities you record still save on this device." : "Your history couldn’t load right now."}</span>
            <button type="button" onClick={() => void syncNow()} className="fitx-button fitx-button-secondary min-h-11 shrink-0"><RefreshCw size={15} aria-hidden="true" />Try again</button>
          </div>
        )}
        {waiting.length > 0 && history.status === "ready" && (
          <div className="fitx-alert flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="flex gap-2"><CloudOff size={17} aria-hidden="true" className="mt-0.5 shrink-0 text-fitx-warning" />{waiting.length} {waiting.length === 1 ? "activity is" : "activities are"} saved on this device and not uploaded yet.</span>
            <button type="button" disabled={syncing} onClick={() => void syncNow()} className="fitx-button fitx-button-secondary min-h-11 shrink-0"><RefreshCw size={15} aria-hidden="true" />{syncing ? "Uploading…" : "Upload now"}</button>
          </div>
        )}

        <section aria-labelledby="feed-title" className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 id="feed-title" className="font-heading text-xl font-bold tracking-[-.02em] text-fitx-text">Your activities</h2>
            <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              <Segmented options={filtersFor(used, filter)} value={filter} onChange={chooseFilter} label="Show" />
            </div>
          </div>
          <FeedList
            entries={timeline.entries}
            now={now}
            sport={filter === "all" ? null : filter}
            loading={history.status === "loading"}
            ready={history.status === "ready"}
            more={history.status === "ready" && timeline.more}
            loadingMore={feed.loadingMore}
            onLoadMore={() => void feed.loadMore()}
          />
          {filter === "all" && feed.sessions.status === "missing" && history.status === "ready" && <p className="text-xs text-fitx-text-secondary">Strength sessions couldn’t load here. They’re in Workouts.</p>}
        </section>

        <BestEffortsOverview state={storedEfforts} />
        {bests && <PersonalBestsPanel bests={bests} />}

        <details className="group rounded-2xl border border-fitx-border bg-fitx-card">
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-semibold text-fitx-text sm:px-5 [&::-webkit-details-marker]:hidden">
            <span className="flex items-center gap-2"><ShieldCheck size={16} aria-hidden="true" className="text-fitx-primary" />Your location data</span>
            <ChevronDown size={18} aria-hidden="true" className="text-fitx-text-secondary transition-transform group-open:rotate-180" />
          </summary>
          <div className="px-4 pb-5 sm:px-5">
            <ul className="space-y-1.5 text-xs leading-5 text-fitx-text-secondary">
              <li>Location is used while the Record screen is open (to show the GPS signal, then to record); only the positions from while you record are kept, and routes are visible only to you.</li>
              <li>Imported files are read on this device: only the activity’s summary, route and points are saved, never the file itself.</li>
              <li>Map images come from OpenFreeMap (openfreemap.org), which receives the map area shown (around you on the Record screen, around a route on an activity page) and your IP address, not your route or account.</li>
              <li>Share images leave out the area around your start and finish.</li>
              <li>Detailed GPS points are deleted after 90 days; activity summaries and routes stay until you delete them.</li>
              <li>Activities not uploaded yet are kept on this device until they are, or until you delete them.</li>
            </ul>
            {confirmDeleteAll ? (
              <div className="mt-4 rounded-xl border border-fitx-danger-border bg-fitx-danger-bg p-4" role="alertdialog" aria-labelledby="delete-all-question">
                <p id="delete-all-question" className="text-sm font-semibold text-fitx-danger">Delete every activity, with its route and GPS points, in your account and on this device? Strength sessions aren’t affected. This can’t be undone.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" ref={focusOnMount} onClick={() => { setConfirmDeleteAll(false); window.setTimeout(() => deleteAllTriggerRef.current?.focus(), 0); }} className="fitx-button fitx-button-secondary min-h-11">Keep my data</button>
                  <button type="button" onClick={() => void deleteAll()} className="fitx-button fitx-button-danger min-h-11"><Trash2 size={15} aria-hidden="true" />Delete everything</button>
                </div>
              </div>
            ) : (
              <button type="button" ref={deleteAllTriggerRef} onClick={() => setConfirmDeleteAll(true)} className="fitx-button fitx-button-quiet mt-4 min-h-11"><Trash2 size={15} aria-hidden="true" />Delete all activity data</button>
            )}
          </div>
        </details>
      </div>
    </div>
  );
}
