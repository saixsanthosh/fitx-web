/**
 * Home data: today's summary (fitx_today_summary, with a browser-side fallback for databases that
 * do not have it yet), today's food entries checked for unknown and estimated values (contract C11), and
 * the user's widget layout (user_preferences.dashboard_layout).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadTargets } from "@/lib/food/client-data";
import { localDateKey } from "@/lib/domain/dates";
import { addDays, mondayOf } from "@/lib/domain/day-keys";
import { readLayout, serializeLayout, type LayoutItem, type WidgetId } from "@/lib/domain/dashboard-layout";
import { MEAL_VALUE_COLUMNS, mealTotals, type MealTotals, type MealValueRow } from "@/lib/domain/meal-totals";
import { parseTodaySummary, summaryFromRows, type TodaySummary } from "@/lib/domain/today";
import { profileAge } from "@/lib/domain/profile-options";
import { loadBirthDate, loadNutritionFocus, logWeighIn } from "@/lib/domain/user-context";
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

export type SummaryResult = {
  summary: TodaySummary;
  source: "database" | "browser";
  /**
   * Today's food entries checked one by one: how many lack each value (left out of the sums, never read as 0)
   * and how many are estimates. Null when they could not be read; the sums above still stand.
   */
  food: MealTotals | null;
};

/** Today's entries, read whole so unknown values and estimates can be told apart (a day is a few dozen rows). */
async function loadDayFood(db: Db, userId: string, localDate: string): Promise<MealTotals | null> {
  const result = await db.from("meals").select(MEAL_VALUE_COLUMNS).eq("user_id", userId).eq("date", localDate).limit(2000);
  return result.error ? null : mealTotals((result.data ?? []) as MealValueRow[]);
}

export async function loadTodaySummary(db: Db, userId: string, localDate: string, timeZone = browserTimeZone()): Promise<SummaryResult> {
  // The targets the user set in Nutrition; null when there are none or the table is not there yet.
  const [rpc, targets, food, birthDate, focus, daysAnswered] = await Promise.all([
    db.rpc("fitx_today_summary", { p_local_date: localDate, p_tz: timeZone }),
    loadTargets(db, userId).catch(() => null),
    loadDayFood(db, userId, localDate).catch(() => null),
    loadBirthDate(db, userId),
    // Not in fitx_today_summary: read on its own, so High protein raises Home's protein target as everywhere.
    loadNutritionFocus(db, userId),
    loadTrainingDaysAnswered(db, userId),
  ]);
  const complete = (summary: TodaySummary) => withTrainingDays(withNutritionFocus(withBirthDateAge(summary, birthDate, localDate), focus), daysAnswered);
  if (!rpc.error) {
    const summary = parseTodaySummary(rpc.data);
    if (summary) return { summary: { ...complete(summary), targets }, source: "database", food };
    throw new DataError("Today's summary came back empty.");
  }
  if (!isMissingFunctionError(rpc.error)) throw new DataError("Today's summary could not be loaded.", rpc.error);
  return { summary: { ...complete(await summaryInBrowser(db, userId, localDate, timeZone)), targets }, source: "browser", food };
}

/**
 * Whether the member's weekly training days (user_preferences.workouts_per_week) are their own answer. Onboarding no
 * longer asks for them, yet its first page creates the preferences row, so a new member's row carries the column's
 * default of 3, and fitx_today_summary returns it. The days count as answered by the Workouts setup's own rule
 * (training/setup.ts isWorkoutSetupDone, the rule Progress and Profile use): workout_setup_at is set, or a Home or Gym
 * equipment list is saved. Any read that fails counts as not answered, so a default is never shown as theirs.
 */
export async function loadTrainingDaysAnswered(db: Db, userId: string): Promise<boolean> {
  try {
    const prefs = await db.from("user_preferences").select("workout_setup_at").eq("user_id", userId).maybeSingle();
    // Before migration 20261123100020 the column is missing: then only a saved list counts, as in the setup.
    if (!prefs.error && typeof (prefs.data as { workout_setup_at?: unknown } | null)?.workout_setup_at === "string") return true;
    if (prefs.error && !isMissingColumnError(prefs.error)) return false;
    const lists = await db.from("user_equipment_profiles").select("context").eq("user_id", userId).in("context", ["home", "gym"]).limit(1);
    return !lists.error && (lists.data ?? []).length > 0;
  } catch {
    return false;
  }
}

/** The summary without the weekly training days while they are only the column default (see loadTrainingDaysAnswered). */
export function withTrainingDays(summary: TodaySummary, answered: boolean): TodaySummary {
  if (answered || !summary.preferences || summary.preferences.workoutsPerWeek === null) return summary;
  return { ...summary, preferences: { ...summary.preferences, workoutsPerWeek: null } };
}

/** The summary with the member's nutrition goal; a member without a preferences row keeps none (no target is invented). */
export function withNutritionFocus(summary: TodaySummary, focus: string | null): TodaySummary {
  return summary.preferences ? { ...summary, preferences: { ...summary.preferences, nutritionFocus: focus } } : summary;
}

/**
 * The summary with the age the birth date gives on the member's day. profiles.age (which the summary reads) is
 * only refreshed when the profile is saved, so after a birthday it lags; with no birth date the stored age stands.
 */
export function withBirthDateAge(summary: TodaySummary, birthDate: string | null, localDate: string): TodaySummary {
  const age = profileAge({ age: summary.profile.age, date_of_birth: birthDate }, localDate);
  return age === summary.profile.age ? summary : { ...summary, profile: { ...summary.profile, age } };
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

export type LayoutResult = {
  items: LayoutItem[];
  canSave: boolean;
  /** Widgets released after the stored layout was saved (added hidden): Home offers them once. */
  fresh: WidgetId[];
};

/** The saved widget layout, the default when none is saved, and whether this database can store one. */
export async function loadDashboardLayout(db: Db, userId: string): Promise<LayoutResult> {
  const result = await db.from("user_preferences").select("dashboard_layout").eq("user_id", userId).maybeSingle();
  if (result.error) {
    if (isMissingColumnError(result.error)) return { ...readLayout(null), canSave: false };
    throw new DataError("Your Home layout could not be loaded.", result.error);
  }
  return { ...readLayout((result.data as { dashboard_layout?: unknown } | null)?.dashboard_layout ?? null), canSave: true };
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

/**
 * Records today's weigh-in the way Progress and Profile do (logWeighIn): the body_metrics row, then the profile's
 * copy of the weight, so targets and every screen use the new weight. Returns false when only the profile copy
 * could not be updated (the weigh-in itself is saved).
 */
export async function saveWeighIn(db: Db, userId: string, kg: number): Promise<boolean> {
  if (!Number.isFinite(kg) || kg < 30 || kg > 500) throw new DataError("Enter a weight between 30 and 500 kg.");
  const result = await logWeighIn(db, userId, Math.round(kg * 10) / 10, "");
  if (result.error) throw new DataError("That weigh-in could not be saved.", result.error);
  return result.synced;
}
