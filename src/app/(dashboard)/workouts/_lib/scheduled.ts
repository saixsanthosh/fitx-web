/**
 * The member's upcoming scheduled workouts (planner_events of type 'workout', still 'scheduled', from today on).
 * The To-Do list and its week planner are gone (owner's phase 6), so workouts a member scheduled there, or from the
 * builder with a time, are listed on Workouts instead: each with its day and time, and today's with a Start link
 * that keeps the planner item on the session (start-link.ts). Pure except for `fetchUpcomingScheduled`.
 */
import { workoutStartHref } from "@/lib/training/start-link";

export type ScheduledRow = { id: string; title: string; local_date: string; starts_at: string | null; workout_plan_id: string | null };

export type ScheduledItem = {
  id: string;
  title: string;
  /** The local day key (YYYY-MM-DD). */
  day: string;
  /** Set only for today's items that have a plan: /workouts?plan=<plan>&event=<item>. */
  startHref: string | null;
  planId: string | null;
  startsAt: string | null;
};

/** How many scheduled workouts Workouts shows (compact: the soonest few). */
export const SCHEDULED_LIMIT = 5;

export const SCHEDULED_COLUMNS = "id,title,local_date,starts_at,workout_plan_id";

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Rows from today on, soonest first (by day, then start time; an untimed item after the timed ones that day). */
export function scheduledItems(rows: readonly ScheduledRow[], todayKey: string, limit = SCHEDULED_LIMIT): ScheduledItem[] {
  return rows
    .filter((row) => typeof row.id === "string" && DAY_KEY.test(row.local_date) && row.local_date >= todayKey)
    .slice()
    .sort((a, b) => a.local_date.localeCompare(b.local_date) || startOrder(a.starts_at) - startOrder(b.starts_at))
    .slice(0, limit)
    .map((row) => ({
      id: row.id,
      title: row.title?.trim() || "Workout",
      day: row.local_date,
      startHref: row.local_date === todayKey && row.workout_plan_id ? workoutStartHref(row.workout_plan_id, row.id) : null,
      planId: row.workout_plan_id,
      startsAt: row.starts_at,
    }));
}

function startOrder(startsAt: string | null): number {
  const time = startsAt ? Date.parse(startsAt) : NaN;
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
}

type PlannerQuery = {
  from(table: "planner_events"): {
    select(columns: string): {
      eq(column: string, value: string): unknown;
    };
  };
};

/**
 * Reads the upcoming scheduled workouts. Any error (an older database, a network fault) gives an empty list: the
 * list is extra, so the page shows nothing rather than a broken block.
 */
export async function fetchUpcomingScheduled(supabase: unknown, userId: string, todayKey: string): Promise<ScheduledItem[]> {
  type Chain = {
    eq(column: string, value: string): Chain;
    gte(column: string, value: string): Chain;
    order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): Chain;
    limit(count: number): PromiseLike<{ data: unknown; error: unknown }>;
  };
  try {
    const query = (supabase as PlannerQuery).from("planner_events").select(SCHEDULED_COLUMNS) as unknown as Chain;
    const result = await query.eq("user_id", userId).eq("event_type", "workout").eq("status", "scheduled").gte("local_date", todayKey)
      .order("local_date", { ascending: true }).order("starts_at", { ascending: true, nullsFirst: false }).limit(SCHEDULED_LIMIT);
    if (result.error || !Array.isArray(result.data)) return [];
    return scheduledItems(result.data as ScheduledRow[], todayKey);
  } catch {
    return [];
  }
}
