/**
 * Goals with their measured progress (fitx_goal_progress) and the writes behind the Goals page.
 *
 * "v2" is a database with goals v2 (periods, automatic metrics, the manual-total trigger). On an
 * older database ("v1") goals still load, and manual goals can be created, logged, edited, paused,
 * completed and deleted the way Phase 1 did it; automatic goals wait for the update.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseGoalRow, type GoalInput, type GoalStatus, type GoalView } from "@/lib/domain/goals";
import { browserTimeZone } from "./today";
import { DataError, FeatureUnavailableError, isMissingFunctionError, isMissingSchemaError } from "./missing-schema";

type Db = SupabaseClient;
export type GoalsSchema = "v2" | "v1";

const V1_COLUMNS = "id,title,category,metric,target_value,current_value,unit,starts_on,due_on,status,notes,created_at,updated_at";

export async function loadGoals(db: Db, userId: string, localDate: string, timeZone = browserTimeZone()): Promise<{ goals: GoalView[]; schema: GoalsSchema }> {
  const rpc = await db.rpc("fitx_goal_progress", { p_local_date: localDate, p_tz: timeZone });
  if (!rpc.error) return { goals: ((rpc.data ?? []) as Record<string, unknown>[]).map(parseGoalRow), schema: "v2" };
  if (!isMissingFunctionError(rpc.error)) throw new DataError("Your goals could not be loaded.", rpc.error);
  const legacy = await db.from("goals").select(V1_COLUMNS).eq("user_id", userId).neq("status", "cancelled").order("created_at", { ascending: true });
  if (legacy.error) throw new DataError("Your goals could not be loaded.", legacy.error);
  return { goals: ((legacy.data ?? []) as Record<string, unknown>[]).map(parseGoalRow), schema: "v1" };
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
 * Logs manual progress. On v2 a trigger keeps the goal's total, and corrections may be negative.
 * On v1 only positive amounts are accepted and the total is written from the browser, as before.
 */
export async function addGoalEntry(db: Db, userId: string, goal: GoalView, amount: number, note: string | null, schema: GoalsSchema): Promise<void> {
  if (!Number.isFinite(amount) || amount === 0) throw new DataError("Enter an amount other than zero.");
  if (schema === "v1" && amount < 0) throw new FeatureUnavailableError("Corrections arrive with the next FITX update. Delete an entry instead.");
  const inserted = await db.from("goal_progress_entries").insert({ user_id: userId, goal_id: goal.id, amount: Number(amount.toFixed(2)), note });
  if (inserted.error) throw new DataError("That progress could not be saved.", inserted.error);
  if (schema === "v1") {
    const total = Math.max(0, (goal.currentValue ?? 0) + amount);
    const updated = await db.from("goals").update({ current_value: total, updated_at: new Date().toISOString() }).eq("id", goal.id).eq("user_id", userId);
    if (updated.error) throw new DataError("Your progress was saved but the total did not update. Refresh to see it.", updated.error);
  }
}

export async function deleteGoalEntry(db: Db, userId: string, goal: GoalView, entry: GoalEntry, schema: GoalsSchema): Promise<void> {
  const removed = await db.from("goal_progress_entries").delete().eq("id", entry.id).eq("user_id", userId);
  if (removed.error) throw new DataError("That entry could not be deleted.", removed.error);
  if (schema === "v1") {
    const total = Math.max(0, (goal.currentValue ?? 0) - entry.amount);
    const updated = await db.from("goals").update({ current_value: total, updated_at: new Date().toISOString() }).eq("id", goal.id).eq("user_id", userId);
    if (updated.error) throw new DataError("The entry was deleted but the total did not update. Refresh to see it.", updated.error);
  }
}

export type GoalOption = { id: string; title: string };

/** Goals a To-Do can count toward: active and paused ones. */
export async function loadGoalOptions(db: Db, userId: string): Promise<GoalOption[]> {
  const result = await db.from("goals").select("id,title").eq("user_id", userId).in("status", ["active", "paused"]).order("created_at").limit(100);
  if (result.error) throw new DataError("Your goals could not be loaded.", result.error);
  return (result.data ?? []) as GoalOption[];
}
