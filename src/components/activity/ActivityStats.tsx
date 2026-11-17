import Link from "next/link";
import { Dumbbell, Minus, Trophy, TrendingDown, TrendingUp } from "lucide-react";
import { SPORT_LABEL } from "@/lib/activity/config";
import { formatActivityDate, formatDistance, formatDuration, formatDurationWords, formatPace, formatSpeed, kmValue } from "@/lib/activity/format";
import type { ActivitySummary, PeriodTotals } from "@/lib/activity/repository";
import { BEST_MIN_DISTANCE_M, sportsWithBests, type PeriodKey, type SportBests, type WeekChange } from "@/lib/activity/stats";
import { SPORTS, type Sport } from "@/lib/activity/types";
import { SportIcon } from "./sports";

/*
 * Activity statistics on the Activity page: this week against last week, this month, this year and
 * personal bests per sport. Every figure is a sum of saved activities or one real activity (linked);
 * strength sessions are listed separately and never added to distance or pace.
 */

const label = "text-[10px] font-semibold uppercase tracking-[.13em] text-fitx-text-secondary";

function hrefFor(activity: ActivitySummary): string {
  return activity.local ? `/activity/local-${activity.clientId}` : `/activity/${activity.id}`;
}

function SportLine({ totals }: { totals: PeriodTotals }) {
  const sports = SPORTS.filter((sport) => totals.bySport[sport].count > 0);
  if (!sports.length) return null;
  return (
    <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fitx-text-secondary">
      {sports.map((sport) => (
        <span key={sport} className="inline-flex items-center gap-1.5"><SportIcon sport={sport} size={13} />{SPORT_LABEL[sport]} {formatDistance(totals.bySport[sport].distanceM)}</span>
      ))}
    </p>
  );
}

function ChangeLine({ change }: { change: WeekChange }) {
  const Icon = change.direction === "up" ? TrendingUp : change.direction === "down" ? TrendingDown : Minus;
  const text = change.direction === "same"
    ? "Same distance as last week"
    : `${change.direction === "up" ? "+" : "−"}${kmValue(Math.abs(change.distanceM))} km on last week`;
  return <p className="inline-flex items-center gap-1.5 text-xs font-medium text-fitx-text-secondary"><Icon size={14} aria-hidden="true" className="text-fitx-primary" />{text}</p>;
}

export function WeekPanel({ week, change, strength }: { week: PeriodTotals; change: WeekChange | null; strength: { count: number; trainingSeconds: number } | null }) {
  return (
    <section className="fitx-panel p-4 sm:p-5" aria-labelledby="week-title">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="week-title" className="text-sm font-semibold text-fitx-text">This week</h2>
        {change && <ChangeLine change={change} />}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3">
        <div><p className={label}>Distance</p><p className="mt-1 text-2xl font-semibold tabular-nums">{kmValue(week.distanceM)}<span className="ml-1 text-sm font-medium text-fitx-text-secondary">km</span></p></div>
        <div><p className={label}>Moving time</p><p className="mt-1 text-2xl font-semibold tabular-nums">{formatDuration(week.movingSeconds)}</p></div>
        <div><p className={label}>Activities</p><p className="mt-1 text-2xl font-semibold tabular-nums">{week.count}</p></div>
      </div>
      <SportLine totals={week} />
      {strength && strength.count > 0 && (
        <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-fitx-text-secondary"><Dumbbell size={13} aria-hidden="true" />Strength: {strength.count} {strength.count === 1 ? "session" : "sessions"} · {formatDurationWords(strength.trainingSeconds)} training</p>
      )}
    </section>
  );
}

function PeriodCard({ title, totals }: { title: string; totals: PeriodTotals }) {
  return (
    <div className="rounded-xl border border-fitx-border bg-fitx-card p-4">
      <h3 className={label}>{title}</h3>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-fitx-text">{kmValue(totals.distanceM)}<span className="ml-1 text-sm font-medium text-fitx-text-secondary">km</span></p>
      <p className="mt-1 text-xs tabular-nums text-fitx-text-secondary">
        {totals.count} {totals.count === 1 ? "activity" : "activities"} · {formatDuration(totals.movingSeconds)} moving
      </p>
    </div>
  );
}

export function PeriodTotalsPanel({ totals, now, complete }: { totals: Record<PeriodKey, PeriodTotals>; now: number; complete: boolean }) {
  const date = new Date(now);
  const month = date.toLocaleDateString("en-IN", { month: "long" });
  return (
    <section aria-labelledby="totals-title" className="space-y-2">
      <h2 id="totals-title" className="sr-only">Month and year totals</h2>
      <div className="grid grid-cols-2 gap-3">
        <PeriodCard title={`This month · ${month}`} totals={totals.month} />
        <PeriodCard title={`This year · ${date.getFullYear()}`} totals={totals.year} />
      </div>
      {!complete && <p className="text-xs text-fitx-text-secondary">Totals count your latest 10,000 activities.</p>}
    </section>
  );
}

function BestLink({ name, value, activity }: { name: string; value: string; activity: ActivitySummary }) {
  return (
    <Link href={hrefFor(activity)} className="group flex min-h-12 items-center justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-fitx-hover">
      <span className="min-w-0">
        <span className="block text-xs text-fitx-text-secondary">{name}</span>
        <span className="block truncate text-xs text-fitx-text-secondary">{activity.title} · {formatActivityDate(activity.startedAt)}</span>
      </span>
      <span className="shrink-0 text-base font-semibold tabular-nums text-fitx-text group-hover:text-fitx-primary-text">{value}</span>
    </Link>
  );
}

function SportBestsRow({ sport, bests }: { sport: Sport; bests: SportBests }) {
  return (
    <li className="rounded-xl border border-fitx-border bg-fitx-card p-2">
      <p className="flex items-center gap-2 px-2 pt-1 text-sm font-semibold text-fitx-text"><SportIcon sport={sport} size={16} className="text-fitx-primary" />{SPORT_LABEL[sport]}</p>
      <div className="mt-1 grid sm:grid-cols-2">
        {bests.longest && <BestLink name="Longest" value={formatDistance(bests.longest.value)} activity={bests.longest.activity} />}
        {bests.fastest && (
          <BestLink
            name={sport === "ride" ? "Fastest average speed" : "Fastest average pace"}
            value={sport === "ride" ? formatSpeed(bests.fastest.value) : formatPace(bests.fastest.value)}
            activity={bests.fastest.activity}
          />
        )}
      </div>
    </li>
  );
}

export function PersonalBestsPanel({ bests }: { bests: Record<Sport, SportBests> }) {
  const sports = sportsWithBests(bests);
  if (!sports.length) return null;
  return (
    <section className="fitx-panel p-4 sm:p-5" aria-labelledby="bests-title">
      <h2 id="bests-title" className="flex items-center gap-2 text-sm font-semibold text-fitx-text"><Trophy size={16} aria-hidden="true" className="text-fitx-primary" />Personal bests</h2>
      <p className="mt-1 text-xs leading-5 text-fitx-text-secondary">From your saved activities. The fastest average counts activities of {BEST_MIN_DISTANCE_M / 1000} km or more, over moving time.</p>
      <ul className="mt-3 space-y-2">
        {sports.map((sport) => <SportBestsRow key={sport} sport={sport} bests={bests[sport]} />)}
      </ul>
    </section>
  );
}
