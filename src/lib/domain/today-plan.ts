/**
 * "What should I do today?": the one thing Home leads with, from what is real right now. Pure; the data comes
 * from src/lib/data/today-plan.ts and the Home summary.
 *
 * In order:
 *  1. a workout in progress (resume it), then an activity recording left unfinished on this device;
 *  2. today's planned workout that is not done yet (a planner item or a programme day), linking to its plan;
 *  3. done for today, when a workout was finished today and nothing planned is left;
 *  4. a programme rest day, shown as recovery, with the next programme day;
 *  5. a programme day today that was never planned (the programme's week is not planned yet): plan the week;
 *  6. no programme and nothing today: the next planned workout this week, or a nudge to plan the week.
 */
import { addDays, mondayOf, weekKeys, weekdayIndex } from "./day-keys";
import { localDateKey } from "./dates";
import type { RegionKey } from "@/lib/training/anatomy";

export type PlanWorkout = {
  /** workout_plans.id; null for a planner item without a plan. */
  planId: string | null;
  /** The planner item (planner_events.id), when there is one. */
  eventId: string | null;
  /** The workout's name ("Push A"). */
  title: string;
  /** The planned time, when the item has one. */
  startsAt: string | null;
  done: boolean;
  /** Exercises in the plan; null when not known. */
  exercises: number | null;
  /** The plan's main muscles (its exercises' primary regions, most frequent first) and what they also work. */
  regions: RegionKey[];
  secondary: RegionKey[];
  /** The programme's short name for a programme day ("Push, Pull, Legs"), else null. */
  programme: string | null;
};

export type NextWorkout = {
  date: string;
  title: string;
  /** True when it is worked out from the programme's weekdays rather than planned. */
  projected: boolean;
};

export type ProgrammeToday = {
  /** The programme's short name. */
  title: string;
  /** Today is one of the member's training weekdays for the programme. */
  trainsToday: boolean;
  /** The next programme day after today. */
  next: NextWorkout | null;
};

export type TodayPlanInput = {
  today: string;
  inProgress: { id: string; name: string; startedAt: string; planId: string | null } | null;
  unfinishedActivity: { sport: string; startedAt: number } | null;
  /** Today's planned workouts, in the order of the day. */
  workouts: readonly PlanWorkout[];
  /** Completed workouts that started today. */
  finishedToday: number;
  programme: ProgrammeToday | null;
  /** The first workout planned after today within the next 7 days (outside the programme). */
  nextPlanned: NextWorkout | null;
};

export type TodayPlan =
  | { kind: "resume_workout"; session: NonNullable<TodayPlanInput["inProgress"]>; next: PlanWorkout | null }
  | { kind: "resume_activity"; activity: NonNullable<TodayPlanInput["unfinishedActivity"]>; next: PlanWorkout | null }
  | { kind: "workout"; workout: PlanWorkout; more: PlanWorkout[] }
  | { kind: "done"; finished: number; workouts: PlanWorkout[]; next: NextWorkout | null }
  | { kind: "rest_day"; programme: string; next: NextWorkout | null }
  | { kind: "plan_week"; programme: string | null }
  | { kind: "free_day"; next: NextWorkout };

function soonest(a: NextWorkout | null, b: NextWorkout | null): NextWorkout | null {
  if (!a) return b;
  if (!b) return a;
  return b.date < a.date ? b : a;
}

export function todayPlan(input: TodayPlanInput): TodayPlan {
  const open = input.workouts.filter((workout) => !workout.done);
  const done = input.workouts.filter((workout) => workout.done);
  if (input.inProgress) {
    const planId = input.inProgress.planId;
    return { kind: "resume_workout", session: input.inProgress, next: open.find((workout) => !planId || workout.planId !== planId) ?? null };
  }
  if (input.unfinishedActivity) return { kind: "resume_activity", activity: input.unfinishedActivity, next: open[0] ?? null };
  if (open.length) return { kind: "workout", workout: open[0], more: open.slice(1) };
  if (input.finishedToday > 0 || done.length) {
    return { kind: "done", finished: Math.max(input.finishedToday, done.length), workouts: done, next: soonest(input.programme?.next ?? null, input.nextPlanned) };
  }
  if (input.programme && !input.programme.trainsToday) return { kind: "rest_day", programme: input.programme.title, next: input.programme.next };
  if (input.programme) return { kind: "plan_week", programme: input.programme.title };
  if (input.nextPlanned) return { kind: "free_day", next: input.nextPlanned };
  return { kind: "plan_week", programme: null };
}

// ---------------------------------------------------------------- programme days

/** The weekday of a day key as programme_enrolments.weekdays stores it: 0 = Sunday … 6 = Saturday. */
export function sundayIndex(key: string): number {
  return (weekdayIndex(key) + 1) % 7;
}

export function trainsOn(weekdays: readonly number[], key: string): boolean {
  return weekdays.includes(sundayIndex(key));
}

/** The first day after `today` (within two weeks) on one of the weekdays, or null when there are none. */
export function nextTrainingDay(weekdays: readonly number[], today: string): string | null {
  for (let offset = 1; offset <= 14; offset += 1) {
    const day = addDays(today, offset);
    if (trainsOn(weekdays, day)) return day;
  }
  return null;
}

/**
 * The next programme day after today: the first one already planned, else the next training weekday with the
 * day the programme continues at (marked projected), else null.
 */
export function programmeNext(input: { today: string; weekdays: readonly number[]; planned: ReadonlyArray<{ date: string; title: string }>; nextDayTitle: string | null }): NextWorkout | null {
  const ahead = input.planned.filter((plan) => plan.date > input.today).sort((a, b) => a.date.localeCompare(b.date));
  if (ahead.length) return { date: ahead[0].date, title: ahead[0].title, projected: false };
  const day = nextTrainingDay(input.weekdays, input.today);
  if (!day || !input.nextDayTitle) return null;
  return { date: day, title: input.nextDayTitle, projected: true };
}

/** A programme plan's title without the programme's name: "Push A · Push, Pull, Legs" → "Push A". */
export function programmeDayTitle(planTitle: string): string {
  const [first] = planTitle.split(" · ");
  return (first || planTitle).trim();
}

/** "today", "tomorrow", "on Thursday" (within a week) or "on Thu 26 Nov". */
export function whenLabel(date: string, today: string): string {
  if (date === today) return "today";
  if (date === addDays(today, 1)) return "tomorrow";
  const names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [, month, day] = date.split("-").map(Number);
  if (date > today && date <= addDays(today, 6)) return `on ${names[weekdayIndex(date)]}`;
  return `on ${names[weekdayIndex(date)].slice(0, 3)} ${day} ${months[month - 1]}`;
}

// ---------------------------------------------------------------- this week

export type WeekActivityDay = { date: string; workouts: number; activities: number; isToday: boolean; isFuture: boolean };

export type WeekActivity = {
  days: WeekActivityDay[];
  workouts: number;
  /** Null when activities could not be read. */
  activities: number | null;
  distanceM: number | null;
  movingSeconds: number | null;
};

/**
 * Monday to Sunday: finished workouts per day (the Home summary's week) and recorded activities per day, with
 * the week's totals. Activities null means they could not be read: shown as unknown, never as none.
 */
export function weekActivity(
  today: string,
  workoutDays: ReadonlyArray<{ date: string; count: number }>,
  activities: ReadonlyArray<{ startedAt: string; distanceM: number; movingSeconds: number }> | null,
): WeekActivity {
  const monday = mondayOf(today);
  const keys = weekKeys(today);
  const workouts = new Map(workoutDays.map((day) => [day.date, day.count]));
  const perDay = new Map<string, number>();
  let distance = 0;
  let moving = 0;
  let count = 0;
  for (const activity of activities ?? []) {
    const time = Date.parse(activity.startedAt);
    if (!Number.isFinite(time)) continue;
    const day = localDateKey(new Date(time));
    if (day < monday || day > keys[6]) continue;
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
    count += 1;
    distance += Number(activity.distanceM) > 0 ? Number(activity.distanceM) : 0;
    moving += Number(activity.movingSeconds) > 0 ? Number(activity.movingSeconds) : 0;
  }
  return {
    days: keys.map((date) => ({ date, workouts: workouts.get(date) ?? 0, activities: perDay.get(date) ?? 0, isToday: date === today, isFuture: date > today })),
    workouts: keys.reduce((sum, date) => sum + (workouts.get(date) ?? 0), 0),
    activities: activities ? count : null,
    distanceM: activities ? Math.round(distance) : null,
    movingSeconds: activities ? Math.round(moving) : null,
  };
}
