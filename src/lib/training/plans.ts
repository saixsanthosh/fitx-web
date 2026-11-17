import type { SupabaseClient } from "@supabase/supabase-js";
import { columnList, isMissingFunctionError, payloadFor, withOptionalColumns } from "@/lib/domain/schema-fallback";

type Db = SupabaseClient;

/** Optional plan-exercise columns from 20261115110000 (see workouts/_lib/workout-columns.ts). */
const TARGET_COLUMNS = ["target_weight_kg", "target_duration_seconds"] as const;

export type PlanExerciseInput = {
  exercise_id: string | null;
  exercise_name: string;
  target_sets: number;
  reps_min: number;
  reps_max: number;
  rest_seconds: number;
  target_weight_kg: number | null;
  target_duration_seconds: number | null;
};

export type NewPlanInput = {
  title: string;
  split: string;
  workout_location: string;
  /** Local YYYY-MM-DD, or null for an undated plan. */
  planned_for: string | null;
  notes: string | null;
  programme_enrolment_id?: string | null;
  programme_day_index?: number | null;
};

/**
 * Creates a plan with its exercises. Uses fitx_save_workout_plan (one transaction) when the database
 * has it; otherwise inserts the plan, then its exercises, and removes the plan if the second step fails.
 * `includedTargets` is false when the database lacks the target columns and they were left out.
 */
export async function createPlanRecord(supabase: Db, userId: string, plan: NewPlanInput, exercises: readonly PlanExerciseInput[], options: { includeTargets: boolean }): Promise<{ planId: string | null; error: unknown; includedTargets: boolean }> {
  const rpc = await supabase.rpc("fitx_save_workout_plan", { p_plan: plan, p_exercises: exercises });
  if (!rpc.error) return { planId: rpc.data as string, error: null, includedTargets: true };
  if (!isMissingFunctionError(rpc.error)) return { planId: null, error: rpc.error, includedTargets: true };

  const status = plan.planned_for ? "scheduled" : "draft";
  const base = { user_id: userId, title: plan.title, split: plan.split, workout_location: plan.workout_location, planned_for: plan.planned_for, status, notes: plan.notes };
  const programmeFields = plan.programme_enrolment_id ? { programme_enrolment_id: plan.programme_enrolment_id, programme_day_index: plan.programme_day_index ?? null } : {};
  const inserted = await supabase.from("workout_plans").insert({ ...base, ...programmeFields }).select("id").single();
  if (inserted.error || !inserted.data) return { planId: null, error: inserted.error, includedTargets: true };
  const planId = (inserted.data as { id: string }).id;
  const rows = exercises.map((item, index) => ({ user_id: userId, plan_id: planId, sort_order: index, ...item }));
  const saved = await withOptionalColumns(TARGET_COLUMNS, (include) =>
    supabase.from("workout_plan_exercises").insert(rows.map((row) => payloadFor(row, TARGET_COLUMNS, include))),
  { includeOptional: options.includeTargets });
  if (saved.result.error) {
    await supabase.from("workout_plans").delete().eq("id", planId).eq("user_id", userId);
    return { planId: null, error: saved.result.error, includedTargets: saved.includedOptional };
  }
  return { planId, error: null, includedTargets: saved.includedOptional };
}

/** `planner_events.local_date` (see workouts/_lib/workout-columns.ts), sent and read when the database has it. */
export const PLANNER_DAY_COLUMNS = ["local_date"] as const;

/**
 * A one-hour planner event for a dated plan, at `time` on `date` (the browser's YYYY-MM-DD). It is listed
 * on that day: local_date is sent too, so the database does not work the day out from the start time in
 * the saved time zone, which can differ from the browser's.
 */
export async function schedulePlannerEvent(supabase: Db, userId: string, planId: string, title: string, date: string, time: string) {
  const startsAt = new Date(`${date}T${time || "18:00"}:00`);
  if (Number.isNaN(startsAt.getTime())) return { error: new Error("invalid date") };
  const row = {
    user_id: userId, event_type: "workout", workout_plan_id: planId, title: title.slice(0, 120), status: "scheduled",
    starts_at: startsAt.toISOString(), ends_at: new Date(startsAt.getTime() + 3600000).toISOString(), local_date: date,
  };
  const saved = await withOptionalColumns(PLANNER_DAY_COLUMNS, (include) => supabase.from("planner_events").insert(payloadFor(row, PLANNER_DAY_COLUMNS, include)));
  return saved.result;
}

/**
 * Starts a session from a plan with fitx_start_workout_session when the database has it. `plannerEventId`
 * is the planner item the member pressed Start on, if any (see start-link.ts): the database keeps it on the
 * session when it is still that plan's scheduled workout, so finishing ticks off that item. Returns
 * `fallback: true` when the function does not exist yet, so the caller runs its own multi-step start.
 */
export async function startSessionWithRpc(supabase: Db, planId: string, plannerEventId: string | null = null): Promise<{ sessionId: string | null; resumed: boolean; error: unknown; fallback: boolean }> {
  const rpc = await supabase.rpc("fitx_start_workout_session", plannerEventId ? { p_plan_id: planId, p_planner_event_id: plannerEventId } : { p_plan_id: planId });
  if (rpc.error) return { sessionId: null, resumed: false, error: isMissingFunctionError(rpc.error) ? null : rpc.error, fallback: isMissingFunctionError(rpc.error) };
  const result = (rpc.data ?? {}) as { session_id?: string; resumed?: boolean };
  return { sessionId: result.session_id ?? null, resumed: Boolean(result.resumed), error: result.session_id ? null : new Error("no session returned"), fallback: false };
}

export type FinishSummary = { duration: number; volume: number; sets: number; records: number };

/**
 * Finishes a session with fitx_finish_workout_session when available: totals, records, the planner item
 * behind the workout (fitx_complete_workout_event's rule) and the programme's next day, in one
 * transaction. `timeZone` is the browser's, which decides the session's day (the database falls back to
 * the saved one). Returns `fallback: true` when the function does not exist yet.
 */
export async function finishSessionWithRpc(supabase: Db, sessionId: string, durationSeconds: number, timeZone: string | null): Promise<{ summary: FinishSummary | null; error: unknown; fallback: boolean }> {
  const rpc = await supabase.rpc("fitx_finish_workout_session", { p_session_id: sessionId, p_duration_seconds: Math.max(0, Math.round(durationSeconds)), p_tz: timeZone });
  if (rpc.error) return { summary: null, error: isMissingFunctionError(rpc.error) ? null : rpc.error, fallback: isMissingFunctionError(rpc.error) };
  const data = (rpc.data ?? {}) as { duration_seconds?: number; total_volume?: number | string; sets?: number; records?: number };
  return { summary: { duration: Number(data.duration_seconds ?? durationSeconds), volume: Number(data.total_volume ?? 0), sets: Number(data.sets ?? 0), records: Number(data.records ?? 0) }, error: null, fallback: false };
}

/** Columns for reading a plan's exercises back, with the optional targets when present. */
export function planExerciseSelect(includeTargets: boolean) {
  return columnList(["id", "exercise_id", "exercise_name", "sort_order", "target_sets", "reps_min", "reps_max", "rest_seconds"], TARGET_COLUMNS, includeTargets);
}
