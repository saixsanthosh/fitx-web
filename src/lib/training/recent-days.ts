import type { SupabaseClient } from "@supabase/supabase-js";

const DAY_MS = 86400000;

/**
 * Exercise id -> days since the member last trained it, from the last two weeks: the planner's `recentDays`, so a
 * day just trained is not picked again first. Unreadable history gives an empty map (the planner then ranks without it).
 */
export async function loadRecentExerciseDays(supabase: Pick<SupabaseClient, "from">, userId: string, now = Date.now()): Promise<Map<string, number>> {
  const since = new Date(now - 14 * DAY_MS);
  const result = await supabase.from("workout_session_exercises").select("exercise_id,created_at").eq("user_id", userId)
    .gte("created_at", since.toISOString()).order("created_at", { ascending: false }).limit(300);
  const days = new Map<string, number>();
  for (const row of (result.data ?? []) as Array<{ exercise_id: string | null; created_at: string }>) {
    if (row.exercise_id && !days.has(row.exercise_id)) days.set(row.exercise_id, Math.floor((now - Date.parse(row.created_at)) / DAY_MS));
  }
  return days;
}
