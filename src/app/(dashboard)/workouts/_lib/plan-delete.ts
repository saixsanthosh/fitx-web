/**
 * Deleting one of the member's plans (bug 48, Also seen; review round, workouts-r6). planner_events.workout_plan_id is
 * ON DELETE SET NULL, so the item FITX scheduled for the plan's date used to stay under Scheduled with no plan. The
 * item is found first (once the plan is gone it can no longer be found by the plan), the plan is deleted, and only then
 * is the item cancelled: a delete that fails leaves the plan and its item exactly as they were. A To-Do item the member
 * linked to the plan stays, unlinked (ownProgrammeItems, the rule leaving a programme uses).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { columnList, isMissingTableError, withOptionalColumns } from "@/lib/domain/schema-fallback";
import { ownProgrammeItems } from "@/lib/training/enrolment";
import { PLANNER_DAY_COLUMNS } from "./workout-columns";

export type PlanDeleteOutcome =
  /** Nothing changed: the plan and its item are as they were. */
  | { status: "failed"; error: unknown }
  /** The plan is gone, and its scheduled item with it (or it had none). */
  | { status: "deleted" }
  /** The plan is gone, but its scheduled item could not be cancelled: it shows under Scheduled until its day. */
  | { status: "deleted-item-left" };

type LinkedItem = Parameters<typeof ownProgrammeItems>[0][number];

export async function deletePlanAndItsItem(db: Pick<SupabaseClient, "from">, userId: string, plan: { id: string; planned_for: string | null }): Promise<PlanDeleteOutcome> {
  let own: string[] = [];
  if (plan.planned_for) {
    const linked = await withOptionalColumns(PLANNER_DAY_COLUMNS, (include) =>
      db.from("planner_events").select(columnList(["id", "workout_plan_id", "starts_at"], PLANNER_DAY_COLUMNS, include))
        .eq("user_id", userId).eq("event_type", "workout").eq("status", "scheduled").eq("workout_plan_id", plan.id));
    // Unread, the item could not be cancelled afterwards: nothing is deleted. A database without the planner has none.
    if (linked.result.error && !isMissingTableError(linked.result.error)) return { status: "failed", error: linked.result.error };
    if (!linked.result.error) own = ownProgrammeItems((linked.result.data ?? []) as unknown as LinkedItem[], [{ id: plan.id, planned_for: plan.planned_for }]);
  }
  const removed = await db.from("workout_plans").delete().eq("id", plan.id).eq("user_id", userId);
  if (removed.error) return { status: "failed", error: removed.error };
  if (!own.length) return { status: "deleted" };
  // The ids still name the items after the plan's removal unlinked them.
  const cancel = () => db.from("planner_events").update({ status: "cancelled" }).eq("user_id", userId).eq("status", "scheduled").in("id", own);
  const cancelled = await cancel();
  if (!cancelled.error) return { status: "deleted" };
  // Once more, for a request lost on the way: the plan is already gone, so this is the only chance to tidy its item.
  return (await cancel()).error ? { status: "deleted-item-left" } : { status: "deleted" };
}

/** The plan went but its entry under Scheduled stayed (it is listed until its day is over). */
export function itemLeftMessage(title: string): string {
  return `Deleted “${title}”. Its entry under Scheduled couldn’t be removed, so it stays there until its day is over.`;
}
