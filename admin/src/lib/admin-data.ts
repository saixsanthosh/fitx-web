import "server-only";
import { createAdminSupabase } from "@/lib/supabase/admin";

export type AdminDataState = "ready" | "service_key_missing" | "migration_pending" | "query_failed";

function isMissingSchema(code?: string) {
  return code === "42P01" || code === "PGRST205" || code === "PGRST204";
}

export async function listRecentUsers(page = 1) {
  const supabase = createAdminSupabase();
  if (!supabase) return { state: "service_key_missing" as const, users: [] };
  const safePage = Number.isInteger(page) ? Math.min(Math.max(page, 1), 1000) : 1;
  const { data, error } = await supabase.auth.admin.listUsers({ page: safePage, perPage: 50 });
  if (error) return { state: "query_failed" as const, users: [] };

  const users = [...data.users]
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .map((user) => ({
      id: user.id,
      email: user.email ?? "Email unavailable",
      createdAt: user.created_at,
      lastSignInAt: user.last_sign_in_at,
      bannedUntil: user.banned_until,
    }));
  return { state: "ready" as const, users, page: safePage, hasNext: data.users.length === 50, generatedAt: Date.now() };
}

export async function listExercises(search = "") {
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
  if (error) return { state: isMissingSchema(error.code) ? "migration_pending" as const : "query_failed" as const, exercises: [] };
  return { state: "ready" as const, exercises: data ?? [] };
}

export async function listAdminMembers() {
  const supabase = createAdminSupabase();
  if (!supabase) return { state: "service_key_missing" as const, members: [] };
  const { data, error } = await supabase
    .from("fitx_admin_members")
    .select("user_id,role,is_active,created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return { state: isMissingSchema(error.code) ? "migration_pending" as const : "query_failed" as const, members: [] };
  return { state: "ready" as const, members: data ?? [] };
}

export async function listAuditEvents() {
  const supabase = createAdminSupabase();
  if (!supabase) return { state: "service_key_missing" as const, events: [] };
  const { data, error } = await supabase
    .from("fitx_admin_audit_logs")
    .select("id,actor_id,action,resource_type,resource_id,created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return { state: isMissingSchema(error.code) ? "migration_pending" as const : "query_failed" as const, events: [] };
  return { state: "ready" as const, events: data ?? [] };
}
