import type { SupabaseClient } from "@supabase/supabase-js";
import { columnList, isMissingRelationshipError, isMissingTableError, withOptionalColumns } from "@/lib/domain/schema-fallback";
import { timedItemDay } from "@/lib/domain/todo";
import type { CatalogExercise } from "./catalog";
import { generateDay, type GeneratedExercise } from "./generator";
import { scheduleDays, type Programme } from "./programmes";
import { createPlanRecord, PLANNER_DAY_COLUMNS, schedulePlannerEvent, type PlanExerciseInput } from "./plans";
import type { Level, TrainingContext } from "./taxonomy";

type Db = SupabaseClient;

export type Enrolment = {
  id: string;
  programme_id: string;
  context: TrainingContext;
  status: string;
  weekdays: number[];
  preferred_time: string;
  next_day_index: number;
  sessions_completed: number;
  started_on: string;
  last_session_at: string | null;
};

/** A dated plan created for an enrolment. `last_done_key`: local day of its latest finished session. */
export type ProgrammePlan = { id: string; title: string; planned_for: string | null; programme_day_index: number | null; last_done_key: string | null };

const ENROLMENT_COLUMNS = "id,programme_id,context,status,weekdays,preferred_time,next_day_index,sessions_completed,started_on,last_session_at";

/** `available` is false until the programme migrations are applied. */
export async function loadActiveEnrolment(supabase: Db, userId: string): Promise<{ enrolment: Enrolment | null; available: boolean; error: unknown }> {
  const result = await supabase.from("programme_enrolments").select(ENROLMENT_COLUMNS).eq("user_id", userId).eq("status", "active").maybeSingle();
  if (result.error) {
    const missing = isMissingTableError(result.error);
    return { enrolment: null, available: !missing, error: missing ? null : result.error };
  }
  return { enrolment: (result.data as Enrolment | null) ?? null, available: true, error: null };
}

function localKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function addDaysToKey(key: string, days: number): string {
  const [year, month, day] = key.split("-").map(Number);
  return localKey(new Date(year, month - 1, day + days));
}

/** The enrolment's plans dated from `fromKey`, oldest first, with each plan's latest finished day. */
export async function loadEnrolmentPlans(supabase: Db, userId: string, enrolmentId: string, fromKey: string): Promise<{ plans: ProgrammePlan[]; error: unknown }> {
  const query = (withLastDone: boolean) => {
    const base = supabase.from("workout_plans")
      .select(withLastDone ? "id,title,planned_for,programme_day_index,workout_sessions(started_at)" : "id,title,planned_for,programme_day_index")
      .eq("user_id", userId).eq("programme_enrolment_id", enrolmentId).gte("planned_for", fromKey);
    return (withLastDone
      ? base.eq("workout_sessions.status", "completed").order("started_at", { referencedTable: "workout_sessions", ascending: false }).limit(1, { referencedTable: "workout_sessions" })
      : base).order("planned_for", { ascending: true }).limit(40);
  };
  let result = await query(true);
  if (isMissingRelationshipError(result.error)) result = await query(false);
  if (result.error) return { plans: [], error: result.error };
  const rows = (result.data ?? []) as unknown as Array<Omit<ProgrammePlan, "last_done_key"> & { workout_sessions?: Array<{ started_at: string }> }>;
  return {
    plans: rows.map((row) => {
      const done = row.workout_sessions?.[0]?.started_at;
      return { id: row.id, title: row.title, planned_for: row.planned_for, programme_day_index: row.programme_day_index, last_done_key: done ? localKey(new Date(done)) : null };
    }),
    error: null,
  };
}

/**
 * Whether a programme day is done. Each programme day is its own single-date plan, so any finished
 * session of it counts, also one done before its date. (A reusable plan differs: a workout done early
 * leaves that day planned.)
 */
export function programmeDayDone(plan: Pick<ProgrammePlan, "last_done_key">): boolean {
  return Boolean(plan.last_done_key);
}

/** The programme days still to do: dated today or later, and not done. */
export function upcomingProgrammeDays<T extends Pick<ProgrammePlan, "planned_for" | "last_done_key">>(plans: readonly T[], todayKey: string): T[] {
  return plans.filter((plan) => Boolean(plan.planned_for && plan.planned_for >= todayKey) && !programmeDayDone(plan));
}

/**
 * Where the next scheduling run starts: the day after the last plan already scheduled (continuing
 * its programme sequence), or today at the enrolment's next day when nothing is scheduled ahead.
 */
export function nextScheduleStart(existing: readonly ProgrammePlan[], nextDayIndex: number, todayKey: string, dayCount: number): { fromKey: string; startDay: number } {
  const ahead = existing.filter((plan) => plan.planned_for && plan.planned_for >= todayKey);
  if (!ahead.length || dayCount <= 0) return { fromKey: todayKey, startDay: dayCount > 0 ? ((nextDayIndex % dayCount) + dayCount) % dayCount : 0 };
  const last = ahead.reduce((latest, plan) => (plan.planned_for! > latest.planned_for! ? plan : latest));
  return { fromKey: addDaysToKey(last.planned_for!, 1), startDay: ((last.programme_day_index ?? -1) + 1) % dayCount };
}

export function toPlanExercises(items: readonly GeneratedExercise[]): PlanExerciseInput[] {
  return items.map((item) => ({
    exercise_id: item.exercise.id, exercise_name: item.exercise.name, target_sets: item.target_sets, reps_min: item.reps_min,
    reps_max: item.reps_max, rest_seconds: item.rest_seconds, target_weight_kg: null, target_duration_seconds: item.target_duration_seconds,
  }));
}

/** A short programme name for plan titles: "Push, Pull, Legs · 3 days" -> "Push, Pull, Legs". */
export function programmeShortTitle(programme: Pick<Programme, "title">) {
  return programme.title.split(" · ")[0];
}

export type ScheduleInput = {
  userId: string;
  enrolment: Pick<Enrolment, "id" | "weekdays" | "preferred_time" | "context">;
  programme: Programme;
  catalog: readonly CatalogExercise[];
  owned: ReadonlySet<string>;
  level: Level;
  recentDays?: ReadonlyMap<string, number>;
  fromKey: string;
  startDay: number;
  horizonDays?: number;
  includeTargets: boolean;
};

/**
 * Creates dated plans (and planner events) for the programme days that fall on the enrolment's
 * weekdays within the horizon, continuing from `startDay`. Days the user cannot do at all with their
 * equipment are skipped and reported; slots that could not be filled are reported by label.
 */
export async function scheduleProgrammeDays(supabase: Db, input: ScheduleInput): Promise<{ created: number; skippedDays: string[]; unfilledSlots: string[]; error: unknown }> {
  const [year, month, day] = input.fromKey.split("-").map(Number);
  const dates = scheduleDays({ from: new Date(year, month - 1, day), weekdays: input.enrolment.weekdays, horizonDays: input.horizonDays ?? 7, startDay: input.startDay, dayCount: input.programme.days.length });
  let created = 0;
  const skippedDays: string[] = [];
  const unfilledSlots = new Set<string>();
  for (const { date, dayIndex } of dates) {
    const programmeDay = input.programme.days[dayIndex];
    const generated = generateDay(programmeDay.slots, {
      catalog: input.catalog, owned: input.owned, level: input.level, seed: `${input.enrolment.id}:${date}`,
      context: input.enrolment.context, recentDays: input.recentDays, sessionMinutes: input.programme.sessionMinutes,
    });
    for (const slot of generated.unfilled) unfilledSlots.add(slot.label ?? "An exercise");
    if (!generated.items.length) { skippedDays.push(programmeDay.title); continue; }
    const title = `${programmeDay.title} · ${programmeShortTitle(input.programme)}`.slice(0, 120);
    const saved = await createPlanRecord(supabase, input.userId, {
      title, split: input.programme.split, workout_location: input.enrolment.context, planned_for: date,
      notes: `${input.programme.title}, day ${dayIndex + 1} of ${input.programme.days.length}`,
      programme_enrolment_id: input.enrolment.id, programme_day_index: dayIndex,
    }, toPlanExercises(generated.items), { includeTargets: input.includeTargets });
    if (saved.error || !saved.planId) return { created, skippedDays, unfilledSlots: [...unfilledSlots], error: saved.error ?? new Error("plan not saved") };
    await schedulePlannerEvent(supabase, input.userId, saved.planId, title, date, input.enrolment.preferred_time.slice(0, 5));
    created++;
  }
  return { created, skippedDays, unfilledSlots: [...unfilledSlots], error: null };
}

/** Starts following a programme. Fails with `alreadyActive` when the user already follows one. */
export async function enrolInProgramme(supabase: Db, input: { userId: string; programme: Programme; context: TrainingContext; weekdays: number[]; time: string }): Promise<{ enrolment: Enrolment | null; alreadyActive: boolean; error: unknown }> {
  const result = await supabase.from("programme_enrolments").insert({
    user_id: input.userId, programme_id: input.programme.id, context: input.context, weekdays: [...new Set(input.weekdays)].sort(),
    preferred_time: `${input.time || "18:00"}:00`, next_day_index: 0, status: "active",
  }).select(ENROLMENT_COLUMNS).single();
  if (result.error) {
    const code = (result.error as { code?: string }).code;
    return { enrolment: null, alreadyActive: code === "23505", error: result.error };
  }
  return { enrolment: result.data as Enrolment, alreadyActive: false, error: null };
}

type DatedPlan = { id: string; planned_for: string | null };
/** `local_date` is read when the database has it (Planner v2). */
type LinkedItem = { id: string; workout_plan_id: string | null; starts_at: string | null; local_date?: string | null };

/** The programme days a member leaving it drops: those not started (no finished or running session). */
export function programmeDaysToRemove<T extends DatedPlan>(days: readonly T[], startedPlanIds: ReadonlySet<string>): T[] {
  return days.filter((day) => !startedPlanIds.has(day.id));
}

/**
 * The planner items FITX scheduled for these programme days: each day's timed workout item on its own
 * date (the rule plan saves use, see plannerEventsForPlan). To-Do items a member linked to a day, untimed
 * or on another day, are theirs and are not among them. An item's day is its local_date, the day it was
 * scheduled on, so a phone that has since changed time zone still finds the right items.
 */
export function ownProgrammeItems(items: readonly LinkedItem[], days: readonly DatedPlan[]): string[] {
  const dateOf = new Map(days.map((day) => [day.id, day.planned_for]));
  return items.filter((item) => {
    const date = item.workout_plan_id ? dateOf.get(item.workout_plan_id) : undefined;
    return Boolean(date && timedItemDay(item, (iso) => localKey(new Date(iso))) === date);
  }).map((item) => item.id);
}

/**
 * Stops following a programme. Its days from today on that were not started are removed, and the
 * planner items FITX scheduled for them are cancelled; To-Do items the member linked to those days stay
 * in the planner (the plan link is cleared with the plan). Days with a finished or running session, and
 * earlier days, stay, so workouts keep their history.
 */
export async function leaveProgramme(supabase: Db, input: { userId: string; enrolmentId: string; todayKey: string }): Promise<{ error: unknown }> {
  const ahead = await supabase.from("workout_plans").select("id,planned_for").eq("user_id", input.userId).eq("programme_enrolment_id", input.enrolmentId).gte("planned_for", input.todayKey);
  if (ahead.error) return { error: ahead.error };
  const days = (ahead.data ?? []) as DatedPlan[];
  if (days.length) {
    const started = await supabase.from("workout_sessions").select("plan_id").eq("user_id", input.userId).in("status", ["completed", "in_progress"]).in("plan_id", days.map((day) => day.id));
    if (started.error) return { error: started.error };
    const removable = programmeDaysToRemove(days, new Set(((started.data ?? []) as Array<{ plan_id: string | null }>).flatMap((row) => (row.plan_id ? [row.plan_id] : []))));
    const ids = removable.map((day) => day.id);
    if (ids.length) {
      // local_date arrives with the planner migration (20261118120000); before it, days come from the start times.
      const linked = await withOptionalColumns(PLANNER_DAY_COLUMNS, (include) =>
        supabase.from("planner_events").select(columnList(["id", "workout_plan_id", "starts_at"], PLANNER_DAY_COLUMNS, include))
          .eq("user_id", input.userId).eq("event_type", "workout").eq("status", "scheduled").in("workout_plan_id", ids));
      if (linked.result.error) return { error: linked.result.error };
      const own = ownProgrammeItems((linked.result.data ?? []) as unknown as LinkedItem[], removable);
      if (own.length) {
        const cancelled = await supabase.from("planner_events").update({ status: "cancelled" }).eq("user_id", input.userId).eq("status", "scheduled").in("id", own);
        if (cancelled.error) return { error: cancelled.error };
      }
      const removed = await supabase.from("workout_plans").delete().eq("user_id", input.userId).in("id", ids);
      if (removed.error) return { error: removed.error };
    }
  }
  const left = await supabase.from("programme_enrolments").update({ status: "left", updated_at: new Date().toISOString() }).eq("id", input.enrolmentId).eq("user_id", input.userId);
  return { error: left.error };
}

/** Moves an enrolment to the day after `dayIndex` when the database function is not there to do it. */
export async function advanceEnrolmentFallback(supabase: Db, input: { userId: string; enrolmentId: string; dayIndex: number; dayCount: number }) {
  const current = await supabase.from("programme_enrolments").select("sessions_completed").eq("id", input.enrolmentId).eq("user_id", input.userId).maybeSingle();
  if (current.error || !current.data) return { error: current.error };
  return supabase.from("programme_enrolments").update({
    next_day_index: input.dayCount > 0 ? (input.dayIndex + 1) % input.dayCount : 0,
    sessions_completed: Number((current.data as { sessions_completed: number }).sessions_completed) + 1,
    last_session_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("id", input.enrolmentId).eq("user_id", input.userId).eq("status", "active");
}
