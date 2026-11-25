/**
 * Goals with their measured progress (fitx_goal_progress) and the writes behind the Goals page.
 *
 * "v2" is a database with goals v2 (periods, automatic metrics, the manual-total trigger). On an
 * older database ("v1") goals still load, and manual goals can be created, logged, edited, paused,
 * completed and deleted the way Phase 1 did it; automatic goals wait for the update.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays } from "@/lib/domain/day-keys";
import { clientGoalValue, correctionProblem, entryRemovalProblem, goalWindow, isClientMetric, parseGoalRow, type GoalActivityRow, type GoalInput, type GoalSessionRow, type GoalStatus, type GoalView } from "@/lib/domain/goals";
import { macroValue, type MealValueRow } from "@/lib/domain/meal-totals";
import { loadActivitiesBetween } from "./activities";
import { browserTimeZone } from "./today";
import { DataError, FeatureUnavailableError, isMissingFunctionError, isMissingSchemaError } from "./missing-schema";
import { pagedRows, startOfDayIso, toNumber } from "./rows";

type Db = SupabaseClient;
export type GoalsSchema = "v2" | "v1";

const V1_COLUMNS = "id,title,category,metric,target_value,current_value,unit,starts_on,due_on,status,notes,created_at,updated_at";

export async function loadGoals(db: Db, userId: string, localDate: string, timeZone = browserTimeZone()): Promise<{ goals: GoalView[]; schema: GoalsSchema }> {
  const rpc = await db.rpc("fitx_goal_progress", { p_local_date: localDate, p_tz: timeZone });
  if (!rpc.error) return { goals: await measureInBrowser(db, userId, localDate, ((rpc.data ?? []) as Record<string, unknown>[]).map(parseGoalRow)), schema: "v2" };
  if (!isMissingFunctionError(rpc.error)) throw new DataError("Your goals could not be loaded.", rpc.error);
  const legacy = await db.from("goals").select(V1_COLUMNS).eq("user_id", userId).neq("status", "cancelled").order("created_at", { ascending: true });
  if (legacy.error) throw new DataError("Your goals could not be loaded.", legacy.error);
  return { goals: await measureInBrowser(db, userId, localDate, ((legacy.data ?? []) as Record<string, unknown>[]).map(parseGoalRow)), schema: "v1" };
}

type Window = { from: string; to: string };

function span(windows: ReadonlyArray<Window | null>): Window | null {
  const known = windows.filter((window): window is Window => window !== null);
  if (!known.length) return null;
  return { from: known.reduce((min, window) => (window.from < min ? window.from : min), known[0].from), to: known.reduce((max, window) => (window.to > max ? window.to : max), known[0].to) };
}

/** Finished workouts' training time (pauses excluded) that started on the days of `window`; null when unreadable. */
async function loadSessionTimes(db: Db, userId: string, window: Window): Promise<GoalSessionRow[] | null> {
  const result = await pagedRows<{ started_at: string; duration_seconds: unknown }>((from, to) => db.from("workout_sessions")
    .select("started_at,duration_seconds").eq("user_id", userId).eq("status", "completed")
    .gte("started_at", startOfDayIso(window.from)).lt("started_at", startOfDayIso(addDays(window.to, 1)))
    .order("started_at", { ascending: true }).range(from, to), { maxPages: 5 });
  if (result.error || result.capped) return null;
  return result.rows.map((row) => ({ startedAt: row.started_at, durationSeconds: Math.max(0, toNumber(row.duration_seconds) ?? 0) }));
}

/** Food entries without a calorie or protein value on the days of `window`, per day; null when unreadable. */
async function loadMissingFood(db: Db, userId: string, window: Window): Promise<MealValueRow[] | null> {
  const result = await pagedRows<Record<string, unknown>>((from, to) => db.from("meals")
    .select("date,calories,protein,missing:nutrition_snapshot->missing").eq("user_id", userId)
    .gte("date", window.from).lte("date", window.to).order("date", { ascending: true }).range(from, to), { maxPages: 3 });
  if (result.error || result.capped) return null;
  return result.rows.map((row) => ({ ...row, nutrition_snapshot: { missing: Array.isArray(row.missing) ? row.missing : [] } }));
}

/**
 * What the database cannot measure, measured here from the member's own rows:
 *  - Distance and Active minutes goals (stored as manual goals with a reserved unit): recorded activities and
 *    finished workouts in the goal's period; unknown (null) when activities cannot be read.
 *  - Calorie and protein goals: how many food entries in the period have no value for the goal (the database
 *    sum leaves them out), so the goal can say so instead of passing them off as 0.
 * A failure here never hides the goals: the affected numbers stay unknown.
 */
async function measureInBrowser(db: Db, userId: string, today: string, goals: GoalView[]): Promise<GoalView[]> {
  const windows = new Map(goals.map((goal) => [goal.id, goalWindow(goal, today)]));
  const client = goals.filter((goal) => isClientMetric(goal.metric));
  const food = goals.filter((goal) => (goal.metric === "protein_g" || goal.metric === "calories_kcal") && goal.period !== "long_term");
  if (!client.length && !food.length) return goals;

  const clientSpan = span(client.map((goal) => windows.get(goal.id) ?? null));
  const foodSpan = span(food.map((goal) => windows.get(goal.id) ?? null));
  const needsSessions = client.some((goal) => goal.metric === "active_minutes");
  const [activities, sessions, meals] = await Promise.all([
    clientSpan ? loadActivitiesBetween(db, userId, clientSpan.from, clientSpan.to).then((result) => (result.available && !result.capped ? result.activities : null), () => null) : Promise.resolve(null),
    clientSpan && needsSessions ? loadSessionTimes(db, userId, clientSpan).catch(() => null) : Promise.resolve(null),
    foodSpan ? loadMissingFood(db, userId, foodSpan).catch(() => null) : Promise.resolve(null),
  ]);

  return goals.map((goal) => {
    const window = windows.get(goal.id) ?? null;
    if (isClientMetric(goal.metric)) {
      const rows: GoalActivityRow[] | null = activities ? activities.map(({ startedAt, distanceM, movingSeconds }) => ({ startedAt, distanceM, movingSeconds })) : null;
      return { ...goal, currentValue: window ? clientGoalValue(goal.metric, window, rows, sessions) : null };
    }
    if (food.includes(goal) && window && meals) {
      const key = goal.metric === "protein_g" ? "protein" : "calories";
      const missing = meals.filter((row) => typeof row.date === "string" && row.date >= window.from && row.date <= window.to && macroValue(row, key) === null).length;
      return { ...goal, missingEntries: missing };
    }
    return goal;
  });
}

function v1Payload(input: GoalInput) {
  if (input.metric !== "manual" || input.period !== "long_term" || input.direction !== "increase") {
    throw new FeatureUnavailableError("Daily, weekly and automatic goals arrive with the next FITX update. Custom long-term goals work now.");
  }
  const { title, category, metric, target_value, unit, starts_on, due_on, notes } = input;
  return { title, category, metric, target_value, unit, starts_on, due_on, notes };
}

export async function createGoal(db: Db, userId: string, input: GoalInput, schema: GoalsSchema): Promise<string> {
  const row: Record<string, unknown> = schema === "v2" ? { user_id: userId, ...input } : { user_id: userId, ...v1Payload(input), current_value: 0 };
  const result = await db.from("goals").insert(row).select("id").single();
  if (result.error) {
    if (isMissingSchemaError(result.error)) throw new FeatureUnavailableError();
    throw new DataError("That goal could not be saved.", result.error);
  }
  return (result.data as { id: string }).id;
}

export async function updateGoal(db: Db, userId: string, id: string, input: GoalInput, schema: GoalsSchema): Promise<void> {
  const patch: Record<string, unknown> = schema === "v2" ? { ...input } : v1Payload(input);
  const result = await db.from("goals").update(patch).eq("id", id).eq("user_id", userId);
  if (result.error) {
    if (isMissingSchemaError(result.error)) throw new FeatureUnavailableError();
    throw new DataError("That goal could not be updated.", result.error);
  }
}

export async function setGoalStatus(db: Db, userId: string, id: string, status: GoalStatus, schema: GoalsSchema): Promise<void> {
  // v2 keeps updated_at and completed_at with a trigger; v1 needs updated_at from the browser.
  const patch = schema === "v2" ? { status } : { status, updated_at: new Date().toISOString() };
  const result = await db.from("goals").update(patch).eq("id", id).eq("user_id", userId);
  if (result.error) throw new DataError("That goal could not be updated.", result.error);
}

export async function deleteGoal(db: Db, userId: string, id: string): Promise<void> {
  const result = await db.from("goals").delete().eq("id", id).eq("user_id", userId);
  if (result.error) throw new DataError("That goal could not be deleted.", result.error);
}

export type GoalEntry = { id: string; amount: number; note: string | null; loggedAt: string };

export async function listGoalEntries(db: Db, userId: string, goalId: string, limit = 30): Promise<GoalEntry[]> {
  const result = await db.from("goal_progress_entries").select("id,amount,note,logged_at").eq("user_id", userId).eq("goal_id", goalId)
    .order("logged_at", { ascending: false }).limit(limit);
  if (result.error) throw new DataError("Progress history could not be loaded.", result.error);
  return ((result.data ?? []) as Array<{ id: string; amount: number | string; note: string | null; logged_at: string }>)
    .map((row) => ({ id: row.id, amount: Number(row.amount), note: row.note, loggedAt: row.logged_at }));
}

/**
 * Logs manual progress. On v2 a trigger keeps the goal's total, and corrections may be negative, down to a
 * total of zero, never below. On v1 only positive amounts are accepted and the total is written from the
 * browser, as before.
 */
export async function addGoalEntry(db: Db, userId: string, goal: GoalView, amount: number, note: string | null, schema: GoalsSchema): Promise<void> {
  if (!Number.isFinite(amount) || amount === 0) throw new DataError("Enter an amount other than zero.");
  if (schema === "v1" && amount < 0) throw new FeatureUnavailableError("Corrections arrive with the next FITX update. Delete an entry instead.");
  const belowZero = correctionProblem(goal, amount);
  if (belowZero) throw new DataError(belowZero);
  const inserted = await db.from("goal_progress_entries").insert({ user_id: userId, goal_id: goal.id, amount: Number(amount.toFixed(2)), note });
  if (inserted.error) throw new DataError("That progress could not be saved.", inserted.error);
  if (schema === "v1") {
    const total = Math.max(0, (goal.currentValue ?? 0) + amount);
    const updated = await db.from("goals").update({ current_value: total, updated_at: new Date().toISOString() }).eq("id", goal.id).eq("user_id", userId);
    if (updated.error) throw new DataError("Your progress was saved but the total did not update. Refresh to see it.", updated.error);
  }
}

/**
 * Deletes a logged entry. On v2 (where the total is the sum of the entries) that is refused when it would take
 * the total below zero: the corrections are deleted first. On v1 the browser-kept total stops at zero, as before.
 */
export async function deleteGoalEntry(db: Db, userId: string, goal: GoalView, entry: GoalEntry, schema: GoalsSchema): Promise<void> {
  const belowZero = schema === "v2" ? entryRemovalProblem(goal, entry) : null;
  if (belowZero) throw new DataError(belowZero);
  const removed = await db.from("goal_progress_entries").delete().eq("id", entry.id).eq("user_id", userId);
  if (removed.error) throw new DataError("That entry could not be deleted.", removed.error);
  if (schema === "v1") {
    const total = Math.max(0, (goal.currentValue ?? 0) - entry.amount);
    const updated = await db.from("goals").update({ current_value: total, updated_at: new Date().toISOString() }).eq("id", goal.id).eq("user_id", userId);
    if (updated.error) throw new DataError("The entry was deleted but the total did not update. Refresh to see it.", updated.error);
  }
}

export type GoalOption = { id: string; title: string; countsTodos: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Goals a To-Do can count toward: active and paused Checklist goals (metric tasks_completed), the only
 * kind whose progress counts linked To-Dos. `keepId` also returns the goal a To-Do is already linked
 * to, whatever its kind, so editing it does not silently drop the link.
 */
export async function loadGoalOptions(db: Db, userId: string, keepId?: string | null): Promise<GoalOption[]> {
  const base = db.from("goals").select("id,title,metric").eq("user_id", userId).in("status", ["active", "paused"]);
  const query = keepId && UUID.test(keepId) ? base.or(`metric.eq.tasks_completed,id.eq.${keepId}`) : base.eq("metric", "tasks_completed");
  const result = await query.order("created_at").limit(100);
  if (result.error) throw new DataError("Your goals could not be loaded.", result.error);
  return ((result.data ?? []) as Array<{ id: string; title: string; metric: string }>)
    .map((goal) => ({ id: goal.id, title: goal.title, countsTodos: goal.metric === "tasks_completed" }));
}
