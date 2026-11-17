/**
 * A followed programme as a journey of dated days: what was done, what is today, what comes next, and the rest
 * days in between. Pure, with type-only imports, so the programme card, the journey page and node tests share it.
 *
 * Sources, never guessed:
 *  - Training days are the enrolment's weekdays from the day it started (`started_on`); every other day is a rest
 *    day, an intended part of the programme. A rest day is never "missed".
 *  - A dated programme day is a plan linked to the enrolment (workout_plans.programme_enrolment_id and
 *    programme_day_index). It is done only when a session of it was completed (`last_done_key`, from completed
 *    workout_sessions), whatever its date. A past day that was not done is "missed", shown neutrally.
 *  - Days after the last planned one continue the programme's cycle (the scheduling rule) and are "projected":
 *    not planned yet, with no exercises chosen.
 *  - A programme with a length (src/data/programmes/meta.ts) has a target number of sessions: the training
 *    weekdays in its first `lengthDays` days. Progress counts completed sessions, so a missed day extends the plan
 *    instead of counting as done.
 * Dates are local calendar keys (YYYY-MM-DD) and weeks start on Monday, as elsewhere in FITX (src/lib/domain/dates.ts).
 */
import type { Enrolment, ProgrammePlan } from "./enrolment";

export type CalendarState =
  /** A session of the day's plan was completed. */
  | "done"
  /** Today's planned day, not done yet. */
  | "today"
  /** A planned day after today. */
  | "planned"
  /** A planned day before today that was not done. Shown neutrally; it never counts against the member. */
  | "missed"
  /** A training weekday with no plan (none was made for it, or it was removed). */
  | "unplanned"
  /** A training weekday after the planned days: the cycle continues there, not planned yet. */
  | "projected"
  /** A training weekday while the programme is paused. */
  | "paused"
  /** A day off between training days: planned recovery. */
  | "rest"
  /** Before the member started the programme. */
  | "before_start"
  /** After the programme's last session (programmes with a length only). */
  | "after_end";

export type CalendarDay = {
  date: string;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  isToday: boolean;
  /** "training": a programme day falls on it; "rest": a planned rest day; "outside": before the start or after the end. */
  kind: "training" | "rest" | "outside";
  state: CalendarState;
  /** The programme day (0-based) planned or projected for it. */
  dayIndex: number | null;
  /** The programme day's title ("Push"), else the plan's own title. */
  title: string | null;
  /** The programme day's muscle groups. */
  focus: readonly string[];
  /** The dated plan, when there is one. */
  planId: string | null;
  /** Local day its session was completed. */
  doneOn: string | null;
};

export type CalendarEnrolment = Pick<Enrolment, "weekdays" | "started_on" | "next_day_index" | "sessions_completed" | "status">;
export type CalendarProgrammeDay = { key: string; title: string; focus: readonly string[] };
export type CalendarPlan = Pick<ProgrammePlan, "id" | "title" | "planned_for" | "programme_day_index" | "last_done_key">;

// ---------------------------------------------------------------- date keys

const KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a YYYY-MM-DD key. */
export function isDayKey(value: unknown): value is string {
  return typeof value === "string" && KEY.test(value);
}

function parts(key: string): [number, number, number] {
  const match = KEY.exec(key);
  if (!match) throw new RangeError(`not a date key: ${key}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function keyOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** The key `days` days after `key` (negative: before), on the calendar, whatever the clock changes. */
export function addDays(key: string, days: number): string {
  const [year, month, day] = parts(key);
  return keyOf(new Date(year, month - 1, day + days));
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(key: string): number {
  const [year, month, day] = parts(key);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  const [y1, m1, d1] = parts(from);
  const [y2, m2, d2] = parts(to);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

/** The Monday of the week holding `key`. */
export function mondayOf(key: string): string {
  return addDays(key, -((weekdayOf(key) + 6) % 7));
}

function trainingWeekdays(weekdays: readonly number[]): Set<number> {
  return new Set(weekdays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6));
}

// ---------------------------------------------------------------- length, sessions and the scheduling rule

/**
 * Sessions in a programme with a length: the training weekdays among its first `lengthDays` days from the start.
 * Null for an ongoing programme (no length).
 */
export function targetSessions(startedOn: string, weekdays: readonly number[], lengthDays: number | null | undefined): number | null {
  if (!lengthDays || lengthDays <= 0 || !isDayKey(startedOn)) return null;
  const days = trainingWeekdays(weekdays);
  if (!days.size) return null;
  let count = 0;
  for (let offset = 0; offset < Math.round(lengthDays); offset++) if (days.has(weekdayOf(addDays(startedOn, offset)))) count++;
  return count;
}

const isDone = (plan: Pick<CalendarPlan, "last_done_key">) => Boolean(plan.last_done_key);

/** Planned days from today on that are not done yet. */
export function upcomingPlans<T extends Pick<CalendarPlan, "planned_for" | "last_done_key">>(plans: readonly T[], todayKey: string): T[] {
  return plans.filter((plan) => Boolean(plan.planned_for && plan.planned_for >= todayKey) && !isDone(plan));
}

/**
 * Sessions still to plan in a programme with a length: the target, less those completed and those already planned
 * ahead. Null for an ongoing programme. Missed days are not counted, so they extend the plan.
 */
export function sessionsLeftToPlan(input: { target: number | null; sessionsCompleted: number; plans: readonly CalendarPlan[]; todayKey: string }): number | null {
  if (input.target === null) return null;
  return Math.max(0, input.target - Math.max(0, input.sessionsCompleted) - upcomingPlans(input.plans, input.todayKey).length);
}

/**
 * Where the programme continues after the days already planned: the day after the last plan dated today or later,
 * at the programme day after it; with nothing ahead, today at the enrolment's next day. The rule every scheduling
 * run uses, so the projection shows exactly what planning would create.
 */
export function continuationStart(plans: readonly Pick<CalendarPlan, "planned_for" | "programme_day_index">[], nextDayIndex: number, todayKey: string, dayCount: number): { fromKey: string; startDay: number } {
  const ahead = plans.filter((plan) => plan.planned_for && plan.planned_for >= todayKey);
  if (!ahead.length || dayCount <= 0) return { fromKey: todayKey, startDay: dayCount > 0 ? ((nextDayIndex % dayCount) + dayCount) % dayCount : 0 };
  const last = ahead.reduce((latest, plan) => (plan.planned_for! > latest.planned_for! ? plan : latest));
  return { fromKey: addDays(last.planned_for!, 1), startDay: ((last.programme_day_index ?? -1) + 1) % dayCount };
}

export type PlanningWindow = {
  fromKey: string;
  startDay: number;
  /** Days from `fromKey` to the end of the horizon, inclusive. */
  horizonDays: number;
  /** At most this many days to create (the sessions left in a programme with a length); null for no limit. */
  maxDays: number | null;
};

/**
 * The days a scheduling run should plan so that the next `horizonDays` days (today included) stay planned, or null
 * when they already are: the continuation start (never before today) to the end of the horizon. Null too when no
 * training weekday falls in that span, the programme is paused, or a programme with a length has nothing left to
 * plan. Running it again after it planned returns null, so it is safe to call on every visit.
 */
export function planningWindow(input: {
  plans: readonly CalendarPlan[];
  enrolment: Pick<CalendarEnrolment, "weekdays" | "next_day_index" | "status">;
  todayKey: string;
  dayCount: number;
  horizonDays?: number;
  /** sessionsLeftToPlan for a programme with a length; null or undefined for an ongoing one. */
  sessionsLeft?: number | null;
}): PlanningWindow | null {
  if (input.enrolment.status !== "active" || input.dayCount <= 0) return null;
  if (input.sessionsLeft != null && input.sessionsLeft <= 0) return null;
  const weekdays = trainingWeekdays(input.enrolment.weekdays);
  if (!weekdays.size) return null;
  const horizon = Math.max(1, Math.round(input.horizonDays ?? 7));
  const endKey = addDays(input.todayKey, horizon - 1);
  const start = continuationStart(input.plans, input.enrolment.next_day_index, input.todayKey, input.dayCount);
  const fromKey = start.fromKey < input.todayKey ? input.todayKey : start.fromKey;
  if (fromKey > endKey) return null;
  const span = daysBetween(fromKey, endKey) + 1;
  let training = 0;
  for (let offset = 0; offset < span; offset++) if (weekdays.has(weekdayOf(addDays(fromKey, offset)))) training++;
  if (!training) return null;
  return { fromKey, startDay: start.startDay, horizonDays: span, maxDays: input.sessionsLeft ?? null };
}

// ---------------------------------------------------------------- the calendar

export type CalendarInput = {
  enrolment: CalendarEnrolment;
  programme: { days: readonly CalendarProgrammeDay[] };
  /** The enrolment's dated plans (any order); those outside the range are used for the projection only. */
  plans: readonly CalendarPlan[];
  todayKey: string;
  fromKey: string;
  toKey: string;
  /** The programme's target sessions (targetSessions); null or undefined for an ongoing programme. */
  target?: number | null;
};

/** The plan to show for a date: one that was done first, else the first by id (two plans on one date are rare). */
function plansByDate(plans: readonly CalendarPlan[]): Map<string, CalendarPlan> {
  const byDate = new Map<string, CalendarPlan>();
  for (const plan of plans) {
    if (!plan.planned_for || !isDayKey(plan.planned_for)) continue;
    const current = byDate.get(plan.planned_for);
    if (!current || (isDone(plan) && !isDone(current)) || (isDone(plan) === isDone(current) && plan.id < current.id)) byDate.set(plan.planned_for, plan);
  }
  return byDate;
}

/** One entry per date from `fromKey` to `toKey` (at most 400 days), in order. */
export function programmeCalendar(input: CalendarInput): CalendarDay[] {
  const { enrolment, programme, todayKey } = input;
  const dayCount = programme.days.length;
  const weekdays = trainingWeekdays(enrolment.weekdays);
  const byDate = plansByDate(input.plans);
  const target = input.target ?? null;
  const paused = enrolment.status === "paused";
  const start = continuationStart(input.plans, enrolment.next_day_index, todayKey, dayCount);
  const projectFrom = start.fromKey < todayKey ? todayKey : start.fromKey;
  let projectIndex = start.startDay;
  let projectionsLeft = sessionsLeftToPlan({ target, sessionsCompleted: enrolment.sessions_completed, plans: input.plans, todayKey }) ?? Number.POSITIVE_INFINITY;
  const lastPlanned = [...byDate.keys()].sort().pop() ?? null;
  // With a length, the programme ends after its last session: its last plan when nothing is left to plan (before
  // today when that plan is not in the list given), else the last projected day (set in the loop).
  let endKey: string | null = target !== null && projectionsLeft === 0 ? lastPlanned ?? addDays(todayKey, -1) : null;
  const days: CalendarDay[] = [];
  const span = Math.min(400, daysBetween(input.fromKey, input.toKey) + 1);
  for (let offset = 0; offset < span; offset++) {
    const date = addDays(input.fromKey, offset);
    const weekday = weekdayOf(date);
    const base = { date, weekday, isToday: date === todayKey, dayIndex: null, title: null, focus: [] as readonly string[], planId: null, doneOn: null };
    const plan = byDate.get(date);
    if (plan) {
      const index = plan.programme_day_index;
      const day = index !== null && index >= 0 && index < dayCount ? programme.days[index] : undefined;
      const state: CalendarState = isDone(plan) ? "done" : date < todayKey ? "missed" : date === todayKey ? "today" : "planned";
      days.push({ ...base, kind: "training", state, dayIndex: index, title: day?.title ?? plan.title, focus: day?.focus ?? [], planId: plan.id, doneOn: plan.last_done_key });
      continue;
    }
    if (isDayKey(enrolment.started_on) && date < enrolment.started_on) { days.push({ ...base, kind: "outside", state: "before_start" }); continue; }
    if (endKey !== null && date > endKey) { days.push({ ...base, kind: "outside", state: "after_end" }); continue; }
    if (!weekdays.has(weekday)) { days.push({ ...base, kind: "rest", state: "rest" }); continue; }
    if (date < todayKey) { days.push({ ...base, kind: "training", state: "unplanned" }); continue; }
    if (paused) { days.push({ ...base, kind: "training", state: "paused" }); continue; }
    if (date < projectFrom || dayCount <= 0) { days.push({ ...base, kind: "training", state: "unplanned" }); continue; }
    const day = programme.days[projectIndex];
    days.push({ ...base, kind: "training", state: "projected", dayIndex: projectIndex, title: day?.title ?? null, focus: day?.focus ?? [] });
    projectIndex = (projectIndex + 1) % dayCount;
    projectionsLeft -= 1;
    if (target !== null && projectionsLeft <= 0) endKey = date;
  }
  return days;
}

/** The range a programme card shows: a week back (not before the start) to a week ahead. */
export function stripRange(todayKey: string, startedOn: string, back = 6, ahead = 7): { fromKey: string; toKey: string } {
  const earliest = addDays(todayKey, -back);
  const fromKey = isDayKey(startedOn) && startedOn > earliest ? (startedOn > todayKey ? todayKey : startedOn) : earliest;
  return { fromKey, toKey: addDays(todayKey, ahead) };
}

export type CalendarWeek = { weekStart: string; days: CalendarDay[] };

/** Days grouped into Monday-to-Sunday weeks, in order. Weeks are as complete as the days given. */
export function groupByWeek(days: readonly CalendarDay[]): CalendarWeek[] {
  const weeks: CalendarWeek[] = [];
  for (const day of days) {
    const weekStart = mondayOf(day.date);
    const last = weeks[weeks.length - 1];
    if (last && last.weekStart === weekStart) last.days.push(day);
    else weeks.push({ weekStart, days: [day] });
  }
  return weeks;
}

// ---------------------------------------------------------------- the summary a card or page shows

export type WeekSummary = {
  /** Training days this week (Monday to Sunday) inside the programme: done, missed, planned or projected. */
  training: number;
  done: number;
  /** Rest days this week inside the programme. */
  rest: number;
};

export type ProgrammeStatus = {
  /** Days in the programme's cycle. */
  cycleLength: number;
  /** The programme day the member does next (0-based), from the enrolment. */
  nextDayIndex: number;
  nextTitle: string | null;
  /** Completed programme sessions (counted by the finish function). */
  sessionsCompleted: number;
  /** Null for an ongoing programme. */
  target: number | null;
  /** Every session of a programme with a length is done. */
  complete: boolean;
  week: WeekSummary;
  /** Today's entry, when today is in the days given. */
  today: CalendarDay | null;
  /** The first training day after today that is planned or projected. */
  nextTraining: CalendarDay | null;
};

/** The figures behind a programme's heading, from its calendar (which should cover this week and what follows). */
export function programmeStatus(input: { enrolment: CalendarEnrolment; programme: { days: readonly CalendarProgrammeDay[] }; days: readonly CalendarDay[]; todayKey: string; target?: number | null }): ProgrammeStatus {
  const cycleLength = input.programme.days.length;
  const nextDayIndex = cycleLength ? ((input.enrolment.next_day_index % cycleLength) + cycleLength) % cycleLength : 0;
  const weekStart = mondayOf(input.todayKey);
  const weekEnd = addDays(weekStart, 6);
  const thisWeek = input.days.filter((day) => day.date >= weekStart && day.date <= weekEnd);
  const target = input.target ?? null;
  const completed = Math.max(0, input.enrolment.sessions_completed);
  return {
    cycleLength,
    nextDayIndex,
    nextTitle: input.programme.days[nextDayIndex]?.title ?? null,
    sessionsCompleted: completed,
    target,
    complete: target !== null && completed >= target,
    week: {
      training: thisWeek.filter((day) => day.kind === "training").length,
      done: thisWeek.filter((day) => day.state === "done").length,
      rest: thisWeek.filter((day) => day.kind === "rest").length,
    },
    today: input.days.find((day) => day.date === input.todayKey) ?? null,
    nextTraining: input.days.find((day) => day.date > input.todayKey && (day.state === "planned" || day.state === "projected")) ?? null,
  };
}

const STATE_WORDS: Record<CalendarState, string> = {
  done: "done", today: "today", planned: "planned", missed: "not done", unplanned: "no workout planned", projected: "not planned yet",
  paused: "programme paused", rest: "rest day", before_start: "before you started", after_end: "after the plan ended",
};

/** A short word for a day's state, for labels: "done", "rest day", "not planned yet". */
export function stateWord(state: CalendarState): string {
  return STATE_WORDS[state];
}
