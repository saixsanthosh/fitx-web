import "server-only";
import { requireAdmin } from "@/lib/admin-auth";
import { logServerError } from "@/lib/log";
import { isMissingTable } from "@/lib/schema";
import { createAdminSupabase } from "@/lib/supabase/admin";

export async function listExercises(search = "") {
  await requireAdmin("content.manage");
  const supabase = createAdminSupabase();
  if (!supabase) return { state: "service_key_missing" as const, exercises: [] };
  let query = supabase
    .from("exercise_library")
    .select("id,name,primary_muscle,equipment,difficulty,is_active")
    .order("name")
    .limit(100);
  const term = search.trim().slice(0, 80);
  if (term) query = query.ilike("name", `%${term.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`);
  const { data, error } = await query;
  if (error) {
    logServerError("data.list_exercises", error);
    return { state: isMissingTable(error) ? "migration_pending" as const : "query_failed" as const, exercises: [] };
  }
  return { state: "ready" as const, exercises: data ?? [] };
}
