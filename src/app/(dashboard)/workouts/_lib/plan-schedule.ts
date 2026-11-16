/**
 * How saving a workout plan changes the planner events linked to it.
 *
 * Plans are reusable: finishing a workout completes that day's planner event and
 * leaves the plan in the list. Completed and cancelled events are history, so a
 * later save never moves or reopens them. Only the plan's upcoming ("scheduled")
 * event follows the plan's date.
 *
 * No imports, so `node --test` can load this file directly.
 */

/** A planner event linked to the plan, with its start as a local date key (YYYY-MM-DD). */
export type LinkedPlannerEvent = { status: string; dateKey: string };

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
