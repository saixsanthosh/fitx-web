/**
 * Home data: today's summary (fitx_today_summary, with a browser-side fallback for databases that
 * do not have it yet) and the user's widget layout (user_preferences.dashboard_layout).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadTargets } from "@/lib/food/client-data";
import { localDateKey } from "@/lib/domain/dates";
import { addDays, mondayOf } from "@/lib/domain/day-keys";
import { sanitizeLayout, serializeLayout, type LayoutItem } from "@/lib/domain/dashboard-layout";
import { parseTodaySummary, summaryFromRows, type TodaySummary } from "@/lib/domain/today";
import { DataError, isMissingColumnError, isMissingFunctionError, isMissingSchemaError } from "./missing-schema";

export type Db = SupabaseClient;

/** The browser's IANA time zone, which the summary uses to place workouts on the right day. */
export function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/** Local midnight of a day key, as an ISO instant in the browser's zone. */
function startOfDay(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day).toISOString();
}

export type SummaryResult = { summary: TodaySummary; source: "database" | "browser" };

export async function loadTodaySummary(db: Db, userId: string, localDate: string, timeZone = browserTimeZone()): Promise<SummaryResult> {
  // The targets the user set in Nutrition; null when there are none or the table is not there yet.
  const [rpc, targets] = await Promise.all([
    db.rpc("fitx_today_summary", { p_local_date: localDate, p_tz: timeZone }),
    loadTargets(db, userId).catch(() => null),
  ]);
  if (!rpc.error) {
    const summary = parseTodaySummary(rpc.data);
    if (summary) return { summary: { ...summary, targets }, source: "database" };
    throw new DataError("Today's summary came back empty.");
  }
  if (!isMissingFunctionError(rpc.error)) throw new DataError("Today's summary could not be loaded.", rpc.error);
  return { summary: { ...(await summaryInBrowser(db, userId, localDate, timeZone)), targets }, source: "browser" };
}

/** Phase 1 databases: the same numbers from individual queries (no row cap on the day's logs). */
async function summaryInBrowser(db: Db, userId: string, localDate: string, timeZone: string | null): Promise<TodaySummary> {
  const monday = mondayOf(localDate);
  const [profile, preferences, meals, water, sessions, weights, planned] = await Promise.all([
    db.from("profiles").select("name,age,gender,height,weight,target_weight").eq("id", userId).maybeSingle(),
    db.from("user_preferences").select("workouts_per_week,daily_water_goal_ml,activity_level,primary_goal").eq("user_id", userId).maybeSingle(),
    db.from("meals").select("calories,protein,carbs,fat").eq("user_id", userId).eq("date", localDate).limit(2000),
    db.from("water_logs").select("amount_ml").eq("user_id", userId).eq("local_date", localDate).limit(2000),
    db.from("workout_sessions").select("started_at").eq("user_id", userId).eq("status", "completed")
      .gte("started_at", startOfDay(monday)).lt("started_at", startOfDay(addDays(monday, 7))).limit(500),
    db.from("body_metrics").select("weight,date").eq("user_id", userId).not("weight", "is", null).lte("date", localDate)
      .order("date", { ascending: false }).order("created_at", { ascending: false }).limit(2),
    db.from("planner_events").select("id,title,starts_at,status,workout_plan_id").eq("user_id", userId).eq("event_type", "workout").neq("status", "cancelled")
      .gte("starts_at", startOfDay(localDate)).lt("starts_at", startOfDay(addDays(localDate, 1))).order("starts_at").limit(20),
  ]);
  const failed = [profile, preferences, meals, water, sessions, weights, planned].find((result) => result.error);
  if (failed) throw new DataError("Today's summary could not be loaded.", failed.error);
  return summaryFromRows({
    localDate,
    timezone: timeZone ?? "UTC",
    meals: meals.data ?? [],
    water: water.data ?? [],
    sessions: (sessions.data ?? []).map((row: { started_at: string }) => ({ localDate: localDateKey(new Date(row.started_at)) })),
    weights: weights.data ?? [],
    profile: profile.data,
    preferences: preferences.data,
    plannedWorkouts: (planned.data ?? []).map((row: { id: string; title: string; starts_at: string | null; status: string; workout_plan_id: string | null }) => ({
      id: row.id, title: row.title, startsAt: row.starts_at, status: row.status, workoutPlanId: row.workout_plan_id,
    })),
  });
}

export type LayoutResult = { items: LayoutItem[]; canSave: boolean };

/** The saved widget layout, the default when none is saved, and whether this database can store one. */
export async function loadDashboardLayout(db: Db, userId: string): Promise<LayoutResult> {
  const result = await db.from("user_preferences").select("dashboard_layout").eq("user_id", userId).maybeSingle();
  if (result.error) {
    if (isMissingColumnError(result.error)) return { items: sanitizeLayout(null), canSave: false };
    throw new DataError("Your Home layout could not be loaded.", result.error);
  }
  return { items: sanitizeLayout((result.data as { dashboard_layout?: unknown } | null)?.dashboard_layout ?? null), canSave: true };
}

export type SaveLayoutResult = "saved" | "unavailable";

/** Saves the layout on the user's preferences row (creating the row only if onboarding never did). */
export async function saveDashboardLayout(db: Db, userId: string, items: LayoutItem[]): Promise<SaveLayoutResult> {
  const value = serializeLayout(items);
  const updated = await db.from("user_preferences").update({ dashboard_layout: value }).eq("user_id", userId).select("user_id");
  if (updated.error) {
    if (isMissingSchemaError(updated.error)) return "unavailable";
    throw new DataError("Your Home layout could not be saved.", updated.error);
  }
  if ((updated.data ?? []).length) return "saved";
  const inserted = await db.from("user_preferences").insert({ user_id: userId, dashboard_layout: value });
  if (inserted.error) {
    if (isMissingSchemaError(inserted.error)) return "unavailable";
    throw new DataError("Your Home layout could not be saved.", inserted.error);
  }
  return "saved";
}

/** Adds a water entry for the day. */
export async function logWater(db: Db, userId: string, localDate: string, amountMl: number): Promise<void> {
  if (!Number.isInteger(amountMl) || amountMl < 1 || amountMl > 3000) throw new DataError("Enter between 1 and 3,000 ml.");
  const result = await db.from("water_logs").insert({ user_id: userId, amount_ml: amountMl, local_date: localDate });
  if (result.error) throw new DataError("That water could not be saved.", result.error);
}

/** Records a weigh-in for the day (body_metrics), as the Progress page does. */
export async function logWeight(db: Db, userId: string, localDate: string, kg: number): Promise<void> {
  if (!Number.isFinite(kg) || kg < 30 || kg > 500) throw new DataError("Enter a weight between 30 and 500 kg.");
  const result = await db.from("body_metrics").insert({ user_id: userId, date: localDate, weight: Math.round(kg * 10) / 10 });
  if (result.error) throw new DataError("That weigh-in could not be saved.", result.error);
}
