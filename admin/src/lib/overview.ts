import "server-only";
import { createAdminSupabase } from "@/lib/supabase/admin";

export type OverviewMetrics = {
  registered_users: number;
  active_users_30d: number;
  completed_workouts_30d: number;
  active_exercises: number;
  food_logs_30d: number;
};

export type OverviewResult =
  | { state: "ready"; metrics: OverviewMetrics }
  | { state: "service_key_missing" | "migration_pending" | "query_failed" };

function count(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

export async function getOverviewMetrics(): Promise<OverviewResult> {
  const supabase = createAdminSupabase();
  if (!supabase) return { state: "service_key_missing" };

  const { data, error } = await supabase.rpc("fitx_admin_overview_metrics");
  if (error) {
    if (error.code === "42883" || error.code === "PGRST202") return { state: "migration_pending" };
    return { state: "query_failed" };
  }

  const result = data as Record<string, unknown> | null;
  const registered = count(result?.registered_users);
  const active = count(result?.active_users_30d);
  const workouts = count(result?.completed_workouts_30d);
  const exercises = count(result?.active_exercises);
  const meals = count(result?.food_logs_30d);
  if ([registered, active, workouts, exercises, meals].some((value) => value === null)) {
    return { state: "query_failed" };
  }

  return {
    state: "ready",
    metrics: {
      registered_users: registered!,
      active_users_30d: active!,
      completed_workouts_30d: workouts!,
      active_exercises: exercises!,
      food_logs_30d: meals!,
    },
  };
}
