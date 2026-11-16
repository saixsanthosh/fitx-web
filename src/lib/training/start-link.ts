/**
 * Start links from planner items. A To-Do, the week view and Home link to /workouts?plan=<plan>&event=<item>;
 * starting that plan on the Workouts page then keeps the item on the session (fitx_start_workout_session),
 * so finishing the workout ticks off that item rather than another of the plan's items
 * (fitx_complete_workout_event).
 *
 * No imports, so `node --test` can load this file directly.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The Workouts page link for a planner item's Start button. An item not saved yet (no id) links the plan only. */
export function workoutStartHref(planId: string, plannerEventId?: string | null): string {
  const params = new URLSearchParams({ plan: planId });
  if (plannerEventId && UUID.test(plannerEventId)) params.set("event", plannerEventId);
  return `/workouts?${params.toString()}`;
}

export type StartLink = { planId: string; plannerEventId: string };

/** The plan and planner item a Start link names (a page's `location.search`), or null when it names no item. */
export function startLinkFrom(search: string): StartLink | null {
  const params = new URLSearchParams(search);
  const planId = params.get("plan");
  const plannerEventId = params.get("event");
  if (!planId || !plannerEventId || !UUID.test(planId) || !UUID.test(plannerEventId)) return null;
  return { planId, plannerEventId };
}

/** The planner item to keep on a session started from `planId`: the link's item when the link is for that plan. */
export function plannerEventForStart(link: StartLink | null, planId: string): string | null {
  return link && link.planId === planId ? link.plannerEventId : null;
}
