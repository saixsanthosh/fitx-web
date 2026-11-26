"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { CalendarClock, CloudOff, Play } from "lucide-react";
import { Reveal } from "@/components/motion";
import { SPORT_NOUN, usesPace } from "@/lib/activity/config";
import { formatActivityDate, formatDuration, kmValue, paceValue, speedValue } from "@/lib/activity/format";
import { FUTURE_DATE_MARK, startsInFuture } from "@/lib/activity/future";
import { focusDropped } from "@/lib/activity/focus";
import { decodeRoute } from "@/lib/activity/polyline";
import type { ActivityView } from "@/lib/activity/repository";
import { focusAfterOlder, type TimelineEntry } from "@/lib/activity/timeline";
import type { Sport } from "@/lib/activity/types";
import { groupByWeek, weekLabel } from "@/lib/activity/weeks";
import { ActivitySourceBadge } from "./ActivitySourceBadge";
import { RouteSvg } from "./RouteSvg";
import { recordHref, SPORT_PLURAL, SportBadge, SPORT_TONE } from "./sports";
import { StrengthRow } from "./StrengthRow";

function Figure({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-fitx-text-secondary">{label}</dt>
      <dd className="mt-0.5 truncate font-heading text-lg font-bold tabular-nums tracking-[-.02em] text-fitx-text sm:text-xl">
        {value}{unit && value !== "–" && <span className="font-body text-xs font-medium text-fitx-text-secondary">{`\u00a0${unit}`}</span>}
      </dd>
    </div>
  );
}

/**
 * One walk, run or ride in the feed: who-when line, title, the sport's figures and the route. One dated after
 * now says so: weekly, monthly and yearly totals leave it out until then (all time and bests count it).
 */
export function ActivityCard({ activity, now, entryKey }: { activity: ActivityView; now: number | null; entryKey?: string }) {
  const href = activity.local ? `/activity/local-${activity.clientId}` : `/activity/${activity.id}`;
  const route = decodeRoute(activity.routePolyline);
  const hasRoute = route.some((segment) => segment.length > 1);
  const pace = usesPace(activity.sport);
  const future = now !== null && startsInFuture(activity.startedAt, now);
  return (
    <li>
      <Link
        href={href}
        data-feed-entry={entryKey}
        className="group block overflow-hidden rounded-2xl border border-fitx-border bg-fitx-card transition-[border-color,transform] duration-200 hover:border-fitx-primary/40 motion-safe:active:scale-[.995]"
      >
        <div className="flex items-start gap-3 p-4 pb-3 sm:p-5 sm:pb-3">
          <SportBadge sport={activity.sport} size={40} />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-x-2 text-xs text-fitx-text-secondary">
              <span>{formatActivityDate(activity.startedAt)}</span>
              {activity.local && <span className="inline-flex items-center gap-1 text-fitx-warning"><CloudOff size={12} aria-hidden="true" />On this device</span>}
              {future && <span className="inline-flex items-center gap-1 text-fitx-warning"><CalendarClock size={12} aria-hidden="true" className="shrink-0" />{FUTURE_DATE_MARK}</span>}
            </p>
            <p className="mt-0.5 truncate font-heading text-[17px] font-bold tracking-[-.02em] text-fitx-text group-hover:text-fitx-primary-text">{activity.title}</p>
            <ActivitySourceBadge info={activity} className="mt-1 max-w-full" />
          </div>
        </div>
        <dl className="grid grid-cols-3 gap-3 px-4 pb-4 sm:px-5">
          <Figure label="Distance" value={kmValue(activity.distanceM)} unit="km" />
          {pace
            ? <Figure label="Pace" value={paceValue(activity.avgPaceSecondsPerKm)} unit="/km" />
            : <Figure label="Speed" value={speedValue(activity.avgSpeedMps)} unit="km/h" />}
          <Figure label="Time" value={formatDuration(activity.movingSeconds)} />
        </dl>
        {hasRoute && (
          <div className="relative mx-2 mb-2 aspect-[16/7] overflow-hidden rounded-xl bg-fitx-surface-variant">
            <svg className="absolute inset-0 h-full w-full text-fitx-border" aria-hidden="true" focusable="false">
              <defs>
                <pattern id={`grid-${activity.clientId}`} width="28" height="28" patternUnits="userSpaceOnUse">
                  <path d="M28 0H0V28" fill="none" stroke="currentColor" strokeWidth="1" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill={`url(#grid-${activity.clientId})`} />
            </svg>
            <RouteSvg segments={route} className="absolute inset-0 h-full w-full p-3" strokeWidth={3} stroke={SPORT_TONE[activity.sport].stroke} />
          </div>
        )}
      </Link>
    </li>
  );
}

type FeedListProps = {
  entries: TimelineEntry[];
  now: number | null;
  /** The sport the list is limited to, for the empty state. */
  sport: Sport | null;
  loading: boolean;
  ready: boolean;
  more: boolean;
  loadingMore: boolean;
  /** The last older page couldn't be read. */
  moreFailed: boolean;
  /** Starts reading older entries; false when nothing started (one is still loading, or nothing is left). */
  onLoadMore: () => boolean;
};

/** The entry's link in the list, by its timeline key. */
function entryLink(list: HTMLElement | null, key: string): HTMLElement | null {
  return Array.from(list?.querySelectorAll<HTMLElement>("[data-feed-entry]") ?? []).find((link) => link.dataset.feedEntry === key) ?? null;
}

/** The history, newest first, in weeks. */
export function FeedList({ entries, now, sport, loading, ready, more, loadingMore, moreFailed, onLoadMore }: FeedListProps) {
  // "Show older activities" (D5): never disabled while it loads (aria-disabled, a press meanwhile does nothing), so
  // keyboard focus stays on it; it keeps focus while there are more, and once it goes the first entry it brought
  // takes focus, so the member carries on where the older entries start.
  const list = useRef<HTMLDivElement>(null);
  const pressed = useRef<{ shown: string[] } | null>(null);
  const keys = entries.map((entry) => entry.key).join("\n");
  useEffect(() => {
    const press = pressed.current;
    if (!press || loadingMore) return;
    pressed.current = null;
    const target = focusAfterOlder(press.shown, keys ? keys.split("\n") : [], more);
    if (target && focusDropped(document)) entryLink(list.current, target)?.focus();
  }, [keys, more, loadingMore]);

  function showOlder() {
    if (loadingMore) return;
    const shown = keys ? keys.split("\n") : [];
    if (onLoadMore()) pressed.current = { shown };
  }

  if (loading) {
    return (
      <div className="space-y-3" aria-hidden="true">
        {[0, 1, 2].map((i) => <div key={i} className="h-44 animate-pulse rounded-2xl bg-fitx-surface-variant" />)}
      </div>
    );
  }
  if (!entries.length) {
    if (!ready) return null;
    return (
      <div className="rounded-2xl border border-dashed border-fitx-border px-5 py-10 text-center">
        <p className="font-heading text-lg font-bold text-fitx-text">{sport ? `No ${SPORT_PLURAL[sport].toLowerCase()} yet` : "No activities yet"}</p>
        <Link href={sport ? recordHref(sport) : "/activity/record"} className="fitx-button mt-4 min-h-11">
          <Play size={16} aria-hidden="true" />{sport ? `Start a ${SPORT_NOUN[sport]}` : "Record"}
        </Link>
      </div>
    );
  }
  const groups = groupByWeek(entries);
  return (
    <div ref={list} className="space-y-7">
      {groups.map((group) => {
        const label = now === null ? "" : weekLabel(group.weekStart, now);
        return (
          <section key={group.weekStart} aria-label={label || undefined}>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-[.14em] text-fitx-text-secondary">{label}</h3>
            <ul className="grid gap-3 lg:grid-cols-2">
              {group.items.map((entry) => (entry.kind === "activity"
                ? <ActivityCard key={entry.key} entryKey={entry.key} activity={entry.activity} now={now} />
                : <StrengthRow key={entry.key} entryKey={entry.key} session={entry.session} />))}
            </ul>
          </section>
        );
      })}
      {more && (
        <Reveal>
          <button type="button" onClick={showOlder} aria-disabled={loadingMore || undefined} className="fitx-button fitx-button-secondary min-h-11 w-full aria-disabled:cursor-progress aria-disabled:opacity-60">{loadingMore ? "Loading…" : "Show older activities"}</button>
          {moreFailed && <p role="alert" className="mt-2 text-sm text-fitx-danger">Older activities couldn’t load. Check your connection and try again.</p>}
        </Reveal>
      )}
    </div>
  );
}
