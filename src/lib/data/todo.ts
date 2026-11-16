/**
 * To-Dos and the schedule in planner_events.
 *
 * "v2" is a database with the To-Do store (local_date, untimed items, sort_order, goal links).
 * On an older database ("legacy") the week view still reads and adds timed events as Phase 1 did;
 * untimed To-Dos, ordering and goal links wait for the update.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { localDateKey } from "@/lib/domain/dates";
import { addDays } from "@/lib/domain/day-keys";
import { parseTodoRow, sortTodos, type TodoInput, type TodoItem } from "@/lib/domain/todo";
import { DataError, FeatureUnavailableError, isMissingColumnError, isMissingFunctionError, isMissingSchemaError } from "./missing-schema";

type Db = SupabaseClient;
export type TodoSchema = "v2" | "legacy";

const V2_COLUMNS = "id,event_type,title,description,local_date,starts_at,ends_at,status,completed_at,sort_order,goal_id,workout_plan_id,created_at";
const LEGACY_COLUMNS = "id,event_type,title,description,starts_at,ends_at,status,workout_plan_id,created_at";
const dayOf = (iso: string) => localDateKey(new Date(iso));

function startOfDay(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day).toISOString();
}

/** Items from `from` to `to` (inclusive day keys), without cancelled ones, in the user's order. */
export async function loadTodos(db: Db, userId: string, from: string, to: string): Promise<{ items: TodoItem[]; schema: TodoSchema }> {
  const v2 = await db.from("planner_events").select(V2_COLUMNS).eq("user_id", userId).gte("local_date", from).lte("local_date", to)
    .neq("status", "cancelled").order("local_date").order("sort_order").order("starts_at", { ascending: true, nullsFirst: true }).limit(500);
  if (!v2.error) return { items: sortTodos(((v2.data ?? []) as Record<string, unknown>[]).map((row) => parseTodoRow(row, dayOf))), schema: "v2" };
  if (!isMissingColumnError(v2.error)) throw new DataError("Your To-Do list could not be loaded.", v2.error);
  const legacy = await db.from("planner_events").select(LEGACY_COLUMNS).eq("user_id", userId)
    .gte("starts_at", startOfDay(from)).lt("starts_at", startOfDay(addDays(to, 1))).neq("status", "cancelled").order("starts_at").limit(500);
  if (legacy.error) throw new DataError("Your schedule could not be loaded.", legacy.error);
  return { items: sortTodos(((legacy.data ?? []) as Record<string, unknown>[]).map((row) => parseTodoRow(row, dayOf))), schema: "legacy" };
}

function legacyPayload(input: TodoInput) {
  if (!input.starts_at || input.event_type === "task") {
    throw new FeatureUnavailableError("To-Dos without a time arrive with the next FITX update. Add a time to put it on your schedule.");
  }
  const { event_type, title, description, starts_at, ends_at, workout_plan_id } = input;
  return { event_type, title, description, starts_at, ends_at, workout_plan_id };
}

export async function insertTodo(db: Db, userId: string, input: TodoInput, sortOrder: number, schema: TodoSchema): Promise<TodoItem> {
  const row: Record<string, unknown> = schema === "v2"
    ? { user_id: userId, ...input, sort_order: sortOrder, status: "scheduled" }
    : { user_id: userId, ...legacyPayload(input), status: "scheduled" };
  const result = await db.from("planner_events").insert(row).select(schema === "v2" ? V2_COLUMNS : LEGACY_COLUMNS).single();
  if (result.error) {
    if (isMissingSchemaError(result.error)) throw new FeatureUnavailableError();
    throw new DataError("That item could not be saved.", result.error);
  }
  return parseTodoRow(result.data as unknown as Record<string, unknown>, dayOf);
}

export async function updateTodo(db: Db, userId: string, id: string, input: TodoInput, schema: TodoSchema): Promise<TodoItem> {
  const patch: Record<string, unknown> = schema === "v2" ? { ...input } : legacyPayload(input);
  const result = await db.from("planner_events").update(patch).eq("id", id).eq("user_id", userId).select(schema === "v2" ? V2_COLUMNS : LEGACY_COLUMNS).single();
  if (result.error) {
    if (isMissingSchemaError(result.error)) throw new FeatureUnavailableError();
    throw new DataError("That item could not be updated.", result.error);
  }
  return parseTodoRow(result.data as unknown as Record<string, unknown>, dayOf);
}

/** Ticks or unticks an item. The database sets or clears completed_at with the status. */
export async function setTodoDone(db: Db, userId: string, id: string, done: boolean): Promise<void> {
  const result = await db.from("planner_events").update({ status: done ? "completed" : "scheduled" }).eq("id", id).eq("user_id", userId);
  if (result.error) throw new DataError(done ? "That item could not be marked done." : "That item could not be reopened.", result.error);
}

export async function deleteTodo(db: Db, userId: string, id: string): Promise<void> {
  const result = await db.from("planner_events").delete().eq("id", id).eq("user_id", userId);
  if (result.error) throw new DataError("That item could not be deleted.", result.error);
}

/** Puts a deleted item back with the same id, day, order, status and links (Undo). */
export async function restoreTodo(db: Db, userId: string, item: TodoItem, schema: TodoSchema): Promise<void> {
  const base: Record<string, unknown> = { id: item.id, user_id: userId, event_type: item.kind, title: item.title, description: item.description, starts_at: item.startsAt, ends_at: item.endsAt, status: item.status, workout_plan_id: item.workoutPlanId };
  const row: Record<string, unknown> = schema === "v2" ? { ...base, local_date: item.localDate, sort_order: item.sortOrder, goal_id: item.goalId, completed_at: item.completedAt } : base;
  const result = await db.from("planner_events").insert(row);
  if (result.error) throw new DataError("That item could not be restored.", result.error);
}

/** Saves a day's order in one request (fitx_reorder_todo). */
export async function saveTodoOrder(db: Db, localDate: string, ids: string[]): Promise<void> {
  const result = await db.rpc("fitx_reorder_todo", { p_local_date: localDate, p_ids: ids });
  if (result.error) {
    if (isMissingFunctionError(result.error)) throw new FeatureUnavailableError();
    throw new DataError("The new order could not be saved.", result.error);
  }
}

export type PlanOption = { id: string; title: string };

/** Saved workouts the user can put on a day. */
export async function loadPlanOptions(db: Db, userId: string): Promise<PlanOption[]> {
  const result = await db.from("workout_plans").select("id,title").eq("user_id", userId).neq("status", "cancelled").order("title").limit(200);
  if (result.error) throw new DataError("Your saved workouts could not be loaded.", result.error);
  return (result.data ?? []) as PlanOption[];
}
