"use client";

import Link from "next/link";
import { ArrowRight, ChevronRight, Dumbbell } from "lucide-react";
import { BarSeries, type BarDatum } from "@/components/charts/BarSeries";
import { formatDurationWords } from "@/lib/activity/format";
import type { AllTimeTotals, Consistency, RecentWorkout } from "@/lib/data/progress";
import { keyToLocalDate } from "@/lib/domain/day-keys";
import type { WeekSoFar, WeekTrend } from "@/lib/domain/trends";
import styles from "./Progress.module.css";

export type SourceState = "ok" | "unavailable" | "error";

const number = (value: number, digits = 0) => value.toLocaleString(undefined, { maximumFractionDigits: digits });
const km = (metres: number) => number(metres / 1000, 1);
const dayMonth = (key: string) => keyToLocalDate(key).toLocaleDateString(undefined, { day: "numeric", month: "short" });
const dateLabel = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

type Cell = { label: string; value: string | null; unit?: string; versus: string };

/**
 * "This week so far" against the same days of last week: four numbers, no more. An unknown value shows a dash,
 * never 0; activities that could not be read say so.
 */
export function WeekBand({ week, activities }: { week: WeekSoFar; activities: SourceState }) {
  const now = week.current;
  const then = week.previous;
  const label = week.days === 1 ? "Last Monday" : "Last week";
  const versus = (value: string | null) => `${label}: ${value ?? "—"}`;
  const activityKnown = activities === "ok" && now.distanceM !== null && now.movingSeconds !== null;
  const activityNote = activities === "unavailable" ? "Activity isn't set up yet" : "Couldn't load activities";
  const cells: Cell[] = [
    { label: "Workouts", value: number(now.workouts), versus: versus(number(then.workouts)) },
    { label: "Volume", value: now.volumeKg === null ? null : number(now.volumeKg), unit: "kg", versus: versus(then.volumeKg === null ? null : `${number(then.volumeKg)} kg`) },
    { label: "Distance", value: activityKnown ? km(now.distanceM!) : null, unit: "km", versus: activityKnown ? versus(then.distanceM === null ? null : `${km(then.distanceM)} km`) : activityNote },
    { label: "Moving time", value: activityKnown ? formatDurationWords(now.movingSeconds!) : null, versus: activityKnown ? versus(then.movingSeconds === null ? null : formatDurationWords(then.movingSeconds)) : activityNote },
  ];
  return (
    <dl aria-label="This week so far" className={styles.band}>
      {cells.map((cell) => (
        <div key={cell.label} className={styles.bandCell}>
          <dt>{cell.label}</dt>
          <dd>
            <span className={styles.bandValue}>
              {cell.value === null ? <><span aria-hidden="true">—</span><span className="sr-only">Not known</span></> : cell.value}
              {cell.value !== null && cell.unit ? <span className={styles.bandUnit}>{cell.unit}</span> : null}
            </span>
            <span className={styles.bandVersus}>{cell.versus}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** One bar per Monday-to-Sunday week; the axis names a month under the first week that starts in it. */
function bars(weeks: readonly WeekTrend[], value: (week: WeekTrend) => number | null): BarDatum[] {
  const months = weeks.map((week) => keyToLocalDate(week.weekStart).getMonth());
  return weeks.map((week, index) => {
    const startsMonth = index === 0 ? months.length < 2 || months[1] === months[0] : months[index] !== months[index - 1];
    return {
      label: startsMonth ? keyToLocalDate(week.weekStart).toLocaleDateString(undefined, { month: "short" }) : "",
      longLabel: `Week of ${dayMonth(week.weekStart)}${week.inProgress ? " (so far)" : ""}`,
      value: value(week),
      muted: week.inProgress,
    };
  });
}

/**
 * Training: how regularly (weeks trained, against the member's own days-a-week plan), how much (volume), the
 * newest workouts with a link to each record, and the exact all-time count.
 */
export function TrainingPanel({
  weeks,
  consistency,
  recent,
  recentError,
  totals,
}: {
  weeks: readonly WeekTrend[];
  consistency: Consistency;
  recent: RecentWorkout[] | null;
  recentError: string;
  totals: AllTimeTotals | null;
}) {
  const anyTraining = weeks.some((week) => week.workouts > 0);
  return (
    <section aria-labelledby="training-title" className={styles.panel}>
      <div className={styles.panelHead}>
        <h2 id="training-title" className={styles.panelTitle}><Dumbbell size={17} aria-hidden="true" />Training</h2>
        <span className={styles.panelNote}>{weeks.length === 1 ? "This week" : `Last ${weeks.length} weeks`}</span>
      </div>

      <dl className={styles.facts}>
        {/* Counted from the first finished week since the member joined; none yet in their first week. */}
        {consistency.weeks > 0 ? (
          <div>
            <dt>Weeks trained</dt>
            <dd>{consistency.trainedWeeks}<small>of {consistency.weeks}</small></dd>
          </div>
        ) : null}
        {consistency.weeks > 0 && consistency.plan !== null && consistency.planWeeks !== null ? (
          <div>
            <dt>Hit your {consistency.plan} a week</dt>
            <dd>{consistency.planWeeks}<small>{consistency.planWeeks === 1 ? "week" : "weeks"}</small></dd>
          </div>
        ) : null}
        <div>
          <dt>All time</dt>
          <dd>{totals ? number(totals.workouts) : "—"}<small>workouts</small></dd>
        </div>
      </dl>

      <div className={styles.chart}>
        <p className={styles.chartLabel}>Workouts a week</p>
        <BarSeries data={bars(weeks, (week) => week.workouts)} label={`Workouts a week, last ${weeks.length} weeks`} format={(value) => number(value)} showValues={weeks.length <= 8} maxLabels={weeks.length} emptyText="No workouts yet" height={104} />
      </div>
      {anyTraining ? (
        <div className={styles.chart}>
          <p className={styles.chartLabel}>Volume a week (kg)</p>
          {/* A week with no weighted sets lifted 0 kg: a real zero here, unlike an unknown value. */}
          <BarSeries data={bars(weeks, (week) => week.volumeKg ?? 0)} label={`Volume a week in kilograms, last ${weeks.length} weeks`} format={(value) => `${number(value)} kg`} maxLabels={weeks.length} emptyText="Nothing lifted yet" height={88} />
        </div>
      ) : null}

      <div className={styles.divider} aria-hidden="true" />

      <div className="grid gap-1">
        <h3 className={styles.chartLabel}>Recent workouts</h3>
        {recentError ? (
          <p role="alert" className="fitx-alert fitx-alert-danger">{recentError}</p>
        ) : !recent ? (
          <div className={styles.loading} aria-busy="true" aria-label="Loading your recent workouts" />
        ) : recent.length ? (
          <>
            <ul className={styles.recentList}>
              {recent.slice(0, 3).map((workout) => (
                <li key={workout.id}>
                  <Link href={`/workouts/history/${workout.id}`} className={styles.recentRow}>
                    <span className={styles.recentText}>
                      <strong>{workout.name}</strong>
                      <span>{dateLabel(workout.startedAt)}{workout.trainingSeconds !== null ? ` · ${workout.trainingSeconds < 60 ? "under 1 min" : formatDurationWords(workout.trainingSeconds)}` : ""}</span>
                    </span>
                    <span className={styles.recentVolume}>{workout.volumeKg === null ? <span aria-label="No weighted sets">—</span> : `${number(workout.volumeKg)} kg`}</span>
                    <ChevronRight size={16} aria-hidden="true" className={styles.muted} />
                  </Link>
                </li>
              ))}
            </ul>
            <Link href="/workouts/history" className={styles.textLink}>All workouts<ArrowRight size={14} aria-hidden="true" /></Link>
          </>
        ) : (
          <div className={styles.empty}>
            <strong>No finished workouts yet</strong>
            <Link href="/workouts" className="fitx-button fitx-button-secondary">Start a workout</Link>
          </div>
        )}
      </div>
    </section>
  );
}
