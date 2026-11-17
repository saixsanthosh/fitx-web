"use client";

import type { ReactNode } from "react";
import { Activity, Dumbbell, Utensils } from "lucide-react";
import { BarSeries, type BarDatum } from "@/components/charts/BarSeries";
import { Sparkline } from "@/components/charts/Sparkline";
import { StatStrip, type Stat } from "@/components/training/StatStrip";
import { formatDurationWords } from "@/lib/activity/format";
import { keyToLocalDate } from "@/lib/domain/day-keys";
import type { PeriodNumbers, WeekSoFar, WeekTrend } from "@/lib/domain/trends";
import styles from "./Progress.module.css";

export type SourceState = "ok" | "unavailable" | "error";

const number = (value: number, digits = 0) => value.toLocaleString(undefined, { maximumFractionDigits: digits });
const km = (metres: number) => number(metres / 1000, 1);
const minutes = (seconds: number) => Math.round(seconds / 60);
const dayMonth = (key: string) => keyToLocalDate(key).toLocaleDateString(undefined, { day: "numeric", month: "short" });

/** The comparison's name: the section says it covers the same days of last week, so the stats stay short. */
function sameDays(week: WeekSoFar): string {
  return week.days === 1 ? "Last Monday" : "Last week";
}

const activityProblem = (state: SourceState) => (state === "unavailable" ? "Activity tracking isn't set up yet" : "Couldn't load activities");

/** "This week so far" against the same days of last week: counts compared fairly while the week runs. */
export function WeekBand({ week, activities, foodError }: { week: WeekSoFar; activities: SourceState; foodError: boolean }) {
  const now = week.current;
  const then = week.previous;
  const label = sameDays(week);
  const versus = (value: string | null) => `${label}: ${value ?? "—"}`;
  const activityKnown = activities === "ok" && now.distanceM !== null && now.movingSeconds !== null;
  const food = (current: PeriodNumbers["calories"], previous: PeriodNumbers["calories"], unit: string): Pick<Stat, "value" | "note"> => {
    if (foodError) return { value: null, note: "Couldn't load your food log" };
    const days = `${current.days} logged ${current.days === 1 ? "day" : "days"}`;
    const missing = current.missingEntries ? ` · ${current.missingEntries} ${current.missingEntries === 1 ? "food" : "foods"} without a value left out` : "";
    return {
      value: current.average === null ? null : number(current.average),
      note: current.average === null ? `No food logged with this value · ${versus(previous.average === null ? null : `${number(previous.average)} ${unit}`)}` : `${days}${missing} · ${versus(previous.average === null ? null : `${number(previous.average)} ${unit}`)}`,
    };
  };
  const stats: Stat[] = [
    { label: "Workouts", value: now.workouts, note: versus(String(then.workouts)) },
    { label: "Completed sets", value: now.sets, note: versus(String(then.sets)) },
    {
      label: "Volume",
      value: now.volumeKg === null ? null : number(now.volumeKg),
      unit: "kg",
      note: now.volumeKg === null ? `${now.sets ? "No weighted sets" : "Nothing lifted yet"} · ${versus(then.volumeKg === null ? null : `${number(then.volumeKg)} kg`)}` : versus(then.volumeKg === null ? null : `${number(then.volumeKg)} kg`),
    },
    {
      label: "Distance",
      value: activityKnown ? km(now.distanceM!) : null,
      unit: "km",
      note: activityKnown ? versus(then.distanceM === null ? null : `${km(then.distanceM)} km`) : activityProblem(activities),
    },
    {
      label: "Moving time",
      value: activityKnown ? formatDurationWords(now.movingSeconds!) : null,
      note: activityKnown ? versus(then.movingSeconds === null ? null : formatDurationWords(then.movingSeconds)) : activityProblem(activities),
    },
    { label: "Calories", unit: "kcal a day", ...food(now.calories, then.calories, "kcal") },
    { label: "Protein", unit: "g a day", ...food(now.protein, then.protein, "g") },
  ];
  return <StatStrip stats={stats} label="This week so far" />;
}

function Panel({ title, icon, description, children }: { title: string; icon: ReactNode; description?: ReactNode; children: ReactNode }) {
  return (
    <section className={`fitx-panel ${styles.chartPanel}`} aria-label={title}>
      <header className={styles.chartHeader}>
        <span className={styles.chartIcon} aria-hidden="true">{icon}</span>
        <div className="min-w-0">
          <h3 className={styles.chartTitle}>{title}</h3>
          {description ? <p className={styles.chartDescription}>{description}</p> : null}
        </div>
      </header>
      {children}
    </section>
  );
}

/**
 * One bar per week. The axis names a month under the first week that starts in it (a narrow column has room
 * for a month, not a date); the full date is in each bar's text summary.
 */
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

function Chart({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={styles.chart}>
      <p className={styles.chartLabel}>{title}</p>
      {children}
    </div>
  );
}

/** Twelve weeks of training, activity and food, each week Monday to Sunday (this week so far in a lighter bar). */
export function TrendCharts({ weeks, activities, foodError }: { weeks: readonly WeekTrend[]; activities: SourceState; foodError: boolean }) {
  const loggedDays = weeks.reduce((sum, week) => sum + week.loggedDays, 0);
  const days = weeks.reduce((sum, week) => sum + Math.round((keyToLocalDate(week.to).getTime() - keyToLocalDate(week.from).getTime()) / 86_400_000) + 1, 0);
  const missingProtein = weeks.reduce((sum, week) => sum + week.protein.missingEntries, 0);
  return (
    <div className={styles.chartGrid}>
      <Panel title="Training" icon={<Dumbbell size={16} />} description="Finished workouts and the sets you ticked. Volume is weight × reps of weighted lifts.">
        <Chart title="Workouts a week">
          <BarSeries data={bars(weeks, (week) => week.workouts)} label="Workouts a week, last 12 weeks" format={(value) => number(value)} showValues={weeks.length <= 8} maxLabels={weeks.length} emptyText="No workouts yet" />
        </Chart>
        <Chart title="Completed sets a week">
          <BarSeries data={bars(weeks, (week) => week.sets)} label="Completed sets a week, last 12 weeks" format={(value) => number(value)} maxLabels={weeks.length} emptyText="No sets yet" />
        </Chart>
        <Chart title="Volume a week (kg)">
          {/* A week with no weighted sets lifted 0 kg: a real zero here, unlike an unknown value. */}
          <BarSeries data={bars(weeks, (week) => week.volumeKg ?? 0)} label="Volume a week in kilograms, last 12 weeks" format={(value) => `${number(value)} kg`} maxLabels={weeks.length} emptyText="Nothing lifted yet" />
        </Chart>
      </Panel>
      <Panel title="Activity" icon={<Activity size={16} />} description="Walks, runs and rides you recorded, by the week they started.">
        {activities === "ok" ? (
          <>
            <Chart title="Distance a week (km)">
              <BarSeries data={bars(weeks, (week) => (week.distanceM === null ? null : week.distanceM / 1000))} label="Distance a week in kilometres, last 12 weeks" format={(value) => `${number(value, 1)} km`} maxLabels={weeks.length} emptyText="No activities yet" />
            </Chart>
            <Chart title="Moving time a week (min)">
              <BarSeries data={bars(weeks, (week) => (week.movingSeconds === null ? null : minutes(week.movingSeconds)))} label="Moving time a week in minutes, last 12 weeks" format={(value) => `${number(value)} min`} maxLabels={weeks.length} emptyText="No activities yet" />
            </Chart>
          </>
        ) : (
          <p className={styles.chartProblem}>{activities === "unavailable" ? "Activity tracking isn't set up on this database yet, so there's nothing to chart." : "Your activities couldn't be loaded. Try again in a moment."}</p>
        )}
      </Panel>
      <Panel
        title="Food"
        icon={<Utensils size={16} />}
        description={foodError ? undefined : `Averages per logged day; days with nothing logged are left out. You logged food on ${loggedDays} of the last ${days} days.`}
      >
        {foodError ? (
          <p className={styles.chartProblem}>Your food log couldn&apos;t be loaded. Try again in a moment.</p>
        ) : (
          <>
            <Chart title="Calories a logged day">
              <Sparkline values={weeks.map((week) => week.calories.average)} label="Average calories a logged day, by week" format={(value) => `${number(value)} kcal`} startLabel={dayMonth(weeks[0].weekStart)} endLabel="This week" showRange emptyText="No food logged yet" />
            </Chart>
            <Chart title="Protein a logged day">
              <Sparkline values={weeks.map((week) => week.protein.average)} label="Average protein a logged day, by week" format={(value) => `${number(value)} g`} startLabel={dayMonth(weeks[0].weekStart)} endLabel="This week" showRange emptyText="No protein values logged yet" />
            </Chart>
            {missingProtein > 0 && <p className={styles.chartNote}>{missingProtein} {missingProtein === 1 ? "food has" : "foods have"} no protein value and {missingProtein === 1 ? "is" : "are"} left out of the protein averages.</p>}
          </>
        )}
      </Panel>
    </div>
  );
}
