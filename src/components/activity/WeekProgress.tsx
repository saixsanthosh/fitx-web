"use client";

import { m } from "framer-motion";
import { Dumbbell, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { CountUp, EASE } from "@/components/motion";
import { SPORT_LABEL } from "@/lib/activity/config";
import { barScale, recentWeeks, weekDays, type SportFilter } from "@/lib/activity/feed";
import { formatDistance, formatDuration, formatDurationWords, kmValue } from "@/lib/activity/format";
import type { ActivitySummary, PeriodTotals } from "@/lib/activity/repository";
import type { WeekChange } from "@/lib/activity/stats";
import { SPORTS } from "@/lib/activity/types";
import { cn } from "@/lib/utils";
import { SPORT_TONE } from "./sports";

const DAY = new Intl.DateTimeFormat("en-GB", { weekday: "short" });
const SHORT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

function ChangeLine({ change }: { change: WeekChange }) {
  const Icon = change.direction === "up" ? TrendingUp : change.direction === "down" ? TrendingDown : Minus;
  const text = change.direction === "same"
    ? "Same as last week"
    : `${change.direction === "up" ? "+" : "−"}${kmValue(Math.abs(change.distanceM))} km on last week`;
  return <p className="inline-flex items-center gap-1.5 text-xs font-medium text-fitx-text-secondary"><Icon size={14} aria-hidden="true" className="text-fitx-primary" />{text}</p>;
}

type WeekProgressProps = {
  rows: readonly ActivitySummary[];
  week: PeriodTotals;
  change: WeekChange | null;
  now: number;
  strength: { count: number; trainingSeconds: number } | null;
  filter?: SportFilter;
};

/** This week at a glance: distance, time, a bar per day (stacked by sport) and the last 12 weeks. */
export function WeekProgress({ rows, week, change, now, strength, filter = "all" }: WeekProgressProps) {
  const days = weekDays(rows, now, filter);
  const dayHeights = barScale(days.map((day) => day.distanceM));
  const weeks = recentWeeks(rows, now, 12, filter);
  const weekHeights = barScale(weeks.map((item) => item.distanceM));
  const todayIndex = days.findIndex((day, i) => now >= day.dayStart && (i === 6 || now < days[i + 1].dayStart));
  const sports = SPORTS.filter((sport) => week.bySport[sport].count > 0);

  return (
    <section className="overflow-hidden rounded-3xl border border-fitx-border bg-fitx-card" aria-labelledby="week-title">
      <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-10 lg:p-8">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 id="week-title" className="text-sm font-semibold text-fitx-text">This week</h2>
            {change && <ChangeLine change={change} />}
          </div>
          <p className="mt-3 flex items-baseline gap-1.5 font-heading text-[56px] font-bold leading-none tracking-[-.045em] text-fitx-text sm:text-[64px]">
            <CountUp value={week.distanceM / 1000} format={(n) => n.toFixed(2)} />
            <span className="font-body text-lg font-medium tracking-normal text-fitx-text-secondary">km</span>
          </p>
          <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <div><dt className="text-xs text-fitx-text-secondary">Moving time</dt><dd className="font-semibold tabular-nums text-fitx-text">{formatDuration(week.movingSeconds)}</dd></div>
            <div><dt className="text-xs text-fitx-text-secondary">Activities</dt><dd className="font-semibold tabular-nums text-fitx-text">{week.count}</dd></div>
            {strength && strength.count > 0 && (
              <div><dt className="inline-flex items-center gap-1 text-xs text-fitx-text-secondary"><Dumbbell size={12} aria-hidden="true" />Strength</dt><dd className="font-semibold tabular-nums text-fitx-text">{strength.count} · {formatDurationWords(strength.trainingSeconds)}</dd></div>
            )}
          </dl>
          {sports.length > 0 && (
            <ul className="mt-4 flex flex-wrap gap-2" aria-label="By sport">
              {sports.map((sport) => (
                <li key={sport} className={cn("inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium", SPORT_TONE[sport].bg, SPORT_TONE[sport].text)}>
                  <span className={cn("h-2 w-2 rounded-full", SPORT_TONE[sport].fill)} aria-hidden="true" />
                  {SPORT_LABEL[sport]} {formatDistance(week.bySport[sport].distanceM)}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="grid min-w-0 gap-6">
          <ul className="grid h-36 grid-cols-7 items-end gap-2" aria-label="Distance per day">
            {days.map((day, i) => (
              <li key={day.dayStart} className="flex h-full min-w-0 flex-col items-center justify-end gap-2">
                <span className="sr-only">{DAY.format(day.dayStart)}: {day.count ? formatDistance(day.distanceM) : "nothing recorded"}</span>
                <div className="relative flex w-full max-w-9 flex-1 items-end" aria-hidden="true">
                  <div className="absolute inset-x-0 bottom-0 h-full rounded-lg bg-fitx-surface-variant" />
                  {dayHeights[i] > 0 && (
                    <m.div
                      className="relative flex w-full origin-bottom flex-col-reverse overflow-hidden rounded-lg"
                      style={{ height: `${Math.max(6, dayHeights[i] * 100)}%` }}
                      initial={{ scaleY: 0 }}
                      whileInView={{ scaleY: 1 }}
                      viewport={{ once: true, amount: 0.6 }}
                      transition={{ duration: 0.6, ease: EASE.out, delay: i * 0.05 }}
                    >
                      {SPORTS.filter((sport) => day.bySport[sport] > 0).map((sport) => (
                        <span key={sport} className={cn("block w-full", SPORT_TONE[sport].fill)} style={{ height: `${(day.bySport[sport] / day.distanceM) * 100}%` }} />
                      ))}
                    </m.div>
                  )}
                </div>
                <span aria-hidden="true" className={cn("text-[11px] tabular-nums", i === todayIndex ? "font-bold text-fitx-text" : "text-fitx-text-secondary")}>{DAY.format(day.dayStart).slice(0, 1)}</span>
              </li>
            ))}
          </ul>

          <div>
            <p className="flex items-baseline justify-between text-xs text-fitx-text-secondary">
              <span className="font-semibold text-fitx-text">Last 12 weeks</span>
              <span className="tabular-nums">{kmValue(weeks.reduce((sum, item) => sum + item.distanceM, 0))} km</span>
            </p>
            <ul className="mt-2 grid h-12 grid-cols-12 items-end gap-1" aria-label="Distance per week, last 12 weeks">
              {weeks.map((item, i) => (
                <li key={item.weekStart} className="flex h-full items-end">
                  <span className="sr-only">Week of {SHORT.format(item.weekStart)}: {item.count ? formatDistance(item.distanceM) : "nothing recorded"}</span>
                  <m.span
                    aria-hidden="true"
                    className={cn("block w-full origin-bottom rounded-sm", i === weeks.length - 1 ? "bg-fitx-primary" : item.distanceM > 0 ? "bg-fitx-text-secondary/45" : "bg-fitx-surface-variant")}
                    style={{ height: `${Math.max(8, weekHeights[i] * 100)}%` }}
                    initial={{ scaleY: 0 }}
                    whileInView={{ scaleY: 1 }}
                    viewport={{ once: true, amount: 0.6 }}
                    transition={{ duration: 0.5, ease: EASE.out, delay: 0.2 + i * 0.03 }}
                  />
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
