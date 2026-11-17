import type { SupabaseClient } from "@supabase/supabase-js";
import { columnList, isMissingFunctionError, payloadFor, withOptionalColumns } from "@/lib/domain/schema-fallback";
import { setTargetReps } from "./sets";

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

/** A stored plan row. The target columns are absent when the database has not received the prescription-targets migration. */
export type PlanExerciseRow = {
  id: string;
  exercise_id: string | null;
  exercise_name: string;
  sort_order: number;
  target_sets: number;
  reps_min: number;
  reps_max: number;
  rest_seconds: number;
  target_weight_kg?: number | null;
  target_duration_seconds?: number | null;
};

/**
 * A plan's exercises in order, without the target columns when the database lacks them (`includedTargets` false).
 * Pass `includeTargets: false` once a database is known to lack them.
 */
export async function readPlanExercises(supabase: Db, userId: string, planId: string, includeTargets = true): Promise<{ rows: PlanExerciseRow[]; error: unknown; includedTargets: boolean }> {
  const outcome = await withOptionalColumns(TARGET_COLUMNS, (include) =>
    supabase.from("workout_plan_exercises").select(planExerciseSelect(include)).eq("plan_id", planId).eq("user_id", userId).order("sort_order"),
  { includeOptional: includeTargets });
  return { rows: (outcome.result.data || []) as unknown as PlanExerciseRow[], error: outcome.result.error, includedTargets: outcome.includedOptional };
}

/** `workout_plans` programme columns (20261118130030); a plan is read without them on an older database. */
const PLAN_PROGRAMME_COLUMNS = ["programme_enrolment_id", "programme_day_index"] as const;

export type PlanDetails = {
  id: string;
  title: string;
  planned_for: string | null;
  status: string;
  split: string;
  workout_location: string | null;
  notes: string | null;
  programme_enrolment_id: string | null;
  programme_day_index: number | null;
};

/** The latest completed session of a plan: the record a done programme day links to. */
export type PlanLastSession = { id: string; started_at: string; completed_at: string | null };

/**
 * What the plan preview shows: the plan, its exercises and its latest completed session. `missing` is true when the
 * plan is not the member's (removed, or another account's id).
 */
export async function loadPlanPreview(supabase: Db, userId: string, planId: string, includeTargets = true): Promise<{ plan: PlanDetails | null; rows: PlanExerciseRow[]; lastSession: PlanLastSession | null; includedTargets: boolean; missing: boolean; error: unknown }> {
  const [plan, exercises, last] = await Promise.all([
    withOptionalColumns(PLAN_PROGRAMME_COLUMNS, (include) => supabase.from("workout_plans")
      .select(columnList(["id", "title", "planned_for", "status", "split", "workout_location", "notes"], PLAN_PROGRAMME_COLUMNS, include))
      .eq("id", planId).eq("user_id", userId).maybeSingle()),
    readPlanExercises(supabase, userId, planId, includeTargets),
    supabase.from("workout_sessions").select("id,started_at,completed_at").eq("user_id", userId).eq("plan_id", planId).eq("status", "completed")
      .order("started_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const error = plan.result.error ?? exercises.error ?? null;
  if (error) return { plan: null, rows: [], lastSession: null, includedTargets: exercises.includedTargets, missing: false, error };
  const row = plan.result.data as unknown as (Omit<PlanDetails, "programme_enrolment_id" | "programme_day_index"> & Partial<Pick<PlanDetails, "programme_enrolment_id" | "programme_day_index">>) | null;
  if (!row) return { plan: null, rows: [], lastSession: null, includedTargets: exercises.includedTargets, missing: true, error: null };
  return {
    plan: { ...row, programme_enrolment_id: row.programme_enrolment_id ?? null, programme_day_index: row.programme_day_index ?? null },
    rows: exercises.rows,
    // The record link is extra: if it cannot be read the preview still works without it.
    lastSession: last.error ? null : ((last.data as PlanLastSession | null) ?? null),
    includedTargets: exercises.includedTargets,
    missing: false,
    error: null,
  };
}

/** `workout_sessions.planner_event_id` (planner migration 20261118120000), sent only when the database has it. */
const SESSION_PLANNER_COLUMNS = ["planner_event_id"] as const;

export type StartPlanFailure = "no_exercises" | "not_found" | "load_failed" | "prepare_failed" | "failed";

/** A start problem in the member's words. */
export function startFailureMessage(failure: StartPlanFailure): string {
  switch (failure) {
    case "no_exercises": return "This plan doesn’t have any exercises yet. Edit it to add some, then start it.";
    case "not_found": return "This plan is no longer in your list. Refresh the page and try again.";
    case "load_failed": return "This plan’s exercises couldn’t be loaded, so the workout wasn’t started. Check your connection and try again.";
    case "prepare_failed": return "Your workout session could not be prepared. Please try again.";
    default: return "Your workout could not be started. Check your connection and try again.";
  }
}

/**
 * Starts a session from a plan: fitx_start_workout_session (one transaction) when the database has it, otherwise
 * the session, its exercises and their sets step by step, removing the session if a later step fails. A workout
 * already in progress is returned instead (`resumed`). `plannerEventId` is the planner item the member pressed Start
 * on (start-link.ts); it is kept on the session only while it is that plan's scheduled workout. `title` names the
 * session on the fallback path (else the plan's own title is read). `includedTargets` is false when the database
 * turned out to lack the target columns.
 */
export async function startPlanSession(supabase: Db, input: { userId: string; planId: string; plannerEventId?: string | null; title?: string | null; includeTargets?: boolean }): Promise<{ sessionId: string; resumed: boolean; includedTargets: boolean } | { failure: StartPlanFailure; error: unknown; includedTargets: boolean }> {
  const plannerEventId = input.plannerEventId ?? null;
  let includedTargets = input.includeTargets ?? true;
  const viaRpc = await startSessionWithRpc(supabase, input.planId, plannerEventId);
  if (viaRpc.sessionId) return { sessionId: viaRpc.sessionId, resumed: viaRpc.resumed, includedTargets };
  if (!viaRpc.fallback) {
    const message = String((viaRpc.error as { message?: string } | null)?.message ?? "");
    return { failure: message.includes("no exercises") ? "no_exercises" : message.includes("not found") ? "not_found" : "failed", error: viaRpc.error, includedTargets };
  }

  // The database function is not there yet: one workout in progress per member, as it would ensure.
  const running = await supabase.from("workout_sessions").select("id").eq("user_id", input.userId).eq("status", "in_progress").order("started_at", { ascending: false }).limit(1).maybeSingle();
  if (!running.error && running.data) return { sessionId: (running.data as { id: string }).id, resumed: true, includedTargets };
  let title = input.title?.trim() || null;
  if (!title) {
    const plan = await supabase.from("workout_plans").select("title").eq("id", input.planId).eq("user_id", input.userId).maybeSingle();
    if (plan.error) return { failure: "failed", error: plan.error, includedTargets };
    title = (plan.data as { title?: string } | null)?.title ?? null;
    if (!title) return { failure: "not_found", error: null, includedTargets };
  }
  const planExercises = await readPlanExercises(supabase, input.userId, input.planId, includedTargets);
  includedTargets = planExercises.includedTargets;
  if (planExercises.error) return { failure: "load_failed", error: planExercises.error, includedTargets };
  if (!planExercises.rows.length) return { failure: "no_exercises", error: null, includedTargets };
  // The planner item this Start came from, kept on the session as the database function does: only while it is
  // still this plan's scheduled workout, and only when the database has the column (planner migration).
  const linkedItem = plannerEventId
    ? await supabase.from("planner_events").select("id").eq("id", plannerEventId).eq("user_id", input.userId).eq("workout_plan_id", input.planId)
      .eq("event_type", "workout").eq("status", "scheduled").maybeSingle()
    : null;
  const startedFrom = linkedItem && !linkedItem.error && linkedItem.data ? plannerEventId : null;
  const sessionRow = { user_id: input.userId, plan_id: input.planId, name: title, status: "in_progress", planner_event_id: startedFrom };
  const started = (await withOptionalColumns(SESSION_PLANNER_COLUMNS, (include) =>
    supabase.from("workout_sessions").insert(payloadFor(sessionRow, SESSION_PLANNER_COLUMNS, include)).select("id").single(),
  { includeOptional: startedFrom !== null })).result;
  if (started.error || !started.data) return { failure: "failed", error: started.error, includedTargets };
  const sessionId = (started.data as { id: string }).id;
  const sessionExercises = planExercises.rows.map((row, index) => ({
    user_id: input.userId, session_id: sessionId, exercise_id: row.exercise_id, exercise_name: row.exercise_name,
    sort_order: index, target_sets: row.target_sets, reps_min: row.reps_min, reps_max: row.reps_max, rest_seconds: row.rest_seconds,
    target_weight_kg: row.target_weight_kg ?? null, target_duration_seconds: row.target_duration_seconds ?? null,
  }));
  // The session copies the plan's targets; without target columns it starts with sets, reps and rest only.
  const inserted = await withOptionalColumns(TARGET_COLUMNS, (include) =>
    supabase.from("workout_session_exercises").insert(sessionExercises.map((row) => payloadFor(row, TARGET_COLUMNS, include)))
      .select(columnList(["id", "target_sets", "reps_min", "reps_max"], TARGET_COLUMNS, include)),
  { includeOptional: includedTargets });
  if (inserted.result.error || !inserted.result.data) {
    await supabase.from("workout_sessions").delete().eq("id", sessionId).eq("user_id", input.userId);
    return { failure: "prepare_failed", error: inserted.result.error, includedTargets };
  }
  const created = inserted.result.data as unknown as Array<{ id: string; target_sets: number; reps_min: number; reps_max: number; target_weight_kg?: number | null; target_duration_seconds?: number | null }>;
  // A timed movement's sets get no rep target (sets.ts setTargetReps).
  const setRows = created.flatMap((item) => Array.from({ length: item.target_sets }, (_, index) => ({
    user_id: input.userId, session_exercise_id: item.id, set_number: index + 1,
    target_reps: setTargetReps(item), weight_kg: item.target_weight_kg ?? 0,
  })));
  const sets = await supabase.from("workout_sets").insert(setRows);
  if (sets.error) {
    await supabase.from("workout_sessions").delete().eq("id", sessionId).eq("user_id", input.userId);
    return { failure: "prepare_failed", error: sets.error, includedTargets };
  }
  return { sessionId, resumed: false, includedTargets };
}
