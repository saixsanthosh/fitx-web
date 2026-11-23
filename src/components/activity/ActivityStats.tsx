import Link from "next/link";
import { Trophy } from "lucide-react";
import { SPORT_LABEL, usesPace } from "@/lib/activity/config";
import { formatActivityDate, formatDistance, formatDuration, formatPace, formatSpeed, kmValue } from "@/lib/activity/format";
import type { ActivitySummary, PeriodTotals } from "@/lib/activity/repository";
import { BEST_MIN_DISTANCE_M, sportsWithBests, type PeriodKey, type SportBests } from "@/lib/activity/stats";
import type { Sport } from "@/lib/activity/types";
import { SportBadge } from "./sports";

/*
 * Activity statistics: this month, this year and personal bests per sport. Every figure is a sum of
 * saved activities or one real activity (linked); strength sessions are never added to distance or pace.
 */

function hrefFor(activity: ActivitySummary): string {
  return activity.local ? `/activity/local-${activity.clientId}` : `/activity/${activity.id}`;
}

function PeriodCard({ title, totals }: { title: string; totals: PeriodTotals }) {
  return (
    <div className="rounded-2xl border border-fitx-border bg-fitx-card p-4 sm:p-5">
      <h3 className="text-xs font-medium text-fitx-text-secondary">{title}</h3>
      <p className="mt-2 font-heading text-[28px] font-bold leading-none tracking-[-.03em] tabular-nums text-fitx-text">{kmValue(totals.distanceM)}<span className="ml-1 font-body text-sm font-medium tracking-normal text-fitx-text-secondary">km</span></p>
      <p className="mt-2 text-xs tabular-nums text-fitx-text-secondary">
        {totals.count} {totals.count === 1 ? "activity" : "activities"} · {formatDuration(totals.movingSeconds)}
      </p>
    </div>
  );
}

export function PeriodTotalsPanel({ totals, now, complete }: { totals: Record<PeriodKey, PeriodTotals>; now: number; complete: boolean }) {
  const date = new Date(now);
  const month = date.toLocaleDateString("en-GB", { month: "long" });
  return (
    <section aria-labelledby="totals-title" className="space-y-2">
      <h2 id="totals-title" className="sr-only">Month and year totals</h2>
      <div className="grid grid-cols-2 gap-3">
        <PeriodCard title={month} totals={totals.month} />
        <PeriodCard title={String(date.getFullYear())} totals={totals.year} />
      </div>
      {!complete && <p className="text-xs text-fitx-text-secondary">Totals count your latest 10,000 activities.</p>}
    </section>
  );
}

function BestLink({ name, value, activity }: { name: string; value: string; activity: ActivitySummary }) {
  return (
    <Link href={hrefFor(activity)} className="group flex min-h-14 items-center justify-between gap-3 rounded-xl px-3 py-2 hover:bg-fitx-hover">
      <span className="min-w-0">
        <span className="block text-xs font-medium text-fitx-text">{name}</span>
        <span className="block truncate text-xs text-fitx-text-secondary">{activity.title} · {formatActivityDate(activity.startedAt)}</span>
      </span>
      <span className="shrink-0 font-heading text-lg font-bold tabular-nums text-fitx-text group-hover:text-fitx-primary-text">{value}</span>
    </Link>
  );
}

function SportBestsRow({ sport, bests, showSport }: { sport: Sport; bests: SportBests; showSport: boolean }) {
  return (
    <li className="rounded-2xl border border-fitx-border bg-fitx-card p-2">
      {showSport && <p className="flex items-center gap-2 px-3 pb-1 pt-2 text-sm font-semibold text-fitx-text"><SportBadge sport={sport} size={28} />{SPORT_LABEL[sport]}</p>}
      <div className="grid sm:grid-cols-2">
        {bests.longest && <BestLink name="Longest" value={formatDistance(bests.longest.value)} activity={bests.longest.activity} />}
        {bests.fastest && (
          <BestLink
            name={usesPace(sport) ? "Fastest average pace" : "Fastest average speed"}
            value={usesPace(sport) ? formatPace(bests.fastest.value) : formatSpeed(bests.fastest.value)}
            activity={bests.fastest.activity}
          />
        )}
      </div>
    </li>
  );
}

/** Personal bests; `only` limits them to one sport (its own page). */
export function PersonalBestsPanel({ bests, only }: { bests: Record<Sport, SportBests>; only?: Sport }) {
  const sports = sportsWithBests(bests).filter((sport) => !only || sport === only);
  if (!sports.length) return null;
  return (
    <section aria-labelledby="bests-title">
      <h2 id="bests-title" className="flex items-center gap-2 font-heading text-lg font-bold tracking-[-.02em] text-fitx-text"><Trophy size={18} aria-hidden="true" className="text-fitx-primary" />Personal bests</h2>
      <p className="mt-1 text-xs text-fitx-text-secondary">Fastest average counts activities of {BEST_MIN_DISTANCE_M / 1000} km or more.</p>
      <ul className="mt-3 space-y-2">
        {sports.map((sport) => <SportBestsRow key={sport} sport={sport} bests={bests[sport]} showSport={!only} />)}
      </ul>
    </section>
  );
}
