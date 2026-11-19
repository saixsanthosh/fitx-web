"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, BedDouble, CalendarCheck2, CalendarPlus, CircleCheck, Dumbbell, Footprints, Play, Repeat } from "lucide-react";
import { BodyMap } from "@/components/anatomy/BodyMap";
import { clockTime } from "@/components/tasks/format";
import type { ActivitiesResult } from "@/lib/data/activities";
import type { SummaryResult } from "@/lib/data/today";
import type { TodayPlanData } from "@/lib/data/today-plan";
import { keyToLocalDate } from "@/lib/domain/day-keys";
import { todayPlan, weekActivity, whenLabel, type NextWorkout, type PlanWorkout, type TodayPlan } from "@/lib/domain/today-plan";
import { formatDistance, formatDurationWords } from "@/lib/activity/format";
import { listRegions } from "@/lib/training/anatomy";
import { workoutStartHref } from "@/lib/training/start-link";
import { homePanel } from "@/config/routes";
import type { Resource } from "./useHomeData";
import { WidgetCard, WidgetError, WidgetSkeleton } from "./WidgetCard";
import styles from "./Widgets.module.css";

const SPORT_NOUN: Record<string, string> = { walk: "walk", run: "run", ride: "ride" };
const capitalise = (text: string) => (text ? text[0].toUpperCase() + text.slice(1) : text);

/** "6 exercises · chest, shoulders and triceps". */
function planMeta(workout: PlanWorkout): string {
  const parts = [
    workout.exercises !== null ? `${workout.exercises} ${workout.exercises === 1 ? "exercise" : "exercises"}` : null,
    workout.regions.length ? listRegions(workout.regions.slice(0, 3)) : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

function nextLine(next: NextWorkout | null, today: string): string | null {
  if (!next) return null;
  return `Next: ${next.title} ${whenLabel(next.date, today)}${next.projected ? ", not planned yet" : ""}.`;
}

function previewHref(workout: PlanWorkout): string {
  return workout.planId ? workoutStartHref(workout.planId, workout.eventId) : homePanel("todo");
}

type Lead = { tone: "active" | "plan" | "done" | "rest" | "empty"; eyebrow: ReactNode; title: string; meta: ReactNode; actions: ReactNode; map?: PlanWorkout | null };

function lead(plan: TodayPlan, today: string): Lead {
  switch (plan.kind) {
    case "resume_workout":
      return {
        tone: "active",
        eyebrow: <><span className={styles.liveDot} aria-hidden="true" />In progress</>,
        title: plan.session.name,
        meta: <>Started {clockTime(plan.session.startedAt) ?? "earlier"}{plan.next ? <>. Then: {plan.next.title}</> : null}</>,
        actions: <Link href={`/workouts/active?session=${encodeURIComponent(plan.session.id)}`} className="fitx-button"><Play size={16} aria-hidden="true" />Resume workout</Link>,
      };
    case "resume_activity": {
      const noun = SPORT_NOUN[plan.activity.sport] ?? "activity";
      return {
        tone: "active",
        eyebrow: <><span className={styles.liveDot} aria-hidden="true" />Unfinished on this device</>,
        title: `Your ${noun}`,
        meta: <>Started {clockTime(new Date(plan.activity.startedAt).toISOString()) ?? "earlier"}. Resume it or finish it to save it.</>,
        actions: <Link href="/activity/record" className="fitx-button"><Footprints size={16} aria-hidden="true" />Open the recorder</Link>,
      };
    }
    case "workout": {
      const { workout } = plan;
      const time = clockTime(workout.startsAt);
      return {
        tone: "plan",
        eyebrow: workout.programme ? `${workout.programme} · today's programme day` : time ? `Planned for ${time}` : "Planned for today",
        title: workout.title,
        meta: <>{planMeta(workout) || "Your planned workout"}{plan.more.length ? <>. Also today: {plan.more.map((item) => item.title).join(", ")}</> : null}</>,
        actions: <Link href={previewHref(workout)} className="fitx-button">Preview workout<ArrowRight size={16} aria-hidden="true" /></Link>,
        map: workout,
      };
    }
    case "done":
      return {
        tone: "done",
        eyebrow: <><CircleCheck size={14} aria-hidden="true" />Done for today</>,
        title: plan.workouts.length ? plan.workouts.map((workout) => workout.title).join(", ") : `${plan.finished} ${plan.finished === 1 ? "workout" : "workouts"} finished`,
        meta: nextLine(plan.next, today) ?? "Nice work. Nothing else is planned this week.",
        actions: <Link href="/progress" className={styles.secondaryAction}>See your progress</Link>,
      };
    case "rest_day":
      return {
        tone: "rest",
        eyebrow: plan.programme,
        title: "Rest day",
        meta: <>Recovery is part of the programme. {nextLine(plan.next, today) ?? ""}</>,
        actions: plan.next?.projected ? <Link href="/workouts" className={styles.secondaryAction}><CalendarPlus size={15} aria-hidden="true" />Plan the week</Link> : null,
      };
    case "plan_week":
      return plan.programme
        ? {
          tone: "empty",
          eyebrow: plan.programme,
          title: "Plan this week",
          meta: "Today is one of your training days, but this week's programme days aren't planned yet.",
          actions: <Link href="/workouts" className="fitx-button"><CalendarPlus size={16} aria-hidden="true" />Plan the week</Link>,
        }
        : {
          tone: "empty",
          eyebrow: "Nothing planned",
          title: "Plan your week",
          meta: "No workouts are planned for the next 7 days. Pick days and workouts, or follow a programme.",
          actions: <>
            <Link href={homePanel("week")} className="fitx-button"><CalendarPlus size={16} aria-hidden="true" />Plan your week</Link>
            <Link href="/workouts" className={styles.secondaryAction}><Repeat size={15} aria-hidden="true" />Browse programmes</Link>
          </>,
        };
    case "free_day":
      return {
        tone: "rest",
        eyebrow: "Nothing planned today",
        title: "A free day",
        meta: nextLine(plan.next, today),
        actions: <>
          <Link href="/workouts" className={styles.secondaryAction}><Dumbbell size={15} aria-hidden="true" />Plan a workout</Link>
          <Link href="/activity/record" className={styles.secondaryAction}><Footprints size={15} aria-hidden="true" />Start an activity</Link>
        </>,
      };
  }
}

/**
 * Home's "Today's plan": what to do today (src/lib/domain/today-plan.ts) and this week's training and activity.
 */
export function TodayPlanWidget({ date, plan, summary, activities, unfinished }: {
  date: string;
  plan: Resource<TodayPlanData>;
  summary: Resource<SummaryResult>;
  activities: Resource<ActivitiesResult>;
  unfinished: { sport: string; startedAt: number } | null;
}) {
  let body: ReactNode;
  if (!plan.data) {
    body = plan.status === "error" ? <WidgetError message={plan.error} onRetry={plan.reload} /> : <WidgetSkeleton label="Loading today's plan" />;
  } else if (!summary.data && summary.status !== "error") {
    body = <WidgetSkeleton label="Loading today's plan" />;
  } else {
    const decision = todayPlan({ ...plan.data, today: date, unfinishedActivity: unfinished, finishedToday: summary.data?.summary.workouts.today ?? 0 });
    const shown = lead(decision, date);
    const Icon = shown.tone === "rest" ? BedDouble : shown.tone === "done" ? CircleCheck : CalendarCheck2;
    body = (
      <div className={styles.plan}>
        <div className={styles.planLead} data-tone={shown.tone}>
          <div className={styles.planText}>
            <p className={styles.planEyebrow}>{shown.eyebrow}</p>
            <p className={styles.planTitle}>{shown.title}</p>
            {shown.meta ? <p className={styles.planMeta}>{shown.meta}</p> : null}
            {shown.actions ? <div className={styles.planActions}>{shown.actions}</div> : null}
          </div>
          {shown.map && shown.map.regions.length ? (
            <div className={styles.planMap}>
              <BodyMap title={`Muscles in ${shown.map.title}: ${listRegions(shown.map.regions)}`} primary={shown.map.regions} secondary={shown.map.secondary} size="sm" />
            </div>
          ) : (
            <span className={styles.planIcon} aria-hidden="true"><Icon size={22} /></span>
          )}
        </div>
        {summary.data ? <WeekLine date={date} summary={summary.data} activities={activities} /> : null}
      </div>
    );
  }
  return (
    <WidgetCard title="Today's plan" icon={<CalendarCheck2 size={16} />} href="/workouts" hrefLabel="Open workouts">
      {body}
    </WidgetCard>
  );
}

function WeekLine({ date, summary, activities }: { date: string; summary: SummaryResult; activities: Resource<ActivitiesResult> }) {
  const known = activities.data?.available ? activities.data.activities : null;
  const week = weekActivity(date, summary.summary.workouts.weekDays, known);
  const parts = [
    `${week.workouts} ${week.workouts === 1 ? "workout" : "workouts"}`,
    week.activities === null ? null : `${week.activities} ${week.activities === 1 ? "activity" : "activities"}${week.activities ? `, ${formatDistance(week.distanceM ?? 0)}, ${formatDurationWords(week.movingSeconds ?? 0)} moving` : ""}`,
  ].filter(Boolean);
  return (
    <div className={styles.planWeek}>
      <p className={styles.planWeekTitle}>This week</p>
      <ol className={styles.planDays} aria-label="Workouts and activities by day this week">
        {week.days.map((day) => {
          const name = keyToLocalDate(day.date).toLocaleDateString(undefined, { weekday: "long" });
          const what = [day.workouts ? `${day.workouts} ${day.workouts === 1 ? "workout" : "workouts"}` : null, day.activities ? `${day.activities} ${day.activities === 1 ? "activity" : "activities"}` : null].filter(Boolean).join(" and ");
          return (
            <li key={day.date} className={styles.planDay} data-today={day.isToday ? "true" : undefined} aria-label={`${name}: ${what || (day.isFuture ? "ahead" : "nothing logged")}`}>
              <span className={styles.planDayName} aria-hidden="true">{name.slice(0, 2)}</span>
              <span className={styles.planDayMarks} aria-hidden="true">
                <span className={styles.markWorkout} data-on={day.workouts ? "true" : undefined} />
                <span className={styles.markActivity} data-on={day.activities ? "true" : undefined} />
              </span>
            </li>
          );
        })}
      </ol>
      <p className={styles.planWeekTotals}>
        {capitalise(parts.join(" · "))}
        {activities.status === "error" && !activities.data ? <> · activities couldn&apos;t be loaded</> : null}
      </p>
      <p className={styles.planLegend} aria-hidden="true">
        <span className={styles.markWorkout} data-on="true" />Workout
        {known ? <><span className={styles.markActivity} data-on="true" />Walk, run or ride</> : null}
      </p>
    </div>
  );
}
