/**
 * How saving a workout plan changes the planner events linked to it.
 *
 * Plans are reusable: finishing a workout completes one planner item (in the
 * database, fitx_complete_workout_event; without it, `plannerEventToComplete`)
 * and leaves the plan in the list. Completed and cancelled events are history,
 * so a later save never moves or reopens them.
 * Only the plan's upcoming ("scheduled") event follows the plan's date.
 *
 * No imports, so `node --test` can load this file directly.
 */

/**
 * A planner event linked to the plan, with its start as a local date key (YYYY-MM-DD); null for an
 * untimed To-Do item.
 */
export type LinkedPlannerEvent = { status: string; dateKey: string | null };

/**
 * The linked events a plan save may change, plus the history it must respect, for
 * `plannerScheduleChange`. To-Do workouts can link to a plan too (on any day, timed or not); they keep
 * their own day. Only the plan's own upcoming event follows the plan: the scheduled, timed event on the
 * day the plan was planned for before this save (`previousPlannedFor`, null for a new or undated plan).
 * Completed events all stay in: a day that is already done is not scheduled again.
 */
export function plannerEventsForPlan<T extends LinkedPlannerEvent>(events: readonly T[], previousPlannedFor: string | null): T[] {
  return events.filter((event) => event.status !== "scheduled" || (previousPlannedFor !== null && event.dateKey === previousPlannedFor));
}

export type PlannerScheduleChange =
  /** Nothing to change. */
  | "none"
  /** Move the plan's scheduled event(s) to the plan's date and time. */
  | "update-scheduled"
  /** Create a scheduled event for the plan's date and time. */
  | "insert"
  /** The plan no longer has a date: cancel its scheduled event(s). */
  | "cancel-scheduled";

export function plannerScheduleChange(events: readonly LinkedPlannerEvent[], plannedFor: string): PlannerScheduleChange {
  const hasScheduled = events.some((event) => event.status === "scheduled");
  if (!plannedFor) return hasScheduled ? "cancel-scheduled" : "none";
  // That day's workout is already done, for example when a plan is renamed after
  // finishing it today: re-saving must not schedule the same day again.
  if (events.some((event) => event.status === "completed" && event.dateKey === plannedFor)) return "none";
  return hasScheduled ? "update-scheduled" : "insert";
}

/** A planner event linked to the plan, with its start in epoch milliseconds. */
export type TimedPlannerEvent = { id: string; status: string; startsAt: number };

/**
 * The planner event a finished workout completes, or null for none. The browser's rule
 * for databases without fitx_complete_workout_event, which also covers untimed To-Do
 * items and the item a session was started from.
 *
 * - The plan's scheduled event on the session's day; with several that day, the
 *   one nearest to when the session started.
 * - Otherwise its most recent overdue scheduled event, so a workout done a day
 *   late still ticks off the day it was planned for.
 * - Never an event on a later day: a workout done early leaves that day planned.
 *
 * `day` is the session's local day as [start, end) in epoch milliseconds.
 */
export function plannerEventToComplete(events: readonly TimedPlannerEvent[], day: { start: number; end: number }, sessionStartedAt: number): string | null {
  const candidates = events.filter((event) => event.status === "scheduled" && Number.isFinite(event.startsAt) && event.startsAt < day.end);
  const sameDay = candidates.filter((event) => event.startsAt >= day.start);
  if (sameDay.length) {
    return sameDay.reduce((best, event) => Math.abs(event.startsAt - sessionStartedAt) < Math.abs(best.startsAt - sessionStartedAt) ? event : best).id;
  }
  if (!candidates.length) return null;
  return candidates.reduce((latest, event) => event.startsAt > latest.startsAt ? event : latest).id;
}
